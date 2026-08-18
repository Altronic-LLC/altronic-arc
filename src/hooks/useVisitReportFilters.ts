import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { VisitReportFilters } from "@/lib/visitReportFilters";

// =============================================================================
// The Visit Report filters, in the URL.
//
// URL-backed so a filtered view is shareable — and so switching between the
// list and the calendar keeps what you'd narrowed to. `visitReportFilterSearch`
// is the half that does the carrying; without it, the switcher resets the
// filters, which is the exact bug CLAUDE.md records against the task List /
// Kanban links.
// =============================================================================

/** The filter keys carried between views. */
const FILTER_KEYS = ["q", "rm", "year", "reason", "status"] as const;

export function useVisitReportFilters() {
  const [params, setParams] = useSearchParams();

  const filters: VisitReportFilters = useMemo(
    () => ({
      q: params.get("q") ?? "",
      rm: params.get("rm") ?? "",
      year: params.get("year") ?? "",
      reason: params.get("reason") ?? "",
      status: params.get("status") ?? "",
    }),
    [params],
  );

  function setFilter(key: keyof VisitReportFilters, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return { filters, setFilter };
}

/**
 * The filter part of a location's query string, ready to append to the other
 * view's path: `/sales/visit-reports/calendar${visitReportFilterSearch(search)}`.
 *
 * The month the calendar is showing is deliberately NOT carried — it means
 * nothing to the list, and dropping it means the calendar opens on the current
 * month rather than wherever the user last browsed.
 */
export function visitReportFilterSearch(search: string): string {
  const from = new URLSearchParams(search);
  const carried = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = from.get(key);
    // A present-but-empty value carries no meaning here (unlike the task
    // Assigned filter, where empty encodes "Anyone"), so skip the blanks.
    if (value) carried.set(key, value);
  }
  const query = carried.toString();
  return query ? `?${query}` : "";
}
