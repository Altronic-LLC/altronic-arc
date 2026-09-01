import type {
  Equipment,
  FrequencyUnit,
  GraphListItem,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceReferenceValue,
  Person,
  ProjectReference,
  ScheduleBasis,
  ScheduledMaintenance,
  ScheduledMaintenanceInput,
} from "@/types/task";
import {
  FREQUENCY_UNITS,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  SCHEDULE_BASES,
} from "@/types/task";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";
import { isMeterSchedule } from "./maintenanceSchedule";
import {
  attachLookupTitle,
  fillPeople,
  fillPerson,
  lookupRef,
  personOrLookup,
  readBoolean,
  readNumber,
  text,
} from "./maintenanceShared";
import { parsePeople } from "./grayMarketMapper";
import { attachReference, referenceIndex } from "./maintenanceReferences";

// =============================================================================
// Graph item → ScheduledMaintenance (Scheduled Maintenance, PMO site), and the
// create payload back the other way.
//
// **There is no `Communication` column on this list, and that is deliberate.**
// A schedule is a rule; the conversation belongs on the work order the rule
// produced. Nothing here parses or writes a comment thread, and the domain
// type has no `comments` field for one to be quietly added to.
//
// `AssignedTo` and `LastCompletedBy` are SINGLE person columns — bare
// `<Name>LookupId` on the wire, bare integer on the write — and `EquipmentRef`,
// `OperationsProjectRef`, `DepartmentRef` and `LocationRef` are single lookups
// with the same shape. See maintenanceShared.ts.
//
// **Department and Location became lookups on 2026-08-28** and have NO legacy
// fallback here: the old choice columns were only ever created on the Equipment
// List, so selecting `Department` / `Location` on THIS list 400s the whole
// read. Never add them to SCHEDULED_MAINTENANCE_SELECT.
//
// `Active` is written on EVERY create, never omitted: a null Active reads as
// blank in SharePoint's own views, and a schedule that is neither on nor off
// is a schedule nobody can tell the state of. Setting it false is also the
// ONLY way to retire a schedule — there is no delete.
// =============================================================================

/** `$select` for a schedule read — both halves of every single-value column. */
export const SCHEDULED_MAINTENANCE_SELECT = [
  "Title",
  "Instructions",
  "Category",
  "Priority",
  "FrequencyInterval",
  "FrequencyUnit",
  "ScheduleBasis",
  "FirstDueDate",
  "NextDueDate",
  "LastCompleted",
  // The hourmeter pair — a meter schedule is due at a READING, not a date.
  // `NextDueHours` is app-owned exactly the way `NextDueDate` is.
  "LastCompletedHours",
  "NextDueHours",
  "TimeNeeded",
  "GraceDays",
  "LeadTimeDays",
  "Active",
  "RequiresShutdown",
  "LOTORequired",
  "EquipmentRef",
  "EquipmentRefLookupId",
  "OperationsProjectRef",
  "OperationsProjectRefLookupId",
  // The schedule's OWN department and location — not the asset's. Single
  // LOOKUPS since 2026-08-28; both halves, and never the old choice columns,
  // which this list hasn't got.
  "DepartmentRef",
  "DepartmentRefLookupId",
  "LocationRef",
  "LocationRefLookupId",
  "AssignedTo",
  "AssignedToLookupId",
  "LastCompletedBy",
  "LastCompletedByLookupId",
  "Watchers",
  "Attachments",
  "Created",
  "Modified",
].join(",");

