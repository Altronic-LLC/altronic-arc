import { graphFetch, graphFetchAll } from "./graph";
import {
  SITES,
  SP_MAINTENANCE_TASKS_LIST_ID,
  SP_PMO_SITE_URL,
  USE_MOCK,
} from "./config";
import {
  listSiteUserDirectory,
  resolvePeopleLookupIds,
  resolvePersonLookupId,
} from "./siteUsers";
import type {
  GraphListItem,
  MaintenanceStatus,
  MaintenanceTask,
  MaintenanceTaskInput,
  Person,
} from "@/types/task";
import {
  MAINTENANCE_TASK_SELECT,
  attachMaintenanceTaskPeople,
  attachMaintenanceTaskReferences,
  buildMaintenanceTaskCreateFields,
  compareMaintenanceTasks,
  maintenanceTaskTypeFor,
  toMaintenanceTask,
} from "@/lib/maintenanceTaskMapper";
import { nextWorkOrderNumber } from "@/lib/workOrderNumber";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { toSpDateOnly } from "@/lib/spDates";
import { autoWatchers } from "@/lib/people";
import { listEquipment } from "./operationsEquipment";
import { listScheduledMaintenance } from "./scheduledMaintenance";
import { listOperationsTaskReferences } from "./operationsTasks";
import { MOCK_MAINTENANCE_TASKS } from "@/data/maintenanceMockData";

// =============================================================================
// Altronic Maintenance Tasks — the CMMS work orders, on the PMO site
// (SITES.pmo) alongside the Operations Task List this module is modelled on.
//
// Two rules that are NOT negotiable, both stated again at their call sites:
//
//  1. **ARC never writes `DueStatus`.** A Power Automate flow owns that column
//     and recomputes it. Anything ARC put there would be overwritten while
//     looking, to whoever read it in between, like ARC's own judgement.
//     `stripFlowOwnedColumns` enforces this on every write path rather than
//     trusting each caller to remember.
//  2. **ARC sets `TaskType` itself.** "Regular Maintenance" when the work order
//     carries a `ScheduledMaintenanceRef`, "Request" when it doesn't. It is
//     never offered as a picker, and any write that changes the schedule
//     reference re-derives it in the same PATCH.
//
// **There is no delete.** A work order is the record of work that was done (or
// deliberately not done — that's what the Canceled status is for), and a
// deleted one takes its labour hours, downtime and failure cause with it.
// `maintenanceTasks.test.ts` asserts this module exports nothing matching
// /delete|remove/.
// =============================================================================

const MOCK_STORAGE_KEY = "aets:mock-maintenance-store-v1";

function reviveTask(t: MaintenanceTask): MaintenanceTask {
  return {
    ...t,
    startDate: t.startDate ? new Date(t.startDate) : null,
    dueDate: t.dueDate ? new Date(t.dueDate) : null,
    completedDate: t.completedDate ? new Date(t.completedDate) : null,
    createdAt: new Date(t.createdAt),
    modifiedAt: new Date(t.modifiedAt),
    comments: (t.comments ?? []).map((c) => ({
      ...c,
      timestamp: new Date(c.timestamp),
      attachments: c.attachments ?? [],
    })),
  };
}

function loadMockStoreFromStorage(): MaintenanceTask[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as MaintenanceTask[]).map(reviveTask);
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

let mockStore: MaintenanceTask[] = loadMockStoreFromStorage() ?? MOCK_MAINTENANCE_TASKS.map(reviveTask);

