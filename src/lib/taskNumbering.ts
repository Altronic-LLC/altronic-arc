import type { ProjectReference, Task } from "@/types/task";

// =============================================================================
// Task numbering — the app owns the `NumberedTitle` column (it is NOT a
// SharePoint calculated field; see the project-task-numbering memory + the
// data-model table in CLAUDE.md).
//
// Format: `T{n}-{projectRef}-{title}` where
//   - n         = (count of tasks already under the chosen project) + 1
//   - projectRef = first 4 chars of the project title (the 0000-style code),
//                  or "0000" when the task has no parent project.
//
// One source of truth so the TaskFormModal and the EIR→Task promotion flow
// number tasks identically.
// =============================================================================

/**
 * Compute the `NumberedTitle` for a NEW task under `project`, counting
 * existing tasks in `allTasks` that already belong to that project. Pass
 * `null` for an unparented task (counts tasks with no parent project).
 */
export function computeNumberedTitle(
  title: string,
  project: ProjectReference | null,
  allTasks: Task[],
): string {
  const tasksInProject = project
    ? allTasks.filter((t) => t.parentProject?.lookupId === project.lookupId)
    : allTasks.filter((t) => !t.parentProject);
  const nextN = tasksInProject.length + 1;
  const projectRef = project?.title.slice(0, 4) ?? "0000";
  return `T${nextN}-${projectRef}-${title}`;
}
