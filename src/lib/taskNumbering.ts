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
  // The old Power App wrote the project NUMBER, not ARC's 4-character code:
  // project `328-MT-SAVES` gives ARC's code `328-`, so ARC numbers
  // `T5-328--title`, while the old app numbered `T1-328-title`. 2,255 of the
  // 3,148 live tasks (2026-10-27) carry that shape, and a prefix this didn't
  // recognise meant a title edit left the list and board showing the old name.
  if (code.endsWith("-") && rest.startsWith(code)) return `${head}${code}`;
  if (rest.length >= 5 && rest[4] === "-") return `${head}${rest.slice(0, 5)}`;
  // Same legacy shape for a task whose project is unknown or has since been
  // renamed: a 3–4 digit number and a dash.
  const legacy = /^\d{3,4}-/.exec(rest);
  if (legacy) return `${head}${legacy[0]}`;
  return null;
}

/**
 * `NumberedTitle` after the plain title changes — the same prefix, the new
 * text after it.
 *
 * A stored value with no recognisable `T{n}-{code}-` prefix gets no number
 * invented for it, but if it ENDS with the old title (a hand-typed or test
 * row, where the two are often identical) that ending is replaced, so the
 * list and board — which show `NumberedTitle` — follow the rename. Null only
 * when neither applies; the caller then leaves the column alone.
 */
export function retitledNumberedTitle(
  task: Pick<Task, "numberedTitle" | "parentProject"> & { title?: string },
  title: string,
): string | null {
  const prefix = numberedTitlePrefix(task);
  if (prefix !== null) return `${prefix}${title}`;
  const numbered = task.numberedTitle ?? "";
  const old = task.title ?? "";
  if (old && numbered.endsWith(old)) return `${numbered.slice(0, numbered.length - old.length)}${title}`;
  return null;
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
