import type { Filters } from "@/components/FilterBar";
import type { OperationsStatus, OperationsTask, Person } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "./itemSearch";

export type OperationsStatusFilter = OperationsStatus | "ALL_ACTIVE" | null;

/** Terminal statuses excluded from "ALL_ACTIVE" — Operations has two (Complete, Canceled) vs. Engineering's one. */
const TERMINAL_STATUSES: OperationsStatus[] = ["Complete", "Canceled"];

/**
 * Collect the unique set of people who appear on any Operations task
 * (the single assignee, plus watchers). Mirrors `collectPeople` in
 * taskFilters.ts, adapted for `assigned` being `Person | null` here instead
 * of `Person[]`.
 */
export function collectOperationsPeople(tasks: OperationsTask[]): Person[] {
  const map = new Map<string, Person>();
  for (const t of tasks) {
    const people = t.assigned ? [t.assigned, ...t.watchers] : t.watchers;
    for (const p of people) {
      const key = p.email ?? p.displayName;
      if (!map.has(key)) map.set(key, p);
    }
  }
  return [...map.values()];
}

/**
 * Apply the shared FilterBar filters (and optionally a status filter) to an
 * Operations task list. Mirrors `applyFilters` in taskFilters.ts.
 */
export function applyOperationsFilters(
  tasks: OperationsTask[],
  statusFilter: OperationsStatusFilter,
  filters: Filters,
): OperationsTask[] {
  // Tokenize once per call, not once per task — see lib/itemSearch.ts.
  const searchTokens = tokenizeQuery(filters.search);
  return tasks.filter((t) => {
    if (statusFilter === "ALL_ACTIVE" && TERMINAL_STATUSES.includes(t.status)) return false;
    if (statusFilter && statusFilter !== "ALL_ACTIVE" && t.status !== statusFilter) return false;

    if (filters.projectIds.length > 0) {
      const ppid = t.parentProject?.lookupId;
      if (ppid == null || !filters.projectIds.includes(ppid)) return false;
    }

    if (filters.assignedEmails.length > 0) {
      const key = t.assigned ? t.assigned.email ?? t.assigned.displayName : null;
      if (!key || !filters.assignedEmails.includes(key)) return false;
    }

    if (filters.createdByEmail) {
      const candidates = t.assigned ? [t.assigned, ...t.watchers] : t.watchers;
      const has = candidates.some(
        (p) => (p.email ?? p.displayName) === filters.createdByEmail,
      );
      if (!has) return false;
    }

    if (!matchesSearch(t, searchTokens)) return false;

    return true;
  });
}
