import type { OperationsTask, ProjectReference } from "@/types/task";

// =============================================================================
// Operations task numbering — the app owns the `TaskNumber` column (it is NOT
// a SharePoint calculated field). Format: `Task {code}-{n}` where `code` is
// the 4-digit project code (first 4 chars of the Operations Projects title,
// "0000" when the task has no project) and
//
//   n = (highest n already used under that code) + 1
//
// NOT count-of-tasks-in-project + 1, which this was from 2026-08-17 (inferred
// from two data points). A count slips backwards the moment a task is deleted
// and never sees the legacy numbers (items up to ID 198 carry n = item ID),
// so it handed numbers out twice: three live collisions by 2026-10-07
// (Task 0000-11, 0000-12, 0002-8) and a fourth (0000-13) the same afternoon.
// The list now has "Enforce unique values" on TaskNumber, so a repeat is
// rejected by SharePoint instead of silently created; highest+1 never repeats
// as long as the caller passes the whole list.
//
// The match is on the NUMBER STRING's code, not on parentProject.lookupId:
// uniqueness is a property of the string, and a task moved between projects
// keeps its number.
// =============================================================================

const TASK_NUMBER_RE = /^\s*Task\s+(\d{4})-(\d+)\s*$/i;

/** 4-digit project code used in task numbers: "0035" for "0035-Aqueous …", "0000" with no project. */
export function operationsProjectCode(project: ProjectReference | null): string {
  return project?.title.slice(0, 4) ?? "0000";
}

/** Highest n already used under `code` across `allTasks` (0 when none). */
export function highestOperationsTaskNumber(
  code: string,
  allTasks: readonly OperationsTask[],
): number {
  let max = 0;
  for (const t of allTasks) {
    const m = TASK_NUMBER_RE.exec(t.taskNumber ?? "");
    if (!m || m[1] !== code) continue;
    const n = parseInt(m[2], 10);
    if (n > max) max = n;
  }
  return max;
}

/**
 * Compute the `TaskNumber` for a NEW task under `project`: one past the
 * highest number already used under that project's code in `allTasks`. Pass
 * `null` for an unparented task (the "0000" code).
 */
export function computeOperationsTaskNumber(
  project: ProjectReference | null,
  allTasks: readonly OperationsTask[],
): string {
  const code = operationsProjectCode(project);
  return `Task ${code}-${highestOperationsTaskNumber(code, allTasks) + 1}`;
}
