import type { Filters } from "@/components/FilterBar";
import type { Person, Status, Task } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "./itemSearch";

export type StatusFilter = Status | "ALL_ACTIVE" | null;

/**
 * Collect the unique set of people who appear on any task (assignees or
 * watchers). Used to populate the Assigned / Created By dropdowns in
 * FilterBar — the choices are whoever actually shows up in the data.
 */
export function collectPeople(tasks: Task[]): Person[] {
  const map = new Map<string, Person>();
  for (const t of tasks) {
    for (const p of [...t.assigned, ...t.watchers]) {
      const key = p.email ?? p.displayName;
      if (!map.has(key)) map.set(key, p);
    }
  }
  return [...map.values()];
}

/**
 * Apply the FilterBar filters (and optionally a status filter) to a task
 * list. Used by ListView, and now KanbanView, so both views agree on what
 * "filtered" means.
 *
 * The status filter is optional because Kanban implicitly partitions by
 * status (each column is a status), so the caller passes null for kanban.
 */
export function applyFilters(
  tasks: Task[],
  statusFilter: StatusFilter,
  filters: Filters,
): Task[] {
  // Tokenize once per call, not once per task. Multi-keyword AND semantics
  // + quoted phrases + all-fields matching — see lib/itemSearch.ts.
  const searchTokens = tokenizeQuery(filters.search);
  return tasks.filter((t) => {
    if (statusFilter === "ALL_ACTIVE" && t.status === "Complete") return false;
    if (statusFilter && statusFilter !== "ALL_ACTIVE" && t.status !== statusFilter) return false;

    if (filters.projectIds.length > 0) {
      const ppid = t.parentProject?.lookupId;
      if (ppid == null || !filters.projectIds.includes(ppid)) return false;
    }

    if (filters.assignedEmails.length > 0) {
      const has = t.assigned.some((p) => {
        const key = p.email ?? p.displayName;
        return filters.assignedEmails.includes(key);
      });
      if (!has) return false;
    }

    if (filters.createdByEmail) {
      // Created By matches on author's resolved person info if available.
      // Since Task only carries authorLookupId, we match via the assigned/
      // watcher people set as a best-effort fallback when no resolved name
      // is available. This keeps the field useful in mock and real modes
      // alike until a full directory lookup is wired up.
      const candidates = [...t.assigned, ...t.watchers];
      const has = candidates.some(
        (p) => (p.email ?? p.displayName) === filters.createdByEmail,
      );
      if (!has) return false;
    }

    if (!matchesSearch(t, searchTokens)) return false;

    return true;
  });
}
