import type {
  Equipment,
  MaintenanceStatus,
  MaintenanceTask,
  Person,
  ProjectReference,
} from "@/types/task";
import { MAINTENANCE_STATUSES } from "@/types/task";
import { referenceKey } from "./maintenanceReferences";
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
// Department is read through `maintenanceTaskDepartment`, never off either
// source alone: a work order carries its OWN `DepartmentRef` lookup (raised
// against a light or a leaking pipe, it may have no asset at all), and falls
// back to the department of the asset it names. That is why
// `applyMaintenanceFilters` still takes an equipment→department map — the
// fallback needs it, and half the register has no department set.
//
// **Department is a LOOKUP since 2026-08-28, not a choice column**, so the
// filter selects `referenceKey` values (the lookupId, as a string) rather than
// department NAMES. That is what makes a rename in Admin → Maintenance
// reference lists carry every filtered link and bookmark with it; a name-keyed
// filter would silently match nothing the moment somebody fixed a typo.
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
  /**
   * Department `referenceKey` values — the lookupId as a string. Empty = every
   * department. NOT names; see the note at the top of this file.
   */
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

/** Every asset's owning department, keyed by the ASSET's lookupId. */
export function departmentByEquipment(equipment: Equipment[]): Map<number, ProjectReference> {
  const out = new Map<number, ProjectReference>();
  for (const asset of equipment) {
    if (asset.department) out.set(asset.lookupId, asset.department);
  }
  return out;
}

/**
 * A work order's department: **its own column first, its asset's second.**
 *
 * The work order's value wins even when the asset carries a different one —
 * that is the whole point of the column being independently editable. A job
 * on the harness machine (PROD) raised and done by the panel shop says
 * "Panels", and the filter has to agree with what the form shows.
 *
 * `null` means neither had one; the dashboard's "No department set" bucket
 * and the Department filter both key off that.
 */
export function maintenanceTaskDepartment(
  task: MaintenanceTask,
  byEquipment?: Map<number, ProjectReference>,
): ProjectReference | null {
  if (task.department) return task.department;
  const id = task.equipment?.lookupId;
  return (id != null ? byEquipment?.get(id) : undefined) ?? null;
}

/**
 * The distinct departments to offer in the filter, sorted.
 *
 * Both funnels, not one: the register's departments AND the ones work orders
 * carry themselves. A department that only appears on work orders raised
 * against no asset would otherwise be unselectable — invisible in the
 * dropdown while its rows sat in the list (the "Two funnels, not one" rule in
 * CLAUDE.md, applied to a choice column rather than to people).
 */
export function maintenanceDepartmentOptions(
  equipment: Equipment[],
  tasks: MaintenanceTask[] = [],
): ProjectReference[] {
  // Keyed by `referenceKey`, not by title: two departments can share a name
  // for a moment mid-rename, and a legacy value the reference list has never
  // heard of has no lookupId to key on at all.
  const seen = new Map<string, ProjectReference>();
  const add = (ref: ProjectReference | null) => {
    if (!ref) return;
    const key = referenceKey(ref);
    const existing = seen.get(key);
    // Prefer whichever copy carries a resolved title — a lookup can come back
    // title-less and be filled in later (see lib/maintenanceReferences.ts).
    if (!existing || (!existing.title && ref.title)) seen.set(key, ref);
  };
  for (const asset of equipment) add(asset.department);
  for (const task of tasks) add(task.department);
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
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
 * `departments` is the equipment→department map from `departmentByEquipment`,
 * used only as the FALLBACK for a work order with no department of its own.
 * Without it, such a work order can't be attributed to a department and so
 * matches no department filter — refusing to guess is right here: silently
 * ignoring the filter would show a user every department while their picked
 * one sat highlighted above.
 */
export function applyMaintenanceFilters(
  tasks: MaintenanceTask[],
  statusFilter: MaintenanceStatusFilter,
  filters: MaintenanceFilters,
  departments?: Map<number, ProjectReference>,
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
      // The work order's own Department first, its asset's second — the same
      // rule the dashboard groups by, so the two can't disagree about which
      // bucket a job is in.
      const dept = maintenanceTaskDepartment(t, departments);
      if (!dept || !filters.departments.includes(referenceKey(dept))) return false;
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
