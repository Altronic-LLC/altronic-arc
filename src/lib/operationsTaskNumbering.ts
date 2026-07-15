import type { OperationsTask, ProjectReference } from "@/types/task";

// =============================================================================
// Operations task numbering — mirrors taskNumbering.ts's approach (the app
// owns this column; it is NOT a SharePoint calculated field) but a different
// display format matching the list's own `TaskNumber` convention observed in
// live data ("Task 0002-4"), which is `Task {projectRef}-{n}` rather than
// Engineering's `T{n}-{projectRef}-{title}`.
//
// n = (count of tasks already under the chosen project) + 1. Only two live
// data points were available to infer this from, both consistent with this
// formula — worth spot-checking against real usage once live.
// =============================================================================

export function computeOperationsTaskNumber(
  project: ProjectReference | null,
  allTasks: OperationsTask[],
): string {
  const tasksInProject = project
    ? allTasks.filter((t) => t.parentProject?.lookupId === project.lookupId)
    : allTasks.filter((t) => !t.parentProject);
  const nextN = tasksInProject.length + 1;
  const projectRef = project?.title.slice(0, 4) ?? "0000";
  return `Task ${projectRef}-${nextN}`;
}