function clampOptional<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const value = text(raw).trim();
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function toScheduledMaintenance(item: GraphListItem): ScheduledMaintenance {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    instructions: text(f.Instructions),
    category: clampOptional<MaintenanceCategory>(f.Category, MAINTENANCE_CATEGORIES),
    priority: clampOptional<MaintenancePriority>(f.Priority, MAINTENANCE_PRIORITIES),
    equipment: lookupRef(f.EquipmentRef, f.EquipmentRefLookupId),
    operationsProject: lookupRef(f.OperationsProjectRef, f.OperationsProjectRefLookupId),
    // Single lookups into the two Maintenance reference lists; titles are
    // joined afterwards by `attachScheduleReferences`.
    department: lookupRef(f.DepartmentRef, f.DepartmentRefLookupId),
    location: lookupRef(f.LocationRef, f.LocationRefLookupId),
    frequencyInterval: readNumber(f.FrequencyInterval),
    frequencyUnit: clampOptional<FrequencyUnit>(f.FrequencyUnit, FREQUENCY_UNITS),
    scheduleBasis: clampOptional<ScheduleBasis>(f.ScheduleBasis, SCHEDULE_BASES),
    firstDueDate: parseSpDateOnly(f.FirstDueDate),
    nextDueDate: parseSpDateOnly(f.NextDueDate),
    lastCompleted: parseSpDateOnly(f.LastCompleted),
    // `readNumber` keeps 0 as 0 — a real hourmeter reading off a new machine —
    // and only a genuinely absent column reads as null. The two are different
    // and the whole meter path depends on them staying different.
    lastCompletedHours: readNumber(f.LastCompletedHours),
    nextDueHours: readNumber(f.NextDueHours),
    assignedTo: personOrLookup(f.AssignedTo, f.AssignedToLookupId),
    lastCompletedBy: personOrLookup(f.LastCompletedBy, f.LastCompletedByLookupId),
    watchers: parsePeople(f.Watchers),
    timeNeeded: readNumber(f.TimeNeeded),
    graceDays: readNumber(f.GraceDays),
    leadTimeDays: readNumber(f.LeadTimeDays),
    active: readBoolean(f.Active),
    requiresShutdown: readBoolean(f.RequiresShutdown),
    lotoRequired: readBoolean(f.LOTORequired),
    hasAttachments: f.Attachments === true,
    // Full timestamps, not date-only columns — parseSpDate, never
    // parseSpDateOnly (whose midday pivot would move an afternoon edit).
    createdAt: parseSpDate(f.Created) ?? safeDate(item.createdDateTime),
    modifiedAt: parseSpDate(f.Modified) ?? safeDate(item.lastModifiedDateTime),
  };
}

function safeDate(raw: string | undefined): Date {
  if (!raw) return new Date(0);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

/**
 * Resolve each schedule's Operations project title against the loaded list.
 * Mutates in place, the same "join after the fact" step the work orders do.
 *
 * Separate from `attachScheduleEquipmentTitles` rather than folded into it:
 * they resolve against two different lists, and the equipment read is already
 * on the schedule query's critical path while the projects read is a cheap
 * 200-row reference list the Operations module has loaded anyway.
 */
export function attachScheduleOperationsProjects(
  schedules: ScheduledMaintenance[],
  projects: ProjectReference[],
): void {
  const byId = new Map(projects.map((p) => [p.lookupId, { title: p.title }]));
  for (const s of schedules) {
    s.operationsProject = attachLookupTitle(s.operationsProject, byId);
  }
}

/**
 * Resolve each schedule's Department / Location against the two reference
 * lists. Mutates in place.
 *
 * `attachReference` rather than `attachLookupTitle`, for the same reason the
 * work orders use it: a schedule pointing at a value the list no longer has
 * still has to render as `#41` rather than as nothing.
 */
export function attachScheduleReferences(
  schedules: ScheduledMaintenance[],
  departments: MaintenanceReferenceValue[],
  locations: MaintenanceReferenceValue[],
): void {
  const departmentIndex = referenceIndex(departments);
  const locationIndex = referenceIndex(locations);
  for (const s of schedules) {
    s.department = attachReference(s.department, departmentIndex);
    s.location = attachReference(s.location, locationIndex);
  }
}

/** Fill in the two person columns from the site's user directory. Mutates in place. */
export function attachScheduledMaintenancePeople(
  schedules: ScheduledMaintenance[],
  siteUsers: Map<number, Person>,
): void {
  for (const s of schedules) {
    s.assignedTo = fillPerson(s.assignedTo, siteUsers);
    s.lastCompletedBy = fillPerson(s.lastCompletedBy, siteUsers);
    s.watchers = fillPeople(s.watchers, siteUsers);
  }
}

/** Resolve each schedule's equipment title against the loaded asset list. Mutates in place. */
export function attachScheduleEquipmentTitles(
  schedules: ScheduledMaintenance[],
  equipment: Array<Equipment | ProjectReference>,
): void {
  const byId = new Map(
    equipment.map((e) => [e.lookupId, { title: "name" in e ? e.name : e.title }]),
  );
  for (const s of schedules) {
    s.equipment = attachLookupTitle(s.equipment, byId);
  }
}

/**
 * The create payload.
 *
 * Blank text is omitted; the three booleans are always sent (see the note at
 * the top of this file). A brand-new schedule gets `NextDueDate` seeded from
 * `FirstDueDate` when the caller didn't set one, so the very first occurrence
 * is due somewhere rather than only being inferrable.
 */
export function buildScheduledMaintenanceCreateFields(
  input: ScheduledMaintenanceInput,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.title.trim(),
    Active: input.active ?? true,
    RequiresShutdown: input.requiresShutdown ?? false,
    LOTORequired: input.lotoRequired ?? false,
  };
  if (input.instructions?.trim()) fields.Instructions = input.instructions;
  if (input.category) fields.Category = input.category;
  if (input.priority) fields.Priority = input.priority;
  if (input.frequencyInterval != null) fields.FrequencyInterval = input.frequencyInterval;
  if (input.frequencyUnit) fields.FrequencyUnit = input.frequencyUnit;
  if (input.scheduleBasis) fields.ScheduleBasis = input.scheduleBasis;
  if (input.firstDueDate) fields.FirstDueDate = toSpDateOnly(input.firstDueDate);
  const nextDue = input.nextDueDate ?? input.firstDueDate ?? null;
  if (nextDue) fields.NextDueDate = toSpDateOnly(nextDue);
  // `!= null` rather than a truthiness check: 0 is a real reading, and a
  // brand-new machine at 0 hours with a "first due at 0" target is legitimate.
  if (input.lastCompletedHours != null) fields.LastCompletedHours = input.lastCompletedHours;
  if (input.nextDueHours != null) fields.NextDueHours = input.nextDueHours;
  if (input.timeNeeded != null) fields.TimeNeeded = input.timeNeeded;
  if (input.graceDays != null) fields.GraceDays = input.graceDays;
  if (input.leadTimeDays != null) fields.LeadTimeDays = input.leadTimeDays;
  // Single lookups: a BARE integer, never multiLookupField's annotated shape.
  if (input.equipmentLookupId) fields.EquipmentRefLookupId = input.equipmentLookupId;
  if (input.operationsProjectLookupId) {
    fields.OperationsProjectRefLookupId = input.operationsProjectLookupId;
  }
  // Single lookups: a BARE integer, omitted when unset.
  if (input.departmentLookupId) fields.DepartmentRefLookupId = input.departmentLookupId;
  if (input.locationLookupId) fields.LocationRefLookupId = input.locationLookupId;
  return fields;
}