/** Demo-mode-only: clear local data and reset to the bundled seed. */
export function resetMaintenanceMockStore(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(MOCK_STORAGE_KEY);
    } catch {
      // ignored
    }
  }
  mockStore = MOCK_MAINTENANCE_TASKS.map(reviveTask);
}

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_MAINTENANCE_TASKS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_MAINTENANCE_TASKS_LIST_ID is not set.`);
  }
  return SP_MAINTENANCE_TASKS_LIST_ID;
}

function listPath(): string {
  return `/sites/${SITES.pmo}/lists/${requireListId("reach the work orders")}/items`;
}

function itemPath(id: number): string {
  return `${listPath()}/${id}`;
}

/**
 * Columns a Power Automate flow owns. Dropped from every write ARC makes.
 *
 * A guard rather than a comment because there is no error when this goes
 * wrong: SharePoint accepts the value, the flow overwrites it minutes later,
 * and in between the list shows a due status ARC invented.
 */
const FLOW_OWNED_COLUMNS = ["DueStatus"] as const;

export function stripFlowOwnedColumns(fields: Record<string, unknown>): Record<string, unknown> {
  const out = { ...fields };
  for (const column of FLOW_OWNED_COLUMNS) {
    if (column in out) {
      delete out[column];
      console.warn(
        `[maintenanceTasks] Dropped "${column}" from a write — that column is maintained by ` +
          `a Power Automate flow, not by ARC.`,
      );
    }
  }
  return out;
}

/** Resolve a person's PMO lookupId — Graph's directory first, `ensureuser` second. */
function resolveMaintenancePerson(person: Person | null): Promise<Person | null> {
  return resolvePersonLookupId(SITES.pmo, SP_PMO_SITE_URL, person);
}

function resolveMaintenancePeople(people: Person[]): Promise<Person[]> {
  return resolvePeopleLookupIds(SITES.pmo, SP_PMO_SITE_URL, people);
}

/**
 * A person write that was ASKED for and can't be made is REFUSED.
 *
 * The alternative — `resolved?.lookupId ?? null` — is a PATCH that CLEARS the
 * column it was told to set, which SharePoint accepts without complaint. That
 * is exactly how FAIT's three person columns silently lost every assignment
 * until 2026-08-27. Clearing (`person === null`) stays allowed: that one is
 * deliberate.
 */
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

/** Every work order, newest first, with people and lookup titles resolved. */
export async function listMaintenanceTasks(): Promise<MaintenanceTask[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareMaintenanceTasks).map((t) => ({ ...t })));
  }

  // The site-user directory in parallel with the items: Assigned, Reported By
  // and Completed By are all SINGLE person columns and come back as bare
  // lookupIds, so without it every one of them reads as nobody.
  const [items, siteUsers, equipment, schedules, operationsTasks] = await Promise.all([
    graphFetchAll<GraphListItem>(
      `${listPath()}?$expand=fields($select=${MAINTENANCE_TASK_SELECT})&$top=500`,
    ),
    listSiteUserDirectory(SITES.pmo),
    listEquipment(),
    listScheduledMaintenance(),
    listOperationsTaskReferences(),
  ]);
  const tasks = items.map(toMaintenanceTask);
  attachMaintenanceTaskPeople(tasks, siteUsers);
  attachMaintenanceTaskReferences(tasks, equipment, schedules, operationsTasks);
  return tasks.sort(compareMaintenanceTasks);
}

/**
 * One work order, fully resolved.
 *
 * Reads through the list, the same as `getOperationsTask` — the lookup titles
 * and person names need the same three joins whichever way in you come, and a
 * detail page built on a half-resolved record shows "User #46" next to a blank
 * asset name.
 */
export async function getMaintenanceTask(id: number): Promise<MaintenanceTask | null> {
  const all = await listMaintenanceTasks();
  return all.find((t) => t.id === id) ?? null;
}

/** The WO number a new work order would get right now. */
export async function nextMaintenanceWorkOrderNumber(now: Date = new Date()): Promise<string> {
  return nextWorkOrderNumber(await listMaintenanceTasks(), now);
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

/** Patch columns by their SharePoint names. Returns the updated work order. */
export async function updateMaintenanceTaskFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<MaintenanceTask> {
  const safe = stripFlowOwnedColumns(fields);

  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Work order ${id} not found`);
    const next: MaintenanceTask = { ...mockStore[idx], modifiedAt: new Date() };
    applyMockFields(next, safe);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(safe) });
  const reloaded = await getMaintenanceTask(id);
  if (!reloaded) throw new Error(`Work order ${id} disappeared after update`);
  return reloaded;
}

