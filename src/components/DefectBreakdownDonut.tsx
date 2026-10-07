import { cn } from "@/lib/cn";
import type { CategoryBreakdown } from "@/lib/monthlyYield";

// =============================================================================
// A donut chart for ONE month: the total tested in the center hole, and a
// ring segmented by defect category around it — a second, complementary
// view of the same Reports data. `MonthlyFpyChart` answers "how is the
// trend moving"; this answers "of what failed last month, what's actually
// breaking" (Tim, 2026-09-18). Shared by all three reports, same as
// `MonthlyFpyChart` — a source's own hook decides what counts as a
// category (see `lib/teradyneFpy.ts`'s remark grouping vs
// `lib/monthlyYield.ts`'s fixed 14 QC categories).
//
// The ring's own total is the sum of what's actually shown (total DEFECTS),
// deliberately NOT the same number as the center (total TESTED) — the
// center is the context ("out of how many"), the ring is the breakdown of
// what went wrong within the smaller slice that failed.
// =============================================================================

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 78;
const STROKE = 30;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Evenly-spaced hues, not a fixed brand palette — a category breakdown can
 * have anywhere from 1 to 14+ segments (Teradyne's remarks are open-ended;
 * Digital/Ignition QC's 14 named categories are fixed but rarely all
 * present at once), and the app's usual "only four brand tones" rule
 * (see CLAUDE.md, dashboard cards) exists for a handful of cards, not a
 * chart that needs every segment visually distinct from its neighbours.
 * The legend beside the ring is the definitive label-to-color mapping.
 */
function segmentColors(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `hsl(${(360 * i) / count}, 60%, 45%)`);
}

export function DefectBreakdownDonut({
  monthLabel,
  total,
  unitLabel = "Units",
  segments,
  large = false,
}: {
  /** The month this breakdown is for, e.g. "Sep" — shown under the center total. */
  monthLabel: string;
  /** Units TESTED that month — the center number. Not units failed; see the file comment. */
  total: number;
  unitLabel?: string;
  segments: CategoryBreakdown[];
  large?: boolean;
}) {
  const totalDefects = segments.reduce((sum, s) => sum + s.count, 0);
  const colors = segmentColors(Math.max(segments.length, 1));

  let cumulative = 0;
  const arcs = segments.map((s, i) => {
    const fraction = totalDefects > 0 ? s.count / totalDefects : 0;
    const length = fraction * CIRCUMFERENCE;
    const arc = { ...s, length, offset: cumulative, color: colors[i] };
    cumulative += length;
    return arc;
  });

  const summary =
    segments.length === 0
      ? `No defects logged in ${monthLabel}.`
      : segments.map((s) => `${s.label}: ${s.count.toLocaleString()}`).join("; ");

  return (
    // In kiosk mode (`large`) the ring dominates and the legend shrinks and
    // narrows rather than growing to fill the row (Tim, 2026-09-18) — the
    // legend's job on a screen nobody is standing next to is naming the
    // colors, not being read line by line.
    <div
      className={cn(
        "flex items-center",
        large
          ? "w-full flex-col justify-center gap-8 sm:flex-row sm:gap-16"
          : "flex-col gap-4 sm:flex-row sm:gap-8",
      )}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${monthLabel} defect breakdown. ${total.toLocaleString()} ${unitLabel.toLowerCase()} tested. ${summary}`}
        className={cn("shrink-0", large ? "h-72 w-72 sm:h-96 sm:w-96 lg:h-[30rem] lg:w-[30rem]" : "h-40 w-40")}
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-surface-2"
        />
        {arcs.map((arc, i) => (
          <circle
            key={`${arc.label}-${i}`}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            stroke={arc.color}
            strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
            strokeDashoffset={-arc.offset}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        ))}
        <text
          x={CENTER}
          y={CENTER - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          className={cn(
            "fill-fg font-display font-bold tabular-nums",
            large ? "text-[34px]" : "text-[22px]",
          )}
        >
          {total.toLocaleString()}
        </text>
        <text
          x={CENTER}
          y={CENTER + (large ? 22 : 16)}
          textAnchor="middle"
          dominantBaseline="middle"
          className={cn("fill-fg-muted", large ? "text-[13px]" : "text-[9px]")}
        >
          {unitLabel} tested · {monthLabel}
        </text>
      </svg>

      <div
        className={cn(
          "flex flex-col gap-1",
          large ? "w-full max-w-[280px] shrink-0 text-xs sm:w-auto" : "min-w-0 flex-1 text-sm",
        )}
      >
        {segments.length === 0 ? (
          <p className="text-fg-muted">No defects logged in {monthLabel}.</p>
        ) : (
          segments.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: colors[i] }}
              />
              <span className="min-w-0 flex-1 truncate text-fg">{s.label}</span>
              <span className="shrink-0 tabular-nums text-fg-muted">
                {s.count.toLocaleString()} ({((s.count / totalDefects) * 100).toFixed(0)}%)
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
