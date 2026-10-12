import type { Filters } from "@/components/FilterBar";
import type { OperationsTask, Person, Task } from "@/types/task";
import { applyFilters, collectPeople } from "./taskFilters";
import { applyOperationsFilters, collectOperationsPeople } from "./operationsTaskFilters";
import { mergePeople } from "./people";
import { dayLabel, type SortColumn } from "./tableSort";

// =============================================================================
// Engineering + Operations tasks in ONE list — the "both departments" scope on
// the Operations AND Engineering task lists (BusinessIT#39, Tim, 2026-10-12):
// for the people who work in both systems on a regular basis.
//
// The two lists are different SharePoint lists on different sites, with
// different status sets, different project lists and a different assignee
// shape (Task.assigned is Person[], OperationsTask.assigned is Person | null).
// This module is the only place that reconciles them; the view only ever sees
// `CombinedTask`.
//
// Deliberately READ-ONLY: a row opens its own task's detail page, where every
// edit goes through that list's own hooks and permissions. Nothing here writes.
// =============================================================================

/**
 * Which tasks a department's task list shows: its `own` list (the default) or
 * `all` — both departments. Lives in the URL as `?scope=all`.
 */
export type TaskScope = "own" | "all";

export const TASK_SCOPE_PARAM = "scope";

/** Anything but the literal `all` is the department's own list — the default. */
export function readTaskScope(raw: string | null): TaskScope {
  return raw === "all" ? "all" : "own";
}

/** `search` with the scope set (or removed, for the default). */
export function withTaskScope(search: URLSearchParams, scope: TaskScope): URLSearchParams {
  const out = new URLSearchParams(search);
  if (scope === "all") out.set(TASK_SCOPE_PARAM, "all");
  else out.delete(TASK_SCOPE_PARAM);
  return out;
}

export const COMBINED_DEPARTMENTS = ["Engineering", "Operations"] as const;
export type CombinedDepartment = (typeof COMBINED_DEPARTMENTS)[number];

export type CombinedTask =
  | { department: "Engineering"; task: Task }
  | { department: "Operations"; task: OperationsTask };

/**
 * One status vocabulary across both lists. Each row still shows its OWN
 * status badge; the stage is only what the pills count and filter by.
 *
 *   Engineering                              Operations
 *   BACKLOG, SELECTED FOR DEVELOPMENT  →  Not started  ←  Backlog
 *   In Progress                        →  In progress  ←  WIP
 *   On Hold, Blocked                   →  On hold      ←  On Hold
 *   Complete                           →  Complete     ←  Complete
 *                                          Canceled     ←  Canceled
 */
export const TASK_STAGES = ["Not started", "In progress", "On hold", "Complete", "Canceled"] as const;
export type TaskStage = (typeof TASK_STAGES)[number];

/** `ACTIVE` = anything not Complete or Canceled, matching both lists' own Active pill. */
export type TaskStageFilter = TaskStage | "ACTIVE" | null;

export function taskStage(row: CombinedTask): TaskStage {
  if (row.department === "Engineering") {
    switch (row.task.status) {
      case "BACKLOG":
      case "SELECTED FOR DEVELOPMENT":
        return "Not started";
      case "In Progress":
        return "In progress";
      case "On Hold":
      case "Blocked":
        return "On hold";
      case "Complete":
        return "Complete";
    }
  }
  switch (row.task.status) {
    case "Backlog":
      return "Not started";
    case "WIP":
      return "In progress";
    case "On Hold":
      return "On hold";
    case "Complete":
      return "Complete";
    case "Canceled":
      return "Canceled";
  }
  // Both switches are exhaustive, so a status added to either list's union is
  // a COMPILE error here until it's given a stage — never a silent default.
}

export function isActiveStage(stage: TaskStage): boolean {
  return stage !== "Complete" && stage !== "Canceled";
}

/**
 * Item ids are only unique WITHIN a list — task 12 and Operations task 12 are
 * two different things — so anything keyed or tie-broken across both lists
 * goes through this. Operations ids are offset well past any real Engineering
 * id (the Parts List Global Search uses the same trick).
 */
const OPERATIONS_KEY_OFFSET = 10_000_000;

export function combinedTaskKey(row: CombinedTask): number {
  return row.department === "Operations" ? row.task.id + OPERATIONS_KEY_OFFSET : row.task.id;
}

/** The task's own detail page — each department keeps its own. */
export function combinedTaskPath(row: CombinedTask): string {
  return row.department === "Engineering" ? `/task/${row.task.id}` : `/operations/task/${row.task.id}`;
}

export function combineTasks(engineering: Task[], operations: OperationsTask[]): CombinedTask[] {
  return [
    ...engineering.map((task): CombinedTask => ({ department: "Engineering", task })),
    ...operations.map((task): CombinedTask => ({ department: "Operations", task })),
  ];
}

/**
 * Apply the shared FilterBar to both lists and merge the result.
 *
 * The Project filter is IGNORED here: the two lists point at different
 * project lists (Engineering's Projects vs Operations Projects), so a lookup
 * id means a different project on each side. The view hides that control in
 * this scope; clearing it here as well means a `project=` left in the URL from
 * the Operations-only scope can't silently empty the Engineering half.
 */
export function filterCombinedTasks(
  engineering: Task[],
  operations: OperationsTask[],
  filters: Filters,
  department: CombinedDepartment | null,
): CombinedTask[] {
  const withoutProject: Filters = { ...filters, projectIds: [] };
  const eng = department === "Operations" ? [] : applyFilters(engineering, null, withoutProject);
  const ops =
    department === "Engineering" ? [] : applyOperationsFilters(operations, null, withoutProject);
  return combineTasks(eng, ops);
}

export function applyStageFilter(rows: CombinedTask[], filter: TaskStageFilter): CombinedTask[] {
  if (filter === null) return rows;
  if (filter === "ACTIVE") return rows.filter((r) => isActiveStage(taskStage(r)));
  return rows.filter((r) => taskStage(r) === filter);
}

/** Everyone on either list, de-duplicated — the options for the people filters. */
export function collectCombinedPeople(engineering: Task[], operations: OperationsTask[]): Person[] {
  return mergePeople(collectPeople(engineering), collectOperationsPeople(operations));
}

function titleOf(row: CombinedTask): string {
  return row.department === "Engineering" ? row.task.numberedTitle : row.task.title;
}

/**
 * What the "Sort by" picker offers. A card list has no column headers, so
 * these drive the shared `lib/tableSort.ts` engine through a picker instead —
 * the same engine every sortable table in ARC uses.
 */
export const COMBINED_SORT_COLUMNS: SortColumn<CombinedTask>[] = [
  {
    key: "created",
    label: "Created",
    kind: "date",
    value: (r) => dayLabel(r.task.createdAt),
    sortValue: (r) => r.task.createdAt,
  },
  {
    key: "due",
    label: "Due date",
    kind: "date",
    value: (r) => dayLabel(r.task.dueDate),
    sortValue: (r) => r.task.dueDate,
  },
  { key: "title", label: "Title", value: titleOf },
  {
    key: "status",
    label: "Status",
    kind: "number",
    value: (r) => taskStage(r),
    sortValue: (r) => TASK_STAGES.indexOf(taskStage(r)),
  },
  { key: "department", label: "Department", value: (r) => r.department },
];
