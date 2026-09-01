import { graphFetch, graphFetchAll } from "./graph";
import {
  SITES,
  SP_PMO_SITE_URL,
  SP_SCHEDULED_MAINTENANCE_LIST_ID,
  USE_MOCK,
} from "./config";
import {
  listSiteUserDirectory,
  resolvePeopleLookupIds,
  resolvePersonLookupId,
} from "./siteUsers";
import type {
  GraphListItem,
  Person,
  ScheduledMaintenance,
  ScheduledMaintenanceInput,
} from "@/types/task";
import {
  SCHEDULED_MAINTENANCE_SELECT,
  attachScheduleEquipmentTitles,
  attachScheduleOperationsProjects,
  attachScheduleReferences,
  attachScheduledMaintenancePeople,
  buildScheduledMaintenanceCreateFields,
  compareScheduledMaintenance,
  toScheduledMaintenance,
} from "@/lib/scheduledMaintenanceMapper";
import { advanceSchedule } from "@/lib/maintenanceSchedule";
import { multiPersonField } from "@/lib/graphFields";
import { toSpDateOnly } from "@/lib/spDates";
import { autoWatchers } from "@/lib/people";
import { listEquipment } from "./operationsEquipment";
import { listOperationsProjects } from "./operationsProjects";
import { listMaintenanceReferenceLists } from "./maintenanceReferenceLists";
import { MOCK_SCHEDULED_MAINTENANCE } from "@/data/maintenanceMockData";

// =============================================================================
// Scheduled Maintenance — the PM schedules work orders are raised from, on the
// PMO site (SITES.pmo).
//
// **No `Communication` column, and no comment thread.** That is deliberate:
// a schedule is a rule, and the conversation belongs on the work order the
// rule produced. Nothing in this module reads or writes one, and there is no
// `addComment` for a view to reach for.
//
// **No delete either.** A schedule that has stopped applying is set
// `Active: false` — which `lib/maintenanceSchedule.ts` honours by projecting
// nothing at all — so its history stays attached to the asset. Deleting one
// would orphan every completed work order that points at it.
// `scheduledMaintenance.test.ts` asserts this module exports nothing matching
// /delete|remove/.
// =============================================================================

const MOCK_STORAGE_KEY = "aets:mock-scheduled-maintenance-store-v1";

function revive(s: ScheduledMaintenance): ScheduledMaintenance {
  return {
    ...s,
    firstDueDate: s.firstDueDate ? new Date(s.firstDueDate) : null,
    nextDueDate: s.nextDueDate ? new Date(s.nextDueDate) : null,
    lastCompleted: s.lastCompleted ? new Date(s.lastCompleted) : null,
    createdAt: new Date(s.createdAt),
    modifiedAt: new Date(s.modifiedAt),
  };
}

function loadMockStoreFromStorage(): ScheduledMaintenance[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as ScheduledMaintenance[]).map(revive);
  } catch {
    return null;
  }
}

function saveMockStoreToStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockStore));
  } catch {
    // Quota, private mode, etc. — the demo still works in-memory.
  }
}

let mockStore: ScheduledMaintenance[] =
  loadMockStoreFromStorage() ?? MOCK_SCHEDULED_MAINTENANCE.map(revive);

