import type { BuildRequest, ProjectReference, Task, TaskRef } from "@/types/task";
import { openBuildRequestsForTask } from "./buildRequestFromTask";

// =============================================================================
// Task graph helpers.
//
// `toTask()` in taskMapper.ts handles single-item mapping but can't fill in:
//   - childTasks (need to know all tasks to find children)
//   - parentTask.numberedTitle / parentTask.status (need to look up the parent)
//   - parentProject.title / relatedProjects[].title (need the projects list)
//
// These passes run after the full task list is loaded.
// =============================================================================

/**
 * For each task with a parentTask reference, find that parent in the list
 * and copy its numberedTitle and status onto the TaskRef. Also walks every
 * task and builds the inverse — childTasks — so each parent knows its kids.
 *
 * Mutates the array in place for performance (it's called once per list load).
 */
export function attachTaskRelationships(tasks: Task[]): Task[] {
  const byId = new Map<number, Task>();
  for (const t of tasks) byId.set(t.id, t);

  // First pass — resolve parent task titles and detect cycles.
  for (const task of tasks) {
    if (!task.parentTask) continue;
    const parent = byId.get(task.parentTask.id);
    if (!parent) {
      // Parent doesn't exist (deleted, or out of our scope). Clear the ref.
      task.parentTask = null;
      continue;
    }
    // Detect a self-cycle or simple loop.
    if (parent.id === task.id || isAncestor(task.id, parent, byId)) {
      task.parentTask = null;
      continue;
    }
    task.parentTask = {
      id: parent.id,
      numberedTitle: parent.numberedTitle,
      status: parent.status,
    };
  }

  // Second pass — build childTasks lists on parents.
  for (const task of tasks) task.childTasks = [];
  for (const task of tasks) {
    if (!task.parentTask) continue;
    const parent = byId.get(task.parentTask.id);
    /* v8 ignore next -- defensive: pass 1 already clears parentTask refs that don't resolve */
    if (!parent) continue;
    parent.childTasks.push({
      id: task.id,
      numberedTitle: task.numberedTitle,
      status: task.status,
    });
  }

  // Sort each parent's children for stable display.
  for (const task of tasks) {
    task.childTasks.sort((a, b) => a.id - b.id);
  }

  return tasks;
}

/**
 * Walk up the parent chain from `start` and return true if `targetId` is
 * an ancestor. Used to prevent cycles when attaching parent task refs.
 */
function isAncestor(targetId: number, start: Task, byId: Map<number, Task>): boolean {
  const visited = new Set<number>();
  let cursor: Task | undefined = start;
  while (cursor) {
    if (visited.has(cursor.id)) return true; // existing cycle — treat as ancestor
    visited.add(cursor.id);
    if (cursor.id === targetId) return true;
    if (!cursor.parentTask) return false;
    cursor = byId.get(cursor.parentTask.id);
  }
  return false;
}

/**
 * Resolve `parentProject.title` and each entry of `relatedProjects` against
 * a project directory. Mutates in place.
 *
 * If a project lookup ID doesn't resolve to anything in the directory,
 * the title stays as whatever was there (often an empty string in real mode
 * because Graph doesn't expand lookup titles by default).
 */
export function attachProjectTitles(tasks: Task[], projects: ProjectReference[]): Task[] {
  const byId = new Map<number, ProjectReference>();
  for (const p of projects) byId.set(p.lookupId, p);

  for (const task of tasks) {
    if (task.parentProject) {
      const resolved = byId.get(task.parentProject.lookupId);
      if (resolved && !task.parentProject.title) {
        task.parentProject = { ...task.parentProject, title: resolved.title };
      }
    }
    if (task.relatedProjects.length > 0) {
      task.relatedProjects = task.relatedProjects.map((r) => {
        if (r.title) return r;
        const resolved = byId.get(r.lookupId);
        return resolved ? { ...r, title: resolved.title } : r;
      });
    }
  }

  return tasks;
}

