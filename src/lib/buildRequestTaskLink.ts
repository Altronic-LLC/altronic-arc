import type { BuildRequest, Comment, Person, ProjectReference, Task } from "@/types/task";
import { isMirroredComment } from "./commentMirror";
import { commentKey } from "./eirTaskBackfill";
import { computeNumberedTitle } from "./taskNumbering";

// =============================================================================
// Linking a Build Request to an Engineering task — BusinessIT#58.
//
// A build request raised from the Build Requests list had no task, so the
// people working from tasks never saw it (Matthew Traina / Ray White). Tim's
// decisions, 2026-11-02:
//
//  - A NEW build request must name a task: pick one, or "Create a task for
//    this", which creates it in the build request's project.
//  - Engineering tasks only, for now.
//  - Anyone signed in may link or re-link. Re-linking asks first.
//  - Comments made before the link are NOT copied. Each page SHOWS the other
//    record's earlier comments in a read-only panel instead; from the link on,
//    the live mirror copies new comments both ways (lib/commentMirror.ts).
//
// The link is still stored ONCE, on the build request (`TaskReference`) —
// see lib/buildRequestFromTask.ts.
// =============================================================================

/** The picker value meaning "create a new task for this build request". */
export const NEW_TASK_FOR_BUILD_REQUEST = "__new_task__";

export interface TaskLinkOption {
  value: string;
  label: string;
}

/** How a task is named in the picker. */
function optionLabel(task: Task): string {
  const name = task.numberedTitle || task.title || `Task #${task.id}`;
  return task.status === "Complete" ? `${name} (Complete)` : name;
}

/**
 * The tasks a build request can be linked to, best first:
 *
 *  1. open tasks in one of the build request's projects;
 *  2. open tasks anywhere else;
 *  3. Complete tasks — still offered, since a build can follow work that has
 *     been closed, but never above an open one.
 *
 * Newest first within each group. Every task stays reachable: the picker
 * searches, so ordering only decides what is on screen before anyone types.
 */
export function taskLinkOptions(
  tasks: readonly Task[],
  projectIds: readonly number[],
): TaskLinkOption[] {
  const inProject = new Set(projectIds);
  const rank = (t: Task): number => {
    if (t.status === "Complete") return 2;
    return t.parentProject && inProject.has(t.parentProject.lookupId) ? 0 : 1;
  };
  return [...tasks]
    .sort((a, b) => rank(a) - rank(b) || b.id - a.id)
    .map((t) => ({ value: String(t.id), label: optionLabel(t) }));
}

/** The fields of a task created for a new build request. */
export interface TaskForBuildRequest {
  title: string;
  numberedTitle: string;
  description: string;
  parentProjectLookupId: number;
  assigned: Person[];
}

/**
 * The task "Create a task for this" makes, or the reason it can't yet.
 *
 * It needs a PROJECT: a task's number is `T{n}-{project code}-{title}`, and
 * with no project the code falls back to "0000", which reads as a real
 * project (the PromoteEirModal lesson). The first of the build request's
 * projects is used.
 *
 * The build request's engineer, if one was picked, is assigned — that is the
 * person the build request already names for the work.
 */
export function taskForBuildRequest(args: {
  title: string;
  brNo: string;
  project: ProjectReference | null;
  engineer: Person | null;
  allTasks: readonly Task[];
}): TaskForBuildRequest | { problem: string } {
  const title = args.title.trim();
  if (!title) return { problem: "Name the product or project first — the new task takes that name." };
  if (!args.project) {
    return {
      problem: "Pick a project reference first — the new task is numbered within its project.",
    };
  }
  return {
    title,
    numberedTitle: computeNumberedTitle(title, args.project, [...args.allTasks]),
    description: `Created for build request ${args.brNo}.`,
    parentProjectLookupId: args.project.lookupId,
    assigned: args.engineer ? [args.engineer] : [],
  };
}

/** True when a build request names no task. */
export function isUnlinkedBuildRequest(br: Pick<BuildRequest, "taskReferenceLookupId">): boolean {
  return br.taskReferenceLookupId == null;
}

/** The note ARC writes at the top of a build request raised from a task. */
const RAISED_FROM_TASK = /^\s*<p><em>Raised from task /i;

/**
 * The comments on the OTHER record of a task ⇄ build request pair that this
 * record hasn't got — in practice, the ones made before the two were linked.
 *
 * Once linked, every new comment is copied both ways by the live mirror, so
 * those are already here and must not show twice. Left out:
 *
 *  - **copies** (a mirror banner) — they came from somewhere else;
 *  - **ARC's "Raised from task" note** — it is about the link itself;
 *  - **anything already here**, matched by `commentKey`: the same author
 *    saying the same words. Time is not part of the match, because a copy is
 *    stamped when it was copied — and the discussion a build request carried
 *    over when it was raised from a task matches the same way.
 *
 * Newest first, like every thread.
 */
export function earlierLinkedComments(
  other: readonly Comment[],
  here: readonly Comment[],
): Comment[] {
  const present = new Set(here.map(commentKey));
  return other
    .filter((c) => !isMirroredComment(c.bodyHtml))
    .filter((c) => !RAISED_FROM_TASK.test(c.bodyHtml))
    .filter((c) => !present.has(commentKey(c)))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