/** Mock-mode equivalent of the PATCH — mirrors the real column names. */
function applyMockFields(next: MaintenanceTask, fields: Record<string, unknown>) {
  const dateOf = (v: unknown) => (v ? new Date(String(v)) : null);
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("Description" in fields) next.description = String(fields.Description ?? "");
  if ("Status" in fields) next.status = fields.Status as MaintenanceTask["status"];
  if ("Priority" in fields) next.priority = (fields.Priority as MaintenanceTask["priority"]) ?? null;
  if ("Category" in fields) next.category = (fields.Category as MaintenanceTask["category"]) ?? null;
  if ("TaskType" in fields) next.taskType = (fields.TaskType as MaintenanceTask["taskType"]) ?? null;
  if ("StartDate" in fields) next.startDate = dateOf(fields.StartDate);
  if ("DueDate" in fields) next.dueDate = dateOf(fields.DueDate);
  if ("CompletedDate" in fields) next.completedDate = dateOf(fields.CompletedDate);
  if ("WONumber" in fields) next.woNumber = String(fields.WONumber ?? "");
  if ("TechNotes" in fields) next.techNotes = String(fields.TechNotes ?? "");
  if ("FailureCause" in fields) next.failureCause = String(fields.FailureCause ?? "");
  if ("Resolution" in fields) next.resolution = String(fields.Resolution ?? "");
  if ("PartsUsed" in fields) next.partsUsed = String(fields.PartsUsed ?? "");
  if ("LaborHours" in fields) next.laborHours = numberOrNull(fields.LaborHours);
  if ("DowntimeHours" in fields) next.downtimeHours = numberOrNull(fields.DowntimeHours);
  if ("Communication" in fields) {
    // The mock store keeps parsed comments, so a raw Communication write is
    // only used by the real branch. Nothing to apply here.
  }
  if ("Assigned" in fields) next.assigned = (fields.Assigned as Person | null) ?? null;
  if ("ReportedBy" in fields) next.reportedBy = (fields.ReportedBy as Person | null) ?? null;
  if ("CompletedBy" in fields) next.completedBy = (fields.CompletedBy as Person | null) ?? null;
  if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
    next.watchers = fields.Watchers as Person[];
  }
  if ("EquipmentRefLookupId" in fields) {
    const v = fields.EquipmentRefLookupId;
    next.equipment = v ? { lookupId: Number(v), title: next.equipment?.title ?? "" } : null;
  }
  if ("ScheduledMaintenanceRefLookupId" in fields) {
    const v = fields.ScheduledMaintenanceRefLookupId;
    next.scheduleRef = v ? { lookupId: Number(v), title: next.scheduleRef?.title ?? "" } : null;
  }
  if ("OperationsTaskReferenceLookupId" in fields) {
    const v = fields.OperationsTaskReferenceLookupId;
    next.operationsTaskRef = v
      ? { lookupId: Number(v), title: next.operationsTaskRef?.title ?? "" }
      : null;
  }
}

function numberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Just the status — the Kanban drag target. */
export async function setMaintenanceTaskStatus(
  id: number,
  status: MaintenanceStatus,
): Promise<MaintenanceTask> {
  return updateMaintenanceTaskFields(id, { Status: status });
}

/** Change the equipment reference (or clear with `null`). A BARE integer. */
export async function setMaintenanceTaskEquipment(
  id: number,
  equipmentLookupId: number | null,
): Promise<MaintenanceTask> {
  return updateMaintenanceTaskFields(id, { EquipmentRefLookupId: equipmentLookupId });
}

/**
 * Change the schedule reference (or clear with `null`).
 *
 * `TaskType` travels in the SAME write: it is derived from this column, and
 * letting the two be set separately is how a "Regular Maintenance" work order
 * ends up with no schedule behind it.
 */
export async function setMaintenanceTaskSchedule(
  id: number,
  scheduleLookupId: number | null,
): Promise<MaintenanceTask> {
  return updateMaintenanceTaskFields(id, {
    ScheduledMaintenanceRefLookupId: scheduleLookupId,
    TaskType: maintenanceTaskTypeFor(scheduleLookupId),
  });
}

/** Change the Operations task reference (or clear with `null`). */
export async function setMaintenanceTaskOperationsTask(
  id: number,
  operationsTaskLookupId: number | null,
): Promise<MaintenanceTask> {
  return updateMaintenanceTaskFields(id, {
    OperationsTaskReferenceLookupId: operationsTaskLookupId,
  });
}

/**
 * The write payload that assigns a work order, in whichever mode is running.
 *
 * Exported because assigning is sometimes only HALF of what a single write
 * does: completing an unassigned work order assigns it to whoever completed it
 * IN THE SAME PATCH (see `useCompleteMaintenanceTask`). Two writes would leave
 * a window where the job is Complete with nobody against it, and a failure
 * between them makes that permanent.
 *
 * The assignee also becomes a watcher — the house rule everywhere in ARC.
 */
