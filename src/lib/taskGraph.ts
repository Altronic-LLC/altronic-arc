import type { ProjectReference, Task, TaskRef } from "@/types/task";

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
 * Can `task` be marked Complete right now? A parent with any open child
 * cannot — added 2026-09-04 (Ray: child tasks were being left open after
 * their parent was marked done, because nothing stopped it). Mirrors the
 * CMMS's `completeWorkOrderGate` shape (`{ allowed, hint }`) so every
 * caller — the "Mark Complete" button, the sidebar Status dropdown, and a
 * Kanban drag to the Complete column — asks the SAME function and can't
 * disagree about the rule or the wording.
 *
 * This is UI-level gating only, same as every other gate in this app
 * (CLAUDE.md — "role-based field-level permissions" / CMMS roles): the real
 * boundary is SharePoint's own list permissions. There's no `resolving`
 * state here unlike the CMMS gates — `task.childTasks` is already loaded
 * synchronously with the task, nothing to await.
 *
 * A task already Complete is never re-blocked by this — completing an
 * already-complete task is a no-op the callers already guard separately,
 * and un-completing a parent when a child reopens is a deliberately
 * separate, unbuilt concern.
 */
export function canCompleteTask(task: Task): { allowed: boolean; hint: string } {
  const open = incompleteChildTasks(task);
  if (open.length === 0) {
    return { allowed: true, hint: "" };
  }
  return {
    allowed: false,
    hint:
      open.length === 1
        ? "1 child task is still open — finish it first."
        : `${open.length} child tasks are still open — finish them first.`,
  };
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
