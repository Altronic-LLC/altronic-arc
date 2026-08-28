import type {
  Equipment,
  MaintenanceStatus,
  MaintenanceTask,
  Person,
  ProjectReference,
} from "@/types/task";
import { MAINTENANCE_STATUSES } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "./itemSearch";
import { personKey } from "./people";
import { daysUntilDue } from "./maintenanceSchedule";
import { compareMaintenanceTasks, isMaintenanceTaskClosed } from "./maintenanceTaskMapper";

// =============================================================================
// Pure filter / sort / count predicates for the work-order surface.
//
// No React and no URL in here, for the same reason `eirFilters.ts` and
// `operationsTaskFilters.ts` are pure: the list and the board are two views of
// ONE filtered set, and two copies of a filter is how a fix reaches only one
// of them. `hooks/useMaintenanceFilters.ts` owns the URL half.
//
// One thing that is NOT like the other departments: a work order has no
// department column of its own. Department is a property of the ASSET, so
// filtering by it needs the equipment register alongside the work orders —
// which is why `applyMaintenanceFilters` takes an equipment→department map
// rather than reading something off the task.
// =============================================================================

/**
 * The Assigned filter's "nobody" option.
 *
 * A real sentinel rather than "no selection", because on a shop floor
 * "unassigned" is the single most useful thing to filter TO — it is the list
 * of jobs nobody has picked up — and "no selection" already means "anyone".
 * Namespaced so it can't collide with a real personKey (an email).
 */
export const UNASSIGNED_FILTER_KEY = "__unassigned__";

export interface MaintenanceFilters {
  search: string;
  /** Equipment lookupIds. Empty = every asset. */
  equipmentIds: number[];
  /** `personKey` values, plus possibly `UNASSIGNED_FILTER_KEY`. Empty = anyone. */
  assignedEmails: string[];
  /** `Category` choice values. Empty = every category. */
  categories: string[];
  /** Equipment `Department` values. Empty = every department. */
  departments: string[];
}

export const EMPTY_MAINTENANCE_FILTERS: MaintenanceFilters = {
  search: "",
  equipmentIds: [],
  assignedEmails: [],
  categories: [],
  departments: [],
};

/**
 * The status pill's selection.
 *
 * "ALL_OPEN" is the default the list lands on — Complete and Canceled are
 * history, and a work-order list that leads with two hundred closed jobs
 * buries the handful that need doing today.
 */
export type MaintenanceStatusFilter = MaintenanceStatus | "ALL_OPEN" | null;

/** Statuses that mean the job is finished with. */
const CLOSED_STATUSES: MaintenanceStatus[] = ["Complete", "Canceled"];

/** Every asset's owning department, keyed by lookupId. */
export function departmentByEquipment(equipment: Equipment[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const asset of equipment) {
    if (asset.department) out.set(asset.lookupId, asset.department);
  }
  return out;
}