export async function buildMaintenanceAssignmentFields(
  person: Person | null,
  currentWatchers: Person[],
): Promise<Record<string, unknown>> {
  const watchers = autoWatchers(currentWatchers, person);
  if (USE_MOCK) return { Assigned: person, Watchers: watchers };
  const resolved = await resolveMaintenancePerson(person);
  requireResolved(person, resolved, "Assigned");
  const resolvedWatchers = await resolveMaintenancePeople(watchers);
  return {
    // A SINGLE person column: a bare integer, never multiPersonField's
    // Collection(Edm.Int32) shape (that annotation is for MULTI-value columns
    // and 400s here).
    AssignedLookupId: resolved?.lookupId ?? null,
    ...multiPersonField("Watchers", resolvedWatchers),
  };
}

/** Assign the work order (or clear with `null`). The assignee also starts watching. */
export async function setMaintenanceTaskAssigned(
  id: number,
  person: Person | null,
): Promise<MaintenanceTask> {
  const current = await getMaintenanceTask(id);
  const fields = await buildMaintenanceAssignmentFields(person, current?.watchers ?? []);
  return updateMaintenanceTaskFields(id, fields);
}

/** Set who reported the work order (or clear with `null`). */
export async function setMaintenanceTaskReportedBy(
  id: number,
  person: Person | null,
): Promise<MaintenanceTask> {
  if (USE_MOCK) return updateMaintenanceTaskFields(id, { ReportedBy: person });
  const resolved = await resolveMaintenancePerson(person);
  requireResolved(person, resolved, "Reported By");
  return updateMaintenanceTaskFields(id, { ReportedByLookupId: resolved?.lookupId ?? null });
}

/** Replace the Watchers list. */
export async function setMaintenanceTaskWatchers(
  id: number,
  people: Person[],
): Promise<MaintenanceTask> {
  if (USE_MOCK) return updateMaintenanceTaskFields(id, { Watchers: people });
  const ensured = await resolveMaintenancePeople(people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateMaintenanceTaskFields(id, multiPersonField("Watchers", ensured));
}

/** Add the given person to the watchers list (if not already there). */
export async function watchMaintenanceTask(
  id: number,
  person: Person,
): Promise<MaintenanceTask> {
  const task = await getMaintenanceTask(id);
  if (!task) throw new Error(`Work order ${id} not found`);
  const key = (person.email ?? person.displayName).toLowerCase();
  const already = task.watchers.some((w) => (w.email ?? w.displayName).toLowerCase() === key);
  if (already) return task;
  return setMaintenanceTaskWatchers(id, [...task.watchers, person]);
}

/** Take the given person off the watchers list. */
export async function unwatchMaintenanceTask(
  id: number,
  person: Person,
): Promise<MaintenanceTask> {
  const task = await getMaintenanceTask(id);
  if (!task) throw new Error(`Work order ${id} not found`);
  const key = (person.email ?? person.displayName).toLowerCase();
  const next = task.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key);
  if (next.length === task.watchers.length) return task;
  return setMaintenanceTaskWatchers(id, next);
}

/**
 * Close a work order out: Status, Completed Date and Completed By in ONE write.
 *
 * Three columns that must agree — a Complete work order with no completion
 * date is unreportable, and one with a date but nobody against it is worse.
 * The caller supplies `completedOn` rather than this reading the clock, so a
 * job finished on Friday and keyed in on Monday records Friday.
 */
export async function completeMaintenanceTask(
  id: number,
  input: {
    completedBy: Person | null;
    completedOn: Date;
    resolution?: string;
    failureCause?: string;
    partsUsed?: string;
    laborHours?: number | null;
    downtimeHours?: number | null;
    /**
     * Extra columns to send in the SAME PATCH — how the completion guard
     * assigns an unassigned work order to whoever is closing it out without
     * a second write. See `buildMaintenanceAssignmentFields`.
     */
    extraFields?: Record<string, unknown>;
  },
): Promise<MaintenanceTask> {
  const extras: Record<string, unknown> = {
    Status: "Complete",
    CompletedDate: toSpDateOnly(input.completedOn),
  };
  if (input.resolution !== undefined) extras.Resolution = input.resolution;
  if (input.failureCause !== undefined) extras.FailureCause = input.failureCause;
  if (input.partsUsed !== undefined) extras.PartsUsed = input.partsUsed;
  if (input.laborHours !== undefined) extras.LaborHours = input.laborHours;
  if (input.downtimeHours !== undefined) extras.DowntimeHours = input.downtimeHours;
  Object.assign(extras, input.extraFields ?? {});

  if (USE_MOCK) {
    return updateMaintenanceTaskFields(id, { ...extras, CompletedBy: input.completedBy });
  }
  const resolved = await resolveMaintenancePerson(input.completedBy);
  requireResolved(input.completedBy, resolved, "Completed By");
  return updateMaintenanceTaskFields(id, {
    ...extras,
    CompletedByLookupId: resolved?.lookupId ?? null,
  });
}

