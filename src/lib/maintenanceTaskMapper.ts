import type {
  Equipment,
  GraphListItem,
  MaintenanceCategory,
  MaintenanceDueStatus,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTask,
  MaintenanceTaskInput,
  MaintenanceTaskType,
  Person,
  ProjectReference,
  ScheduledMaintenance,
} from "@/types/task";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_DUE_STATUSES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
} from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";
import {
  attachLookupTitle,
  fillPeople,
  fillPerson,
  lookupRef,
  personOrLookup,
  readNumber,
  text,
} from "./maintenanceShared";
import { parsePeople } from "./grayMarketMapper";

// =============================================================================
// Graph item → MaintenanceTask (Altronic Maintenance Tasks, PMO site), and the
// create payload back the other way.
//
// Three shapes worth knowing before touching this file:
//
//  - **Three SINGLE person columns** — Assigned, ReportedBy, CompletedBy. Graph
//    returns each as a bare `<Name>LookupId`, so both halves are selected and
//    `attachMaintenanceTaskPeople` fills the names in from the PMO site's User
//    Information List. Writing one is a BARE INTEGER.
//  - **Three SINGLE lookups** — EquipmentRef, ScheduledMaintenanceRef,
//    OperationsTaskReference. Same story: bare `<Name>LookupId` on the wire,
//    bare integer on the write. Never `multiLookupField`, whose
//    `Collection(Edm.Int32)` annotation is for MULTI-value columns and 400s
//    here.
//  - **`DueStatus` is read-only to ARC.** A Power Automate flow maintains it.
//    It is in the `$select` and in the domain type, and appears in NO write
//    payload anywhere in this module — see `buildMaintenanceTaskCreateFields`.
// =============================================================================

/** `$select` for a work-order read — both halves of every single-value column. */
export const MAINTENANCE_TASK_SELECT = [
  "Title",
  "Description",
  "Status",
  "Priority",
  "Category",
  "TaskType",
  // Read, never written — a Power Automate flow owns this column.
  "DueStatus",
  "StartDate",
  "DueDate",
  "CompletedDate",
  "WONumber",
  "TechNotes",
  "FailureCause",
  "Resolution",
  "PartsUsed",
  "LaborHours",
  "DowntimeHours",
  // Both halves of every single-value lookup and person column.
  "EquipmentRef",
  "EquipmentRefLookupId",
  "ScheduledMaintenanceRef",
  "ScheduledMaintenanceRefLookupId",
  "OperationsTaskReference",
  "OperationsTaskReferenceLookupId",
  "Assigned",
  "AssignedLookupId",
  "ReportedBy",
  "ReportedByLookupId",
  "CompletedBy",
  "CompletedByLookupId",
  "Watchers",
  "Communication",
  "Attachments",
  "Created",
  "Modified",
].join(",");

