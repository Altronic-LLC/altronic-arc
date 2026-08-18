import type { VisitReport } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "./itemSearch";
import { visitYear } from "./visitReportMapper";

// =============================================================================
// Visit Report filtering — pure, shared by BOTH views.
//
// The list and the calendar are two views of ONE filtered set, exactly like
// List/Kanban for tasks and List/Board for EIRs. The predicate lives out here
// for the reason CLAUDE.md records about the EIR pair: two copies of a filter
// is how a fix reaches only one view.
//
// No React and no URL in this file — `hooks/useVisitReportFilters.ts` owns
// those.
// =============================================================================

export interface VisitReportFilters {
  /** Free text, matched across every field. */
  q: string;
  /** Regional manager, exact. */
  rm: string;
  /** Four-digit year of the visit. */
  year: string;
  reason: string;
  status: string;
}

export const EMPTY_VISIT_REPORT_FILTERS: VisitReportFilters = {
  q: "",
  rm: "",
  year: "",
  reason: "",
  status: "",
};

export function applyVisitReportFilters(
  reports: VisitReport[],
  filters: VisitReportFilters,
): VisitReport[] {
  const tokens = tokenizeQuery(filters.q);
  return reports.filter((r) => {
    if (filters.rm && r.rmName !== filters.rm) return false;
    if (filters.year && visitYear(r) !== filters.year) return false;
    if (filters.reason && r.reasonForVisit !== filters.reason) return false;
    if (filters.status && r.customerStatus !== filters.status) return false;
    return matchesSearch(r, tokens);
  });
}

/** True when any filter is narrowing the set — drives the "of N" hint. */
export function hasVisitReportFilters(filters: VisitReportFilters): boolean {
  return Boolean(
    filters.q || filters.rm || filters.year || filters.reason || filters.status,
  );
}

/**
 * The visits on one calendar day, keyed `yyyy-mm-dd` in UTC terms.
 *
 * UTC because that's how a date-only value is held once `parseSpDateOnly` has
 * normalised it — using local getters here would slide a visit into the
 * previous day for anyone west of Greenwich, which is the whole department.
 */
export function visitDayKey(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Group reports by the day they happened. Undated reports are dropped. */
export function groupVisitsByDay(
  reports: VisitReport[],
): Map<string, VisitReport[]> {
  const byDay = new Map<string, VisitReport[]>();
  for (const report of reports) {
    if (!report.visitDate) continue;
    const key = visitDayKey(report.visitDate);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(report);
    else byDay.set(key, [report]);
  }
  return byDay;
}