/** The distinct departments present in the register, sorted — the filter's options. */
export function maintenanceDepartmentOptions(equipment: Equipment[]): string[] {
  const seen = new Set<string>();
  for (const asset of equipment) {
    if (asset.department) seen.add(asset.department);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Everyone who appears on any work order — assignee, reporter, whoever
 * completed it, and the watchers. The Assigned filter's options come from the
 * ITEMS rather than the directory, the same as every other list view's filter
 * bar (see "Two funnels, not one" in CLAUDE.md).
 */
export function collectMaintenancePeople(tasks: MaintenanceTask[]): Person[] {
  const map = new Map<string, Person>();
  for (const t of tasks) {
    for (const p of [t.assigned, t.reportedBy, t.completedBy, ...t.watchers]) {
      if (!p) continue;
      const key = personKey(p);
      if (!map.has(key)) map.set(key, p);
    }
  }
  return [...map.values()];
}

/**
 * The assets that actually carry work orders, deduped.
 *
 * Deliberately NOT the whole 378-row register: the filter exists to narrow
 * what is on screen, and offering 350 assets with nothing against them makes
 * finding the one that has work harder, not easier.
 */
export function collectMaintenanceEquipment(tasks: MaintenanceTask[]): ProjectReference[] {
  const map = new Map<number, ProjectReference>();
  for (const t of tasks) {
    if (!t.equipment) continue;
    const existing = map.get(t.equipment.lookupId);
    // Prefer whichever copy carries a resolved title — a lookup can come back
    // title-less and be filled in later (see lib/maintenanceShared.ts).
    if (!existing || (!existing.title && t.equipment.title)) map.set(t.equipment.lookupId, t.equipment);
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Apply the filter bar (and optionally the status pill) to a work-order list.
 *
 * `departments` is the equipment→department map from `departmentByEquipment`.
 * When the Department filter is set and no map is supplied, nothing matches —
 * refusing to guess is right here: silently ignoring the filter would show a
 * user every department while their picked one sat highlighted above.
 */
export function applyMaintenanceFilters(
  tasks: MaintenanceTask[],
  statusFilter: MaintenanceStatusFilter,
  filters: MaintenanceFilters,
  departments?: Map<number, string>,
): MaintenanceTask[] {
  // Tokenize once per call, not once per task — see lib/itemSearch.ts.
  const searchTokens = tokenizeQuery(filters.search);
  const wantedAssignees = filters.assignedEmails.map((e) => e.toLowerCase());
  const wantsUnassigned = wantedAssignees.includes(UNASSIGNED_FILTER_KEY);

  return tasks.filter((t) => {
    if (statusFilter === "ALL_OPEN" && CLOSED_STATUSES.includes(t.status)) return false;
    if (statusFilter && statusFilter !== "ALL_OPEN" && t.status !== statusFilter) return false;

    if (filters.equipmentIds.length > 0) {
      const id = t.equipment?.lookupId;
      if (id == null || !filters.equipmentIds.includes(id)) return false;
    }

    if (wantedAssignees.length > 0) {
      const key = t.assigned ? personKey(t.assigned) : null;
      const matched = key ? wantedAssignees.includes(key) : wantsUnassigned;
      if (!matched) return false;
    }

    if (filters.categories.length > 0) {
      if (!t.category || !filters.categories.includes(t.category)) return false;
    }

    if (filters.departments.length > 0) {
      const id = t.equipment?.lookupId;
      const dept = id != null ? departments?.get(id) : undefined;
      if (!dept || !filters.departments.includes(dept)) return false;
    }

    if (!matchesSearch(t, searchTokens)) return false;

    return true;
  });
}

/** Count per status, over the FULL set — the pills must never lie about what exists. */
export function countMaintenanceByStatus(
  tasks: MaintenanceTask[],
): Record<MaintenanceStatus, number> {
  const out = {} as Record<MaintenanceStatus, number>;
  for (const s of MAINTENANCE_STATUSES) out[s] = 0;
  for (const t of tasks) out[t.status]++;
  return out;
}

/** How many are still open — anything not Complete or Canceled. */
export function countOpenMaintenance(tasks: MaintenanceTask[]): number {
  return tasks.filter((t) => !isMaintenanceTaskClosed(t)).length;
}

/**
 * Whole days until this work order's due date — negative when it is late,
 * null when it has no due date.
 *
 * Routed through `daysUntilDue` rather than re-deriving the arithmetic: that
 * function already handles the midday-UTC storage convention every date-only
 * SharePoint column uses, and one copy of a date calculation is the whole
 * point of lib/maintenanceSchedule.ts.
 */
export function daysUntilWorkOrderDue(
  task: MaintenanceTask,
  now: Date = new Date(),
): number | null {
  if (!task.dueDate) return null;
  return daysUntilDue(
    {
      frequencyInterval: null,
      frequencyUnit: null,
      scheduleBasis: null,
      firstDueDate: null,
      nextDueDate: task.dueDate,
      lastCompleted: null,
      graceDays: null,
      leadTimeDays: null,
      active: true,
    },
    now,
  );
}

/**
 * Late, and still open.
 *
 * A closed work order is never overdue however long ago its due date went
 * past — it got done. Marking history red would make every finished job on
 * the list shout for attention it doesn't need.
 */
export function isWorkOrderOverdue(task: MaintenanceTask, now: Date = new Date()): boolean {
  if (isMaintenanceTaskClosed(task)) return false;
  const days = daysUntilWorkOrderDue(task, now);
  return days !== null && days < 0;
}

/**
 * The order the list renders in.
 *
 * NOT newest-first, unlike the Operations task list. A work-order list is a
 * QUEUE — what matters is what is due, not what was raised most recently — so
 * open work leads, soonest due first (which puts the overdue jobs at the very
 * top), then anything with no due date, then the closed ones newest-first as
 * a history tail.
 */
export function sortMaintenanceTasks(tasks: MaintenanceTask[]): MaintenanceTask[] {
  return [...tasks].sort((a, b) => {
    const aClosed = isMaintenanceTaskClosed(a);
    const bClosed = isMaintenanceTaskClosed(b);
    if (aClosed !== bClosed) return aClosed ? 1 : -1;

    if (!aClosed) {
      const aDue = a.dueDate ? a.dueDate.getTime() : null;
      const bDue = b.dueDate ? b.dueDate.getTime() : null;
      if (aDue !== bDue) {
        if (aDue === null) return 1;
        if (bDue === null) return -1;
        return aDue - bDue;
      }
    }

    return compareMaintenanceTasks(a, b);
  });
}