function clampRequired<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = text(raw).trim();
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampOptional<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const value = text(raw).trim();
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function toMaintenanceTask(item: GraphListItem): MaintenanceTask {
  const f = item.fields ?? {};
  const scheduleRef = lookupRef(f.ScheduledMaintenanceRef, f.ScheduledMaintenanceRefLookupId);

  return {
    id: parseInt(item.id, 10),
    woNumber: text(f.WONumber).trim(),
    title: text(f.Title).trim(),
    description: text(f.Description),
    status: clampRequired<MaintenanceStatus>(f.Status, MAINTENANCE_STATUSES, "Backlog"),
    priority: clampOptional<MaintenancePriority>(f.Priority, MAINTENANCE_PRIORITIES),
    category: clampOptional<MaintenanceCategory>(f.Category, MAINTENANCE_CATEGORIES),
    // Derived, not picked — but read back as stored so a row written by
    // something other than ARC still shows what it says.
    taskType: maintenanceTaskTypeFor(scheduleRef?.lookupId ?? null),
    dueStatus: clampOptional<MaintenanceDueStatus>(f.DueStatus, MAINTENANCE_DUE_STATUSES),
    startDate: parseSpDateOnly(f.StartDate),
    dueDate: parseSpDateOnly(f.DueDate),
    completedDate: parseSpDateOnly(f.CompletedDate),
    equipment: lookupRef(f.EquipmentRef, f.EquipmentRefLookupId),
    scheduleRef,
    operationsTaskRef: lookupRef(f.OperationsTaskReference, f.OperationsTaskReferenceLookupId),
    assigned: personOrLookup(f.Assigned, f.AssignedLookupId),
    reportedBy: personOrLookup(f.ReportedBy, f.ReportedByLookupId),
    completedBy: personOrLookup(f.CompletedBy, f.CompletedByLookupId),
    watchers: parsePeople(f.Watchers),
    techNotes: text(f.TechNotes),
    failureCause: text(f.FailureCause),
    resolution: text(f.Resolution),
    partsUsed: text(f.PartsUsed),
    laborHours: readNumber(f.LaborHours),
    downtimeHours: readNumber(f.DowntimeHours),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    // Created/Modified are full timestamps, NOT date-only columns — read
    // through parseSpDate, never parseSpDateOnly, whose midday pivot would
    // shift an afternoon edit onto the following day.
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
 * `TaskType`, decided by ARC and never by a user.
 *
 * A work order raised off a PM schedule is Regular Maintenance; one somebody
 * raised themselves is a Request. Making it a picker would let the two
 * disagree with `ScheduledMaintenanceRef`, which is the column that actually
 * decides it — and the reporting people run off this list groups by TaskType.
 */
export function maintenanceTaskTypeFor(
  scheduleLookupId: number | null | undefined,
): MaintenanceTaskType {
  return scheduleLookupId ? "Regular Maintenance" : "Request";
}

/**
 * Fill in the three person columns from the site's user directory. Mutates in
 * place, like `attachFaitPeople`.
 */
export function attachMaintenanceTaskPeople(
  tasks: MaintenanceTask[],
  siteUsers: Map<number, Person>,
): void {
  for (const t of tasks) {
    t.assigned = fillPerson(t.assigned, siteUsers);
    t.reportedBy = fillPerson(t.reportedBy, siteUsers);
    t.completedBy = fillPerson(t.completedBy, siteUsers);
    t.watchers = fillPeople(t.watchers, siteUsers);
  }
}

/**
 * Resolve the three lookup titles against the lists they point at. Mutates in
 * place — the same "join after the fact" step `listOperationsTasks` does,
 * because Graph returns these as ids with no titles attached.
 */
export function attachMaintenanceTaskReferences(
  tasks: MaintenanceTask[],
  equipment: Array<Equipment | ProjectReference>,
  schedules: ScheduledMaintenance[],
  operationsTasks: ProjectReference[],
): void {
  const equipmentById = new Map(
    equipment.map((e) => [e.lookupId, { title: "name" in e ? e.name : e.title }]),
  );
  const schedulesById = new Map(schedules.map((s) => [s.id, { title: s.title }]));
  const opsById = new Map(operationsTasks.map((t) => [t.lookupId, { title: t.title }]));

  for (const t of tasks) {
    t.equipment = attachLookupTitle(t.equipment, equipmentById);
    t.scheduleRef = attachLookupTitle(t.scheduleRef, schedulesById);
    t.operationsTaskRef = attachLookupTitle(t.operationsTaskRef, opsById);
  }
}

/**
 * The create payload.
 *
 * Blank text columns are omitted — on a create SharePoint would rather not
 * hear about a column than be handed an empty string. `DueStatus` is omitted
 * ALWAYS: that column belongs to a Power Automate flow, and a value written
 * here would be overwritten by it anyway while looking to a reader as though
 * ARC had decided the answer.
 */
export function buildMaintenanceTaskCreateFields(
  input: MaintenanceTaskInput,
  woNumber: string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.title.trim(),
    Status: input.status ?? "Backlog",
    // Derived from the schedule reference, never from the input.
    TaskType: maintenanceTaskTypeFor(input.scheduleLookupId),
  };
  if (woNumber) fields.WONumber = woNumber;
  if (input.description?.trim()) fields.Description = input.description;
  if (input.techNotes?.trim()) fields.TechNotes = input.techNotes;
  if (input.priority) fields.Priority = input.priority;
  if (input.category) fields.Category = input.category;
  if (input.startDate) fields.StartDate = toSpDateOnly(input.startDate);
  if (input.dueDate) fields.DueDate = toSpDateOnly(input.dueDate);
  // Single lookups: a BARE integer. `multiLookupField`'s annotated shape is
  // for multi-value columns and 400s on these.
  if (input.equipmentLookupId) fields.EquipmentRefLookupId = input.equipmentLookupId;
  if (input.scheduleLookupId) fields.ScheduledMaintenanceRefLookupId = input.scheduleLookupId;
  if (input.operationsTaskLookupId) {
    fields.OperationsTaskReferenceLookupId = input.operationsTaskLookupId;
  }
  return fields;
}

/** What to call a work order. The WO number leads; the title is the fallback. */
export function maintenanceTaskLabel(task: MaintenanceTask): string {
  const wo = task.woNumber.trim();
  const title = task.title.trim();
  if (wo && title) return `${wo} — ${title}`;
  return wo || title || `Work order #${task.id}`;
}

/** Newest first, the order every list view wants. */
export function compareMaintenanceTasks(a: MaintenanceTask, b: MaintenanceTask): number {
  const diff = b.createdAt.getTime() - a.createdAt.getTime();
  return diff !== 0 ? diff : b.id - a.id;
}

/** Everyone already on a work order — the @-mention picker's starting point. */
export function collectMaintenanceTaskPeople(tasks: MaintenanceTask[]): Person[] {
  const out: Person[] = [];
  for (const t of tasks) {
    for (const p of [t.assigned, t.reportedBy, t.completedBy, ...t.watchers]) {
      if (p) out.push(p);
    }
  }
  return out;
}

/** A work order's status counts as finished — no more work is expected on it. */
export function isMaintenanceTaskClosed(task: MaintenanceTask): boolean {
  return task.status === "Complete" || task.status === "Canceled";
}