/** Append a comment to the work order's Communication field. */
export async function addMaintenanceComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<MaintenanceTask> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Work order ${id} not found`);
    const next: MaintenanceTask = {
      ...mockStore[idx],
      comments: [
        {
          timestamp: new Date(),
          authorName: comment.authorName,
          authorEmail: comment.authorEmail,
          bodyHtml: comment.bodyHtml,
          attachments: [],
        },
        ...mockStore[idx].comments,
      ],
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateMaintenanceTaskFields(id, { Communication: appendComment(existingRaw, comment) });
}

/** Edit one existing comment, matched on its timestamp + author. */
export async function editMaintenanceComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<MaintenanceTask> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Work order ${id} not found`);
    const targetEmail = target.authorEmail.toLowerCase();
    const next: MaintenanceTask = {
      ...mockStore[idx],
      comments: mockStore[idx].comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        (c.authorEmail ?? "").toLowerCase() === targetEmail
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateMaintenanceTaskFields(id, {
    Communication: replaceComment(existingRaw, target, newBodyHtml),
  });
}

/**
 * Raise a work order.
 *
 * `WONumber` is generated here (`WO-YYYY-####`) unless the caller supplied
 * one, and `TaskType` is derived from the schedule reference — neither is a
 * field a user fills in.
 */
export async function createMaintenanceTask(
  input: MaintenanceTaskInput,
  reportedBy?: Person | null,
): Promise<MaintenanceTask> {
  const existing = await listMaintenanceTasks();
  const woNumber = input.woNumber?.trim() || nextWorkOrderNumber(existing);

  if (USE_MOCK) {
    const now = new Date();
    const equipment = input.equipmentLookupId
      ? existing.find((t) => t.equipment?.lookupId === input.equipmentLookupId)?.equipment ?? {
          lookupId: input.equipmentLookupId,
          title: "",
        }
      : null;
    const scheduleRef = input.scheduleLookupId
      ? existing.find((t) => t.scheduleRef?.lookupId === input.scheduleLookupId)?.scheduleRef ?? {
          lookupId: input.scheduleLookupId,
          title: "",
        }
      : null;
    const task: MaintenanceTask = {
      id: Math.max(0, ...mockStore.map((t) => t.id)) + 1,
      woNumber,
      title: input.title.trim(),
      description: input.description ?? "",
      status: input.status ?? "Backlog",
      priority: input.priority ?? null,
      category: input.category ?? null,
      taskType: maintenanceTaskTypeFor(input.scheduleLookupId),
      dueStatus: null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      completedDate: null,
      equipment,
      scheduleRef,
      operationsTaskRef: input.operationsTaskLookupId
        ? { lookupId: input.operationsTaskLookupId, title: "" }
        : null,
      assigned: input.assigned ?? null,
      reportedBy: reportedBy ?? null,
      completedBy: null,
      watchers: input.watchers ?? [],
      techNotes: input.techNotes ?? "",
      failureCause: "",
      resolution: "",
      partsUsed: "",
      laborHours: null,
      downtimeHours: null,
      comments: [],
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [task, ...mockStore];
    saveMockStoreToStorage();
    return delay(task);
  }

  const fields = buildMaintenanceTaskCreateFields(input, woNumber);

  const assigned = await resolveMaintenancePerson(input.assigned ?? null);
  requireResolved(input.assigned ?? null, assigned, "Assigned");
  if (assigned?.lookupId) fields.AssignedLookupId = assigned.lookupId;

  // Reported By is whoever raised it — never typed, never a picker. Unlike
  // Assigned it is best-effort: a work order that exists with a blank reporter
  // is better than a raised fault that was refused over one column.
  const reporter = await resolveMaintenancePerson(reportedBy ?? null);
  if (reporter?.lookupId) fields.ReportedByLookupId = reporter.lookupId;

  const watchers = await resolveMaintenancePeople(input.watchers ?? []);
  if (watchers.some((p) => p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }

  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({ fields: stripFlowOwnedColumns(fields) }),
  });
  return toMaintenanceTask(created);
}
