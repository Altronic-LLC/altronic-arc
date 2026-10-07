import { monthKey } from "@/lib/calendarGrid";
import { bucketMonthlyYield, type CategoryBreakdown, type MonthlyFpy } from "@/lib/monthlyYield";
import type { TeradyneLogEntry } from "@/types/task";

// =============================================================================
// Teradyne monthly FPY (First Pass Yield) — the Reports dashboard.
//
// A Teradyne Log row is one of two shapes, distinguished by ONE field (Tim,
// 2026-09-17): `boardsTested` set to a real, non-zero value means the row is
// a BATCH TOTAL — the whole run's board count for that test session.
// `boardsTested` left blank means the row is a DEFECT entry instead, and its
// `numberOfBoards` is how many boards in that run failed for the specific
// `defectiveParts` reason this row names. One batch commonly has several
// defect rows logged alongside its one total row.
//
// Summing `boardsTested` across every row would count a batch's total once
// per defect logged against it. `isBatchTotalRow` is the one place that
// distinction lives — only rows it calls a batch total ever contribute to
// Units Tested. This is the one piece of this whole calculation that's
// genuinely Teradyne-specific; the month-bucketing itself is the shared
// engine in `lib/monthlyYield.ts`, the same one Digital QC and Ignition QC
// use — neither of those needs this split at all, since their rows already
// carry a plain Quantity Tested / Quantity Rejected pair each.
// =============================================================================

/** A row IS the batch's total-tested figure, not a defect against it. */
export function isBatchTotalRow(entry: TeradyneLogEntry): boolean {
  return entry.boardsTested != null && entry.boardsTested !== 0;
}

/**
 * Buckets entries into the given months (oldest first) and computes each
 * month's Boards Tested / Boards Failed / FPY%.
 *
 * Boards Failed sums `numberOfBoards` across EVERY entry in the month,
 * deliberately not restricted to non-batch rows — the batch/defect split
 * above exists only to stop Boards Tested being counted more than once, and
 * doesn't assume a batch-total row can never itself carry a failure count.
 */
export function monthlyFpy(entries: TeradyneLogEntry[], months: Date[]): MonthlyFpy[] {
  return bucketMonthlyYield(
    entries,
    months,
    (e) => e.enterDate,
    (e) => (isBatchTotalRow(e) ? (e.boardsTested as number) : 0),
    (e) => e.numberOfBoards ?? 0,
  );
}

/**
 * What failed, and how much, for ONE month — the donut chart. Only DEFECT
 * rows count (a batch-total row names no reason, just a total); each one's
 * `numberOfBoards` is added to its `remark`'s bucket, the canned reason
 * Teradyne already records per defect. A defect logged with no remark still
 * counts, under "Unspecified" — real failures never silently disappear for
 * lacking a category, the same rule `referenceLabel()` follows elsewhere in
 * this app for an unresolved lookup.
 *
 * Unlike Digital/Ignition QC's FIXED 14 named categories, Teradyne's are
 * whatever remarks are actually in use — there's no fixed list to hand
 * `categoryBreakdown()`, so this groups by value instead.
 */
export function latestMonthRemarkBreakdown(
  entries: TeradyneLogEntry[],
  month: Date,
): CategoryBreakdown[] {
  const key = monthKey(month);
  const totals = new Map<string, number>();

  for (const entry of entries) {
    if (isBatchTotalRow(entry)) continue;
    if (!entry.enterDate || monthKey(entry.enterDate) !== key) continue;
    const label = entry.remark?.title?.trim() || "Unspecified";
    totals.set(label, (totals.get(label) ?? 0) + (entry.numberOfBoards ?? 0));
  }

  return Array.from(totals.entries())
    .map(([label, count]) => ({ label, count }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}
