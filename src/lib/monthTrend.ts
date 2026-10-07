import type { MonthlyFpy } from "@/lib/monthlyYield";

// =============================================================================
// The month-over-month trend indicator on every Reports dashboard (Tim,
// 2026-10-07, "option B" of two mocked: an up/down chip against the previous
// month, chosen over a best-fit trend line — with only three months on the
// chart, a fitted line nearly retraces the FPY line already drawn there).
//
// Pure, so the rules are tested without rendering anything. Three of them are
// load-bearing:
//
// - **Rates, never counts.** The latest month in a trailing window is ALWAYS
//   the current, partial month, so "1,980 tested, down 58% on September" on
//   the 7th would be a fake drop. FPY% and failure rate are comparable on any
//   day of the month.
// - **Good/bad is not up/down.** FPY going up is good; the failure rate going
//   up is bad. `good` carries that, so a component never infers it from the
//   arrow.
// - **Too early to compare.** On the 2nd, one bad batch flips the arrow. The
//   comparison waits until the month has tested MIN_UNITS_FOR_COMPARISON units,
//   OR a quarter of the previous month's total if that is fewer — so a
//   low-volume source isn't left waiting for a number it never reaches.
// =============================================================================

/** Units the current month must test before it is compared with the previous one. */
export const MIN_UNITS_FOR_COMPARISON = 200;

/** …or this share of the previous month's units, whichever is smaller. */
export const MIN_SHARE_OF_PREVIOUS_MONTH = 0.25;

/** A change under this (in percentage points) reads as no change — it would print as "0.0". */
export const NO_CHANGE_BELOW_POINTS = 0.05;

export type TrendMetric = "fpy" | "failureRate";

interface TrendBase {
  /** This month's metric value (month to date), or null when nothing is tested yet. */
  value: number | null;
  currentLabel: string;
  previousLabel: string;
}

export type MonthTrend =
  | (TrendBase & {
      kind: "compare";
      value: number;
      /** Current minus previous, in percentage points. */
      delta: number;
      direction: "up" | "down" | "flat";
      /** null when flat — no change is neither better nor worse. */
      good: boolean | null;
    })
  | (TrendBase & { kind: "too-early"; unitsSoFar: number; unitsNeeded: number })
  | (TrendBase & { kind: "no-previous" })
  | { kind: "none" };

export function metricValue(month: MonthlyFpy, metric: TrendMetric): number | null {
  if (month.fpyPercent == null) return null;
  return metric === "fpy" ? month.fpyPercent : 100 - month.fpyPercent;
}

/** How many units the current month needs before it's compared with `previous`. */
export function unitsNeededToCompare(previous: MonthlyFpy): number {
  return Math.max(
    1,
    Math.min(
      MIN_UNITS_FOR_COMPARISON,
      Math.ceil(previous.unitsTested * MIN_SHARE_OF_PREVIOUS_MONTH),
    ),
  );
}

/** Compares the last month in `monthly` (oldest first) with the one before it. */
export function monthTrend(monthly: MonthlyFpy[], metric: TrendMetric): MonthTrend {
  if (monthly.length < 2) return { kind: "none" };
  const current = monthly[monthly.length - 1];
  const previous = monthly[monthly.length - 2];
  const base = {
    value: metricValue(current, metric),
    currentLabel: current.label,
    previousLabel: previous.label,
  };

  const previousValue = metricValue(previous, metric);
  if (previousValue == null) return { ...base, kind: "no-previous" };

  const unitsNeeded = unitsNeededToCompare(previous);
  if (base.value == null || current.unitsTested < unitsNeeded) {
    return { ...base, kind: "too-early", unitsSoFar: current.unitsTested, unitsNeeded };
  }

  const delta = base.value - previousValue;
  if (Math.abs(delta) < NO_CHANGE_BELOW_POINTS) {
    return { ...base, value: base.value, kind: "compare", delta, direction: "flat", good: null };
  }
  const direction = delta > 0 ? "up" : "down";
  const good = metric === "fpy" ? delta > 0 : delta < 0;
  return { ...base, value: base.value, kind: "compare", delta, direction, good };
}