/**
 * Child tasks of `task` that are NOT Complete — the ones blocking it from
 * being marked Complete itself. "Done" means `status === "Complete"`
 * exactly; every other status (including Blocked or On Hold) still counts
 * as open. Returns `[]` for a task with no children, which is never
 * blocked — the gate only applies when there's something to wait on.
 *
 * `task.childTasks` is already populated by `attachTaskRelationships` on
 * every loaded `Task`, so this needs no extra lookup — it's a plain filter.
 */
export function incompleteChildTasks(task: Task): TaskRef[] {
  return task.childTasks.filter((c) => c.status !== "Complete");
}

/**
 * What a completion check needs to know about the task's linked Build
 * Requests. `buildRequests` is the whole loaded list (the link is DERIVED —
 * stored once, on the request; see lib/buildRequestFromTask.ts).
 * `resolving` is true while that list is still loading: the answer isn't
 * "allowed" yet, it's "checking".
 *
 * A list that FAILED to load is passed as `[]` with `resolving: false` —
 * deliberately allowing the completion. Somebody without access to the Build
 * Request list must not be unable to finish any task at all; SharePoint's
 * permissions stay the real boundary.
 */
export interface LinkedBuildRequests {
  buildRequests: readonly BuildRequest[];
  resolving?: boolean;
}

/**
 * Can `task` be marked Complete right now? Two rules, one answer:
 *
 *   - A parent with any open child task cannot (Ray, 2026-09-04: child
 *     tasks were being left open after their parent was marked done).
 *   - A task with an open linked Build Request cannot (BusinessIT#2): the
 *     task isn't done until the build is, and the request is only Complete
 *     once every part on it is Production Complete.
 *
 * Mirrors the CMMS's `completeWorkOrderGate` shape (`{ allowed, hint }`) so
 * every caller — the "Mark Complete" button, the sidebar Status dropdown, a
 * Kanban drag to the Complete column, and the edit form's Status picker —
 * asks the SAME function and can't disagree about the rule or the wording.
 * When both rules block, the hint names both.
 *
 * This is UI-level gating only, same as every other gate in this app
 * (CLAUDE.md — "role-based field-level permissions" / CMMS roles): the real
 * boundary is SharePoint's own list permissions.
 *
 * `linked` is optional so a caller with no Build Request list (a test, a
 * future screen) still gets the child rule — but every real path to Complete
 * passes it.
 *
 * A task already Complete is never re-blocked by this — completing an
 * already-complete task is a no-op the callers already guard separately,
 * and un-completing a parent when a child reopens is a deliberately
 * separate, unbuilt concern.
 */
export function canCompleteTask(
  task: Task,
  linked?: LinkedBuildRequests,
): { allowed: boolean; hint: string } {
  const reasons: string[] = [];

  const open = incompleteChildTasks(task);
  if (open.length === 1) reasons.push("1 child task is still open — finish it first.");
  else if (open.length > 1) reasons.push(`${open.length} child tasks are still open — finish them first.`);

  if (linked?.resolving) {
    reasons.push("Checking the linked build requests…");
  } else if (linked) {
    const openBrs = openBuildRequestsForTask(linked.buildRequests, task.id);
    if (openBrs.length === 1) {
      const br = openBrs[0];
      reasons.push(
        `Build request ${br.brNo || `#${br.id}`} is still ${br.status} — it must be Complete first.`,
      );
    } else if (openBrs.length > 1) {
      reasons.push(
        `${openBrs.length} linked build requests aren't Complete yet (${openBrs
          .map((br) => br.brNo || `#${br.id}`)
          .join(", ")}) — they must be Complete first.`,
      );
    }
  }

  return reasons.length === 0
    ? { allowed: true, hint: "" }
    : { allowed: false, hint: reasons.join(" ") };
}

/**
 * Convenience: would attaching `proposedParentId` create a cycle if applied
 * to `taskId`? Used by the parent-task picker to filter out invalid choices.
 */
export function wouldCreateCycle(
  taskId: number,
  proposedParentId: number,
  tasks: Task[],
): boolean {
  if (taskId === proposedParentId) return true;
  const byId = new Map<number, Task>();
  for (const t of tasks) byId.set(t.id, t);
  const proposed = byId.get(proposedParentId);
  if (!proposed) return false;
  return isAncestor(taskId, proposed, byId);
}
