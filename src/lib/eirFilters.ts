import type { Eir, EirStatus, Person } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";

// =============================================================================
// Pure EIR filtering — the shared brain behind BOTH the EIRs list and the
// EIRs board. This all used to live privately inside EirsView.tsx; the board
// needs exactly the same predicates, and two copies of a filter is how the
// @-mention pickers ended up fixed in only one place (see CLAUDE.md).
//
// Nothing here touches React or the URL. `useEirFilters` owns the URL side.
// =============================================================================

/** Workflow views (the tabs above the status pills / board columns). */
export type EirView = "all" | "new" | "needs-assigned" | "at-risk" | "ltb";

/**
 * The status pill selection on the list. `ALL_OPEN` = anything not Closed.
 *
 * **Not every view honours it** — see `eirViewIgnoresStatus`. At Risk Parts is
 * a register of every active at-risk part, open or closed, and narrowing it by
 * status hid rows people were looking for.
 */
export type EirStatusFilter = EirStatus | "ALL_OPEN" | null;

/** The filter-bar axes, independent of the view tab and the status pill. */
export interface EirFilters {
  search: string;
  projectIds: number[];
  reporterEmail: string | null;
  engineerEmails: string[];
}

export const EMPTY_EIR_FILTERS: EirFilters = {
  search: "",
  projectIds: [],
  reporterEmail: null,
  engineerEmails: [],
};

export function isOpenEir(status: EirStatus): boolean {
  return status !== "Closed";
}

/**
 * Workflow buckets used by the view tabs:
 *  - "new"            → no project reference AND no engineer assigned
 *  - "needs-assigned" → has a project reference but still no engineer
 *  - "at-risk"        → RiskPart is "Active" (an at-risk part)
 *  - "ltb"            → an LTB (last-time-buy) date is set
 *  - "all"            → everything (no extra predicate)
 */
export function matchesEirView(e: Eir, view: EirView): boolean {
  const noProject = e.parentProjects.length === 0;
  const noEngineer = e.assignedEngineers.length === 0;
  if (view === "new") return noProject && noEngineer;
  if (view === "needs-assigned") return !noProject && noEngineer;
  if (view === "at-risk") return e.riskPart === "Active";
  if (view === "ltb") return e.ltbDate != null;
  return true;
}

/**
 * Apply the filter-bar axes (project / reporter / engineer / search). The
 * view tab and status pill are applied separately by the caller, because
 * both views need the bar-filtered set on its own to compute tab counts.
 *
 * EIR Project Reference is a multi-value Lookup column — same shape as the
 * Tasks Related Projects field — so a project matches if ANY of the EIR's
 * projects is selected.
 */
export function applyEirFilters(eirs: Eir[], filters: EirFilters): Eir[] {
  // Multi-keyword AND + quoted phrases + all-fields — see lib/itemSearch.ts.
  const searchTokens = tokenizeQuery(filters.search);
  const engineers = filters.engineerEmails.map((s) => s.toLowerCase());
  return eirs.filter((e) => {
    if (filters.projectIds.length > 0) {
      const matched = e.parentProjects.some((p) =>
        filters.projectIds.includes(p.lookupId),
      );
      if (!matched) return false;
    }
    if (filters.reporterEmail) {
      const key = (e.reporter?.email ?? e.reporter?.displayName ?? "").toLowerCase();
      if (key !== filters.reporterEmail.toLowerCase()) return false;
    }
    if (engineers.length > 0) {
      const has = e.assignedEngineers.some((p) => {
        const k = (p.email ?? p.displayName).toLowerCase();
        return engineers.includes(k);
      });
      if (!has) return false;
    }
    if (!matchesSearch(e, searchTokens)) return false;
    return true;
  });
}

/** Apply the status pill on top of an already-filtered set. */
/**
 * Views that show a full REGISTER rather than a work queue, and therefore
 * ignore the status pill.
 *
 * At Risk Parts mirrors SharePoint's At Risk View: every part flagged
 * `riskPart === "Active"`, whatever its EIR's status. Narrowing it by status
 * meant a closed EIR on an at-risk part vanished from the one screen whose
 * whole job is to list at-risk parts (Ray, 2026-08-25). The other tabs are
 * queues — "what needs doing" — and the pill is exactly right there.
 *
 * Deliberately a named predicate rather than a `view === "at-risk"` ternary in
 * the view: `EirsView` has no test file, so the rule would ship uncovered, and
 * the pill rendering has to agree with the row filtering or the pills lie.
 */
export function eirViewIgnoresStatus(view: EirView): boolean {
  return view === "at-risk";
}

/**
 * The status filter that actually applies, given the view.
 *
 * `null` on a view that ignores status, so a `?status=` left in the URL from
 * another tab — or arriving in a bookmark — can't quietly narrow a register.
 */
export function effectiveEirStatusFilter(
  view: EirView,
  statusFilter: EirStatusFilter,
): EirStatusFilter {
  return eirViewIgnoresStatus(view) ? null : statusFilter;
}

export function applyEirStatusFilter(eirs: Eir[], statusFilter: EirStatusFilter): Eir[] {
  if (statusFilter === "ALL_OPEN") return eirs.filter((e) => isOpenEir(e.status));
  if (statusFilter) return eirs.filter((e) => e.status === statusFilter);
  return eirs;
}

/**
 * Sort for display. The LTB view sorts by LTB date, soonest first (the most
 * urgent last-time-buys at the top) with any missing date sinking to the
 * bottom; everywhere else it's newest first by creation date.
 *
 * The board sorts each column with this too, so switching between List and
 * Board doesn't silently reorder the same EIRs.
 */
export function sortEirsForView(eirs: Eir[], view: EirView): Eir[] {
  return [...eirs].sort((a, b) => {
    if (view === "ltb") {
      const at = a.ltbDate ? a.ltbDate.getTime() : Infinity;
      const bt = b.ltbDate ? b.ltbDate.getTime() : Infinity;
      return at - bt;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** Count per EIR status, for the list's pills and the board's column headers. */
export function countEirsByStatus(eirs: Eir[]): Record<EirStatus, number> {
  const out: Record<EirStatus, number> = {
    "Under Review": 0,
    "EIR Not Accepted": 0,
    "Response Accepted": 0,
    "Response Not Accepted": 0,
    Closed: 0,
  };
  for (const e of eirs) out[e.status]++;
  return out;
}

/**
 * Everyone who appears on an EIR (reporter, assigned engineers, watchers),
 * deduped by email and sorted by name — the options for the person pickers.
 * Distinct from `collectPeople` in taskFilters.ts, which reads task fields.
 */
export function collectEirPeople(eirs: Eir[]): Person[] {
  const map = new Map<string, Person>();
  for (const e of eirs) {
    if (e.reporter) {
      const k = (e.reporter.email ?? e.reporter.displayName).toLowerCase();
      if (!map.has(k)) map.set(k, e.reporter);
    }
    for (const p of [...e.assignedEngineers, ...e.watchers]) {
      const k = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(k)) map.set(k, p);
    }
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
