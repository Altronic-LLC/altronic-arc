import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { EirStatus } from "@/types/task";
import { eirViewIgnoresStatus } from "@/lib/eirFilters";
import type { EirFilters, EirStatusFilter, EirView } from "@/lib/eirFilters";

// =============================================================================
// URL-backed filter state for the EIRs list and board. Mirrors useFilters.ts
// (tasks), but over the EIR axes: q / project / reporter / engineer / view /
// status.
//
// Lives in the URL so a filtered set is shareable and survives a refresh —
// and so switching List ⇄ Board doesn't reset it. See `eirFilterSearch`.
// =============================================================================

/**
 * The params that travel when linking between two views of the SAME EIR set.
 *
 * `status` is deliberately NOT here. On the list it's a pill; on the board it
 * IS the column axis, so carrying `status=Closed` across would leave a board
 * with four empty columns, which reads as broken rather than filtered. Same
 * reasoning as the task switcher, which leaves `status` behind too.
 */
export const EIR_FILTER_PARAM_KEYS = ["q", "project", "reporter", "engineer", "view"] as const;

/**
 * Pick just the EIR filter params out of a location's search string and
 * return them as a `?…` suffix ready to append to a path (`""` when none).
 *
 * The task equivalent (`filterSearch`) only knows the task keys, so pointing
 * the EIR switcher at it would silently drop project / reporter / engineer.
 */
export function eirFilterSearch(search: string): string {
  const from = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of EIR_FILTER_PARAM_KEYS) {
    const value = from.get(key);
    if (value !== null) out.set(key, value);
  }
  const query = out.toString();
  return query ? `?${query}` : "";
}

export interface EirFilterState {
  filters: EirFilters;
  setSearch: (v: string) => void;
  setProjectIds: (ids: number[]) => void;
  setReporter: (email: string | null) => void;
  setEngineers: (emails: string[]) => void;
  view: EirView;
  setView: (next: EirView) => void;
  /**
   * Status pill. Read/written by the list only — the board's columns are the
   * statuses, so it has no pill and never sets this.
   */
  statusFilter: EirStatusFilter;
  setStatusFilter: (next: EirStatusFilter) => void;
}

export function useEirFilters(): EirFilterState {
  const [searchParams, setSearchParams] = useSearchParams();

  const write = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (value === null) out.delete(key);
          else out.set(key, value);
          return out;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const filters: EirFilters = useMemo(
    () => ({
      search: searchParams.get("q") ?? "",
      projectIds: parseIntList(searchParams.get("project")),
      reporterEmail: searchParams.get("reporter"),
      engineerEmails: parseStringList(searchParams.get("engineer")),
    }),
    [searchParams],
  );

  // Default is NO status filter — every view shows items of every status
  // (open, under review, closed, …) until the user clicks a pill. The "Open"
  // pill is a one-click opt-in.
  const statusFilter = (searchParams.get("status") as EirStatusFilter) ?? null;

  const rawView = searchParams.get("view");
  const view: EirView =
    rawView === "new" ||
    rawView === "needs-assigned" ||
    rawView === "at-risk" ||
    rawView === "ltb"
      ? rawView
      : "all";

  return {
    filters,
    setSearch: useCallback((v: string) => write("q", v || null), [write]),
    setProjectIds: useCallback(
      (ids: number[]) => write("project", ids.length > 0 ? ids.join(",") : null),
      [write],
    ),
    setReporter: useCallback((email: string | null) => write("reporter", email || null), [write]),
    setEngineers: useCallback(
      (emails: string[]) => write("engineer", emails.length > 0 ? emails.join(",") : null),
      [write],
    ),
    view,
    setView: useCallback(
      (next: EirView) => {
        // Entering a view that ignores status CLEARS the pill.
        //
        // Leaving it parked was the first attempt, on the theory that the
        // selection stayed visible in the pills — it doesn't: those pills
        // deliberately don't render as active on such a view, so the filter
        // was invisible and then silently re-narrowed the moment another tab
        // was picked. Clearing it is the only version with no hidden state.
        setSearchParams(
          (prev) => {
            const out = new URLSearchParams(prev);
            if (next === "all") out.delete("view");
            else out.set("view", next);
            if (eirViewIgnoresStatus(next)) out.delete("status");
            return out;
          },
          { replace: true },
        );
      },
      [setSearchParams],
    ),
    statusFilter,
    setStatusFilter: useCallback(
      (next: EirStatusFilter) => write("status", next === null ? null : (next as EirStatus)),
      [write],
    ),
  };
}

function parseIntList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^-?\d+$/.test(s))
    .map((s) => parseInt(s, 10));
}

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