/** What to call a schedule. Never an empty cell. */
export function scheduledMaintenanceLabel(schedule: ScheduledMaintenance): string {
  const title = schedule.title.trim();
  const asset = schedule.equipment?.title?.trim();
  if (title && asset) return `${title} — ${asset}`;
  return title || asset || `Schedule #${schedule.id}`;
}

/**
 * Soonest due first, with inactive schedules last and undated ones after the
 * dated ones — the order a maintenance planner reads a list of PMs in.
 */
export function compareScheduledMaintenance(
  a: ScheduledMaintenance,
  b: ScheduledMaintenance,
): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  // A METER schedule has no date at all, so it sorts with the undated ones
  // rather than being given a position it hasn't earned. Deliberately NOT
  // ordered by `NextDueHours`: hours and dates are different units, and
  // interleaving "due at 5,200 hrs" with "due 14 Sep" by number would put a
  // meter schedule wherever its reading happened to fall on a date scale.
  // Within the undated group they order by id, so the sort is stable.
  const aDue = isMeterSchedule(a) ? undefined : (a.nextDueDate ?? a.firstDueDate)?.getTime();
  const bDue = isMeterSchedule(b) ? undefined : (b.nextDueDate ?? b.firstDueDate)?.getTime();
  if (aDue === undefined && bDue === undefined) return a.id - b.id;
  if (aDue === undefined) return 1;
  if (bDue === undefined) return -1;
  return aDue - bDue || a.id - b.id;
}

/** Everyone already on a schedule — the people-picker's starting point. */
export function collectScheduledMaintenancePeople(
  schedules: ScheduledMaintenance[],
): Person[] {
  const out: Person[] = [];
  for (const s of schedules) {
    for (const p of [s.assignedTo, s.lastCompletedBy, ...s.watchers]) {
      if (p) out.push(p);
    }
  }
  return out;
}