/** Demo-mode-only: clear local data and reset to the bundled seed. */
export function resetScheduledMaintenanceMockStore(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(MOCK_STORAGE_KEY);
    } catch {
      // ignored
    }
  }
  mockStore = MOCK_SCHEDULED_MAINTENANCE.map(revive);
}

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_SCHEDULED_MAINTENANCE_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_SCHEDULED_MAINTENANCE_LIST_ID is not set.`);
  }
  return SP_SCHEDULED_MAINTENANCE_LIST_ID;
}

function listPath(): string {
  return `/sites/${SITES.pmo}/lists/${requireListId("reach the PM schedules")}/items`;
}

function itemPath(id: number): string {
  return `${listPath()}/${id}`;
}

function resolveSchedulePerson(person: Person | null): Promise<Person | null> {
  return resolvePersonLookupId(SITES.pmo, SP_PMO_SITE_URL, person);
}

function resolveSchedulePeople(people: Person[]): Promise<Person[]> {
  return resolvePeopleLookupIds(SITES.pmo, SP_PMO_SITE_URL, people);
}

/** A person write that was asked for and can't be made is REFUSED, never nulled. */
function requireResolved(person: Person | null, resolved: Person | null, label: string): void {
  if (!person) return;
  if (resolved?.lookupId) return;
  throw new Error(
    `Couldn't set ${label} to ${person.displayName || person.email || "that person"}: ` +
      `SharePoint has no user record for them on the Altronic PMO site, and one couldn't be ` +
      `created. Ask an admin to check your SharePoint access, then try again.`,
  );
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/** Every PM schedule — active first, then soonest due. */
export async function listScheduledMaintenance(): Promise<ScheduledMaintenance[]> {
  if (USE_MOCK) {
    const schedules = [...mockStore].sort(compareScheduledMaintenance).map((s) => ({ ...s }));
    await resolveScheduleReferences(schedules);
    return delay(schedules);
  }

  const [items, siteUsers, equipment, operationsProjects, references] = await Promise.all([
    graphFetchAll<GraphListItem>(
      `${listPath()}?$expand=fields($select=${SCHEDULED_MAINTENANCE_SELECT})&$top=500`,
    ),
    listSiteUserDirectory(SITES.pmo),
    listEquipment(),
    // The same reference-list read the Operations task list makes — it
    // resolves `OperationsProjectRef`, which arrives as a bare lookupId.
    listOperationsProjects(),
    // Departments and Locations, single lookups with the same shape.
    listMaintenanceReferenceLists(),
  ]);
  const schedules = items.map(toScheduledMaintenance);
  attachScheduledMaintenancePeople(schedules, siteUsers);
  attachScheduleEquipmentTitles(schedules, equipment);
  attachScheduleOperationsProjects(schedules, operationsProjects);
  attachScheduleReferences(schedules, references.departments, references.locations);
  return schedules.sort(compareScheduledMaintenance);
}

/**
 * Resolve Department / Location against the two Maintenance reference lists.
 * Run in BOTH modes — see the equivalent note in api/maintenanceTasks.ts.
 */
async function resolveScheduleReferences(schedules: ScheduledMaintenance[]): Promise<void> {
  const { departments, locations } = await listMaintenanceReferenceLists();
  attachScheduleReferences(schedules, departments, locations);
}

