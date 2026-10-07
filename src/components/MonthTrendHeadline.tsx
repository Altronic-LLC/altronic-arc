import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MonthlyFpy } from "@/lib/monthlyYield";
import { monthTrend, type TrendMetric } from "@/lib/monthTrend";

// =============================================================================
// The headline above every Reports chart: this month's figure (month to
// date) and a chip saying whether it is better or worse than last month. The
// rules — rates not counts, good vs bad, too early to compare — live in
// `lib/monthTrend.ts`; this only renders what that decides.
// =============================================================================

const METRIC_LABEL: Record<TrendMetric, string> = {
  fpy: "FPY",
  failureRate: "failure rate",
};

export function MonthTrendHeadline({
  monthly,
  metric,
  unitLabel = "Units",
  large = false,
}: {
  monthly: MonthlyFpy[];
  metric: TrendMetric;
  /** Plural, sentence case — "Boards", "Units". Used in the too-early note. */
  unitLabel?: string;
  /** Kiosk sizing. */
  large?: boolean;
}) {
  const trend = monthTrend(monthly, metric);
  if (trend.kind === "none") return null;

  const units = unitLabel.toLowerCase();
  const noteClass = cn("text-fg-muted", large ? "text-xl" : "text-sm");

  return (
    <div className={cn("flex flex-wrap items-center", large ? "gap-x-6 gap-y-2" : "gap-x-3 gap-y-1")}>
      {trend.value == null ? (
        <span className={noteClass}>
          No {units} tested in {trend.currentLabel} yet.
        </span>
      ) : (
        <span
          className={cn(
            "font-display font-bold leading-none tabular-nums text-fg",
            large ? "text-6xl" : "text-3xl",
          )}
        >
          {trend.value.toFixed(1)}%
          <span
            className={cn(
              "ml-1.5 font-sans font-semibold text-fg-muted",
              large ? "text-2xl" : "text-sm",
            )}
          >
            {METRIC_LABEL[metric]} · {trend.currentLabel} so far
          </span>
        </span>
      )}

      {trend.kind === "compare" && <TrendChip trend={trend} large={large} />}

      {trend.kind === "too-early" && trend.value != null && (
        <span className={noteClass}>
          Compared with {trend.previousLabel} once {trend.unitsNeeded.toLocaleString()} {units}{" "}
          are tested ({trend.unitsSoFar.toLocaleString()} so far).
        </span>
      )}

      {trend.kind === "no-previous" && (
        <span className={noteClass}>
          Nothing tested in {trend.previousLabel} to compare with.
        </span>
      )}
    </div>
  );
}

function TrendChip({
  trend,
  large,
}: {
  trend: Extract<ReturnType<typeof monthTrend>, { kind: "compare" }>;
  large: boolean;
}) {
  const iconClass = large ? "h-6 w-6" : "h-3.5 w-3.5";
  const tone =
    trend.good == null
      ? "bg-surface-2 text-fg-muted"
      : trend.good
        ? "bg-cooper-green/10 text-cooper-green"
        : "bg-cooper-red/10 text-cooper-red";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-bold tabular-nums",
        large ? "px-4 py-1.5 text-2xl" : "px-2.5 py-0.5 text-sm",
        tone,
      )}
      title="Change in percentage points from last month"
    >
      {trend.direction === "flat" ? (
        <>
          <Minus className={iconClass} aria-hidden="true" />
          No change vs {trend.previousLabel}
        </>
      ) : (
        <>
          {trend.direction === "up" ? (
            <ArrowUp className={iconClass} aria-hidden="true" />
          ) : (
            <ArrowDown className={iconClass} aria-hidden="true" />
          )}
          <span className="sr-only">{trend.direction === "up" ? "Up " : "Down "}</span>
          {Math.abs(trend.delta).toFixed(1)} pts{" "}
          <span className="font-semibold opacity-80">vs {trend.previousLabel}</span>
        </>
      )}
    </span>
  );
}
