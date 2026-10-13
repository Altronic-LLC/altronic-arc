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

// =============================================================================
// Changing a task's project, or its title, AFTER it exists (BusinessIT#33).
//
// The number is the app's, so when either half it is built from changes, the
// app rewrites it — a task moved from 0017 to 0042 still reading
// `T3-0017-…` is a number that lies about where the task lives.
//
//   - A NEW PROJECT gets a new number: the next one in that project.
//   - A NEW TITLE keeps the number and replaces only the text after it.
// =============================================================================

const NUMBER_RE = /^T(\d+)-/;

/** The project code a task number carries: first 4 chars of the title, "0000" with none. */
export function taskProjectCode(project: ProjectReference | null): string {
  return project?.title.slice(0, 4) ?? "0000";
}

/**
 * The auto-numbered prefix of `task.numberedTitle` — `T3-0017-` — or null
 * when it doesn't start with one (a legacy row typed by hand). The code is
 * matched against the task's own project first, because a project code can
 * itself contain a dash; failing that, the 4 characters after `T{n}-`.
 */
export function numberedTitlePrefix(task: Pick<Task, "numberedTitle" | "parentProject">): string | null {
  const numbered = task.numberedTitle ?? "";
  const m = NUMBER_RE.exec(numbered);
  if (!m) return null;
  const head = m[0];
  const rest = numbered.slice(head.length);
  const code = taskProjectCode(task.parentProject);
  if (rest.startsWith(`${code}-`)) return `${head}${code}-`;
  if (rest.length >= 5 && rest[4] === "-") return `${head}${rest.slice(0, 5)}`;
  return null;
}

/**
 * `NumberedTitle` after the plain title changes — the same prefix, the new
 * text after it. Null when the stored value has no recognisable prefix, in
 * which case the caller leaves it alone rather than inventing a number.
 */
export function retitledNumberedTitle(
  task: Pick<Task, "numberedTitle" | "parentProject">,
  title: string,
): string | null {
  const prefix = numberedTitlePrefix(task);
  return prefix === null ? null : `${prefix}${title}`;
}

/**
 * The sequence number a task MOVING INTO `project` gets: one past the highest
 * already used there, and never below the count + 1 a new task would get.
 *
 * Highest rather than count alone, because count + 1 hands out a number that
 * is already taken the moment a task in that project has been deleted or
 * moved out — the Operations task list paid for that with four duplicate
 * numbers (see operationsTaskNumbering.ts). `excludeId` is the task being
 * moved, so its own row never counts toward the project it is leaving or
 * joining.
 */
export function nextTaskSequence(
  project: ProjectReference | null,
  allTasks: readonly Task[],
  excludeId?: number,
): number {
  const inProject = allTasks.filter(
    (t) =>
      t.id !== excludeId &&
      (project ? t.parentProject?.lookupId === project.lookupId : !t.parentProject),
  );
  let highest = 0;
  for (const t of inProject) {
    const m = NUMBER_RE.exec(t.numberedTitle ?? "");
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  }
  return Math.max(highest, inProject.length) + 1;
}

/** `NumberedTitle` for `task` once it belongs to `project`, carrying `title`. */
export function renumberedTitle(
  task: Pick<Task, "id">,
  title: string,
  project: ProjectReference | null,
  allTasks: readonly Task[],
): string {
  const n = nextTaskSequence(project, allTasks, task.id);
  return `T${n}-${taskProjectCode(project)}-${title}`;
}