export async function getScheduledMaintenance(id: number): Promise<ScheduledMaintenance | null> {
  const all = await listScheduledMaintenance();
  return all.find((s) => s.id === id) ?? null;
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

/** Patch columns by their SharePoint names. Returns the updated schedule. */
export async function updateScheduledMaintenanceFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<ScheduledMaintenance> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Schedule ${id} not found`);
    const next: ScheduledMaintenance = { ...mockStore[idx], modifiedAt: new Date() };
    applyMockFields(next, fields);
    await resolveScheduleReferences([next]);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const reloaded = await getScheduledMaintenance(id);
  if (!reloaded) throw new Error(`Schedule ${id} disappeared after update`);
  return reloaded;
}

function applyMockFields(next: ScheduledMaintenance, fields: Record<string, unknown>) {
  const dateOf = (v: unknown) => (v ? new Date(String(v)) : null);
  const numOf = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("Instructions" in fields) next.instructions = String(fields.Instructions ?? "");
  if ("Category" in fields) next.category = (fields.Category as ScheduledMaintenance["category"]) ?? null;
  if ("Priority" in fields) next.priority = (fields.Priority as ScheduledMaintenance["priority"]) ?? null;
  if ("FrequencyInterval" in fields) next.frequencyInterval = numOf(fields.FrequencyInterval);
  if ("FrequencyUnit" in fields) {
    next.frequencyUnit = (fields.FrequencyUnit as ScheduledMaintenance["frequencyUnit"]) ?? null;
  }
  if ("ScheduleBasis" in fields) {
    next.scheduleBasis = (fields.ScheduleBasis as ScheduledMaintenance["scheduleBasis"]) ?? null;
  }
  if ("FirstDueDate" in fields) next.firstDueDate = dateOf(fields.FirstDueDate);
  if ("NextDueDate" in fields) next.nextDueDate = dateOf(fields.NextDueDate);
  if ("LastCompleted" in fields) next.lastCompleted = dateOf(fields.LastCompleted);
  if ("TimeNeeded" in fields) next.timeNeeded = numOf(fields.TimeNeeded);
  if ("GraceDays" in fields) next.graceDays = numOf(fields.GraceDays);
  if ("LeadTimeDays" in fields) next.leadTimeDays = numOf(fields.LeadTimeDays);
  if ("Active" in fields) next.active = fields.Active === true;
  if ("RequiresShutdown" in fields) next.requiresShutdown = fields.RequiresShutdown === true;
  if ("LOTORequired" in fields) next.lotoRequired = fields.LOTORequired === true;
  if ("AssignedTo" in fields) next.assignedTo = (fields.AssignedTo as Person | null) ?? null;
  if ("LastCompletedBy" in fields) {
    next.lastCompletedBy = (fields.LastCompletedBy as Person | null) ?? null;
  }
  if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
    next.watchers = fields.Watchers as Person[];
  }
  if ("EquipmentRefLookupId" in fields) {
    const v = fields.EquipmentRefLookupId;
    next.equipment = v ? { lookupId: Number(v), title: next.equipment?.title ?? "" } : null;
  }
  if ("OperationsProjectRefLookupId" in fields) {
    const v = fields.OperationsProjectRefLookupId;
    next.operationsProject = v
      ? { lookupId: Number(v), title: next.operationsProject?.title ?? "" }
      : null;
  }
  // Single LOOKUPS since 2026-08-28 — a bare lookupId here too, `null`
  // clears, and the title is filled in by resolveScheduleReferences.
  if ("DepartmentRefLookupId" in fields) {
    const v = fields.DepartmentRefLookupId;
    next.department = v ? { lookupId: Number(v), title: "" } : null;
  }
  if ("LocationRefLookupId" in fields) {
    const v = fields.LocationRefLookupId;
    next.location = v ? { lookupId: Number(v), title: "" } : null;
  }
}

/** Change the equipment reference (or clear with `null`). A BARE integer. */
export async function setScheduleEquipment(
  id: number,
  equipmentLookupId: number | null,
): Promise<ScheduledMaintenance> {
  return updateScheduledMaintenanceFields(id, { EquipmentRefLookupId: equipmentLookupId });
}

/**
 * Change the Operations project reference (or clear with `null`).
 *
 * A SINGLE lookup — a BARE integer, never `multiLookupField`'s annotated
 * `Collection(Edm.Int32)` shape.
 */
export async function setScheduleOperationsProject(
  id: number,
  operationsProjectLookupId: number | null,
): Promise<ScheduledMaintenance> {
  return updateScheduledMaintenanceFields(id, {
    OperationsProjectRefLookupId: operationsProjectLookupId,
  });
}

/**
 * Retire or reinstate a schedule.
 *
 * This is what "delete a schedule" means here. An inactive schedule projects
 * no occurrences at all (`nextDueDates` returns an empty list), so it drops
 * off every calendar and work list while every work order it ever produced
 * still points at something.
 */
export async function setScheduleActive(
  id: number,
  active: boolean,
): Promise<ScheduledMaintenance> {
  return updateScheduledMaintenanceFields(id, { Active: active });
}

async function watchersWithPerson(id: number, person: Person | null): Promise<Person[]> {
  const current = await getScheduledMaintenance(id);
  return autoWatchers(current?.watchers, person);
}

/** Set who owns the schedule (or clear with `null`). They also start watching. */
export async function setScheduleAssignedTo(
  id: number,
  person: Person | null,
): Promise<ScheduledMaintenance> {
  const watchers = await watchersWithPerson(id, person);
  if (USE_MOCK) {
    return updateScheduledMaintenanceFields(id, { AssignedTo: person, Watchers: watchers });
  }
  const resolved = await resolveSchedulePerson(person);
  requireResolved(person, resolved, "Assigned To");
  const resolvedWatchers = await resolveSchedulePeople(watchers);
  return updateScheduledMaintenanceFields(id, {
    // SINGLE person column — a bare integer, never multiPersonField's shape.
    AssignedToLookupId: resolved?.lookupId ?? null,
    ...multiPersonField("Watchers", resolvedWatchers),
  });
}

/** Replace the Watchers list. */
export async function setScheduleWatchers(
  id: number,
  people: Person[],
): Promise<ScheduledMaintenance> {
  if (USE_MOCK) return updateScheduledMaintenanceFields(id, { Watchers: people });
  const ensured = await resolveSchedulePeople(people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateScheduledMaintenanceFields(id, multiPersonField("Watchers", ensured));
}

/** Add the given person to the watchers list (if not already there). */
export async function watchSchedule(id: number, person: Person): Promise<ScheduledMaintenance> {
  const schedule = await getScheduledMaintenance(id);
  if (!schedule) throw new Error(`Schedule ${id} not found`);
  const key = (person.email ?? person.displayName).toLowerCase();
  if (schedule.watchers.some((w) => (w.email ?? w.displayName).toLowerCase() === key)) {
    return schedule;
  }
  return setScheduleWatchers(id, [...schedule.watchers, person]);
}

/** Take the given person off the watchers list. */
export async function unwatchSchedule(id: number, person: Person): Promise<ScheduledMaintenance> {
  const schedule = await getScheduledMaintenance(id);
  if (!schedule) throw new Error(`Schedule ${id} not found`);
  const key = (person.email ?? person.displayName).toLowerCase();
  const next = schedule.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key);
  if (next.length === schedule.watchers.length) return schedule;
  return setScheduleWatchers(id, next);
}

/**
 * Record that an occurrence was done, and roll the schedule on.
 *
 * `LastCompleted`, `LastCompletedBy` and the new `NextDueDate` go out in ONE
 * write — three columns that describe one event, and a schedule whose last
 * completion and next due date disagree is one nobody can plan from.
 *
 * The new due date comes from `advanceSchedule`, which is where Fixed and
 * Floating actually differ. When it returns null (an inactive schedule, or one
 * with no usable frequency) the completion is still recorded and `NextDueDate`
 * is left ALONE — blanking it would silently retire a schedule that somebody
 * only meant to tick off.
 */
export async function recordScheduleCompletion(
  id: number,
  input: { completedOn: Date; completedBy: Person | null },
): Promise<ScheduledMaintenance> {
  const schedule = await getScheduledMaintenance(id);
  if (!schedule) throw new Error(`Schedule ${id} not found`);

  const nextDue = advanceSchedule(schedule, input.completedOn);
  const fields: Record<string, unknown> = {
    LastCompleted: toSpDateOnly(input.completedOn),
  };
  if (nextDue) fields.NextDueDate = toSpDateOnly(nextDue);

  if (USE_MOCK) {
    return updateScheduledMaintenanceFields(id, {
      ...fields,
      LastCompletedBy: input.completedBy,
    });
  }
  const resolved = await resolveSchedulePerson(input.completedBy);
  requireResolved(input.completedBy, resolved, "Last Completed By");
  return updateScheduledMaintenanceFields(id, {
    ...fields,
    LastCompletedByLookupId: resolved?.lookupId ?? null,
  });
}

/** Create a PM schedule. */
export async function createScheduledMaintenance(
  input: ScheduledMaintenanceInput,
  creator?: Person | null,
): Promise<ScheduledMaintenance> {
  if (USE_MOCK) {
    const now = new Date();
    const schedule: ScheduledMaintenance = {
      id: Math.max(0, ...mockStore.map((s) => s.id)) + 1,
      title: input.title.trim(),
      instructions: input.instructions ?? "",
      category: input.category ?? null,
      priority: input.priority ?? null,
      equipment: input.equipmentLookupId
        ? { lookupId: input.equipmentLookupId, title: "" }
        : null,
      operationsProject: input.operationsProjectLookupId
        ? { lookupId: input.operationsProjectLookupId, title: "" }
        : null,
      department: input.departmentLookupId
        ? { lookupId: input.departmentLookupId, title: "" }
        : null,
      location: input.locationLookupId ? { lookupId: input.locationLookupId, title: "" } : null,
      frequencyInterval: input.frequencyInterval ?? null,
      frequencyUnit: input.frequencyUnit ?? null,
      scheduleBasis: input.scheduleBasis ?? "Fixed",
      firstDueDate: input.firstDueDate ?? null,
      nextDueDate: input.nextDueDate ?? input.firstDueDate ?? null,
      lastCompleted: null,
      assignedTo: input.assignedTo ?? null,
      lastCompletedBy: null,
      watchers: autoWatchers(input.watchers, input.assignedTo ?? null, creator ?? null),
      timeNeeded: input.timeNeeded ?? null,
      graceDays: input.graceDays ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      active: input.active ?? true,
      requiresShutdown: input.requiresShutdown ?? false,
      lotoRequired: input.lotoRequired ?? false,
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    await resolveScheduleReferences([schedule]);
    mockStore = [schedule, ...mockStore];
    saveMockStoreToStorage();
    return delay(schedule);
  }

  const fields = buildScheduledMaintenanceCreateFields(input);

  const assigned = await resolveSchedulePerson(input.assignedTo ?? null);
  requireResolved(input.assignedTo ?? null, assigned, "Assigned To");
  if (assigned?.lookupId) fields.AssignedToLookupId = assigned.lookupId;

  const watchers = await resolveSchedulePeople(
    autoWatchers(input.watchers, input.assignedTo ?? null, creator ?? null),
  );
  if (watchers.some((p) => p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }

  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return toScheduledMaintenance(created);
}
