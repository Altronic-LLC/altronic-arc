import { cn } from "@/lib/cn";
import type { MonthlyFpy } from "@/lib/monthlyYield";

// =============================================================================
// A stacked bar (units passed + units failed) per month, with an FPY% line
// over a right-hand 0-100% axis — hand-rolled SVG, since ARC has no charting
// library dependency (see CLAUDE.md, "Reports" section). Shared by every
// Reports chart (Teradyne, Digital QC, Ignition QC, …) — `unitLabel` is the
// only thing that varies between them.
//
// The bar's TOTAL height is Units Tested; the failed segment is Units
// Failed, capped so a bad month's failures can never draw taller than the
// bar itself.
// =============================================================================

const WIDTH = 640;
const HEIGHT = 280;
const PAD = { top: 32, right: 44, bottom: 32, left: 56 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

// The bars and the FPY% line each get their OWN vertical band, rather than
// sharing the full plot height on two overlapping 0-max scales. A bar's own
// value label sits just above the bar, and the line's percent labels sit
// just above each point — sharing one scale put a tall month's label right
// where a high FPY% point already was, and the two overlapped illegibly
// (reported live, 2026-09-17, screenshot: "4,664" and "94.6%" collided into
// unreadable text). Splitting the space means neither series can ever reach
// into the other's label room, however the numbers land.
const LINE_BAND_H = PLOT_H * 0.3; // top ~30% — the FPY% line and its labels
const BAND_GAP = 16; // breathing room between the two bands
const BAR_BAND_TOP = PAD.top + LINE_BAND_H + BAND_GAP;
const BAR_BAND_H = PLOT_H - LINE_BAND_H - BAND_GAP;

/** Round a value up to a friendly axis ceiling (1/2/5 × a power of ten). */
export function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/**
 * The FPY% axis starts at 50% instead of 0% when EVERY month's yield already
 * clears 50% — the 0-50% half of the axis would carry no real value on it,
 * just wasted vertical room the line could use instead (Tim, 2026-09-17). A
 * month with `null` (nothing tested) doesn't count either way; a genuinely
 * bad month (anything under 50%) always brings the floor back down to 0, so
 * a real low figure is never silently cropped off the chart.
 */
export function percentFloorFor(values: Array<number | null>): 0 | 50 {
  const real = values.filter((v): v is number => v != null);
  return real.length > 0 && real.every((v) => v >= 50) ? 50 : 0;
}

export function MonthlyFpyChart({
  data,
  unitLabel = "Units",
  large = false,
}: {
  data: MonthlyFpy[];
  /** What each count represents — "Boards", "Units", … Plural, sentence case. */
  unitLabel?: string;
  /**
   * Bigger legend text, for the kiosk cycle. The SVG itself already scales
   * with whatever width its container gives it — everything inside the
   * viewBox (axis labels, bar values, the FPY% line's own labels) grows
   * right along with it. The legend below it is plain HTML, outside the
   * SVG, so it needs its own explicit size to keep pace.
   */
  large?: boolean;
}) {
  const maxCount = niceMax(Math.max(1, ...data.map((d) => d.unitsTested)));
  const barW = data.length > 0 ? PLOT_W / data.length : PLOT_W;
  // Narrower than a plain 55% fill — a slimmer bar reads less like a solid
  // block and leaves more of the month's column as visual breathing room.
  const barInnerW = Math.min(56, barW * 0.4);

  const yCount = (v: number) => BAR_BAND_TOP + BAR_BAND_H * (1 - v / maxCount);
  const percentFloor = percentFloorFor(data.map((d) => d.fpyPercent));
  const yPercent = (v: number) =>
    PAD.top + LINE_BAND_H * (1 - (v - percentFloor) / (100 - percentFloor));
  const xCenter = (i: number) => PAD.left + barW * (i + 0.5);

  const linePoints = data
    .map((d, i) => (d.fpyPercent == null ? null : `${xCenter(i)},${yPercent(d.fpyPercent)}`))
    .filter((p): p is string => p !== null)
    .join(" ");

  const countTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxCount * f));
  const percentTicks = [0, 25, 50, 75, 100].filter((t) => t >= percentFloor);

  const summary = data
    .map((d) => {
      const fpy = d.fpyPercent == null ? "no data" : `${d.fpyPercent.toFixed(1)}% FPY`;
      return `${d.label}: ${d.unitsTested.toLocaleString()} tested, ${d.unitsFailed.toLocaleString()} failed, ${fpy}`;
    })
    .join("; ");

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${unitLabel} tested and failed by month. ${summary}`}
        className="h-auto w-full min-w-[420px]"
      >
        {countTicks.map((t) => (
          <g key={`count-${t}`}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yCount(t)}
              y2={yCount(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={yCount(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-fg-muted text-[10px]"
            >
              {t.toLocaleString()}
            </text>
          </g>
        ))}

        {percentTicks.map((t) => (
          <text
            key={`pct-${t}`}
            x={WIDTH - PAD.right + 8}
            y={yPercent(t)}
            textAnchor="start"
            dominantBaseline="middle"
            className="fill-fg-muted text-[10px]"
          >
            {t}%
          </text>
        ))}

        {data.map((d, i) => {
          const passed = Math.max(0, d.unitsTested - d.unitsFailed);
          const x = xCenter(i) - barInnerW / 2;
          const yPassedTop = yCount(passed);
          const yTotalTop = yCount(d.unitsTested);
          const barBottom = PAD.top + PLOT_H;
          return (
            <g key={d.monthKey}>
              <rect
                x={x}
                y={yPassedTop}
                width={barInnerW}
                height={Math.max(0, barBottom - yPassedTop)}
                className="fill-superior-blue"
              />
              {d.unitsFailed > 0 && (
                <rect
                  x={x}
                  y={yTotalTop}
                  width={barInnerW}
                  height={Math.max(0, yPassedTop - yTotalTop)}
                  className="fill-cooper-red"
                />
              )}
              {d.unitsTested > 0 && (
                <text
                  x={xCenter(i)}
                  y={yTotalTop - 6}
                  textAnchor="middle"
                  className="fill-fg text-[11px] font-semibold tabular-nums"
                >
                  {d.unitsTested.toLocaleString()}
                </text>
              )}
              {/* The passed count, inside the blue segment itself — total
                  minus failures. White for contrast against superior-blue,
                  and only drawn when the segment is tall enough to hold it;
                  a sliver of a bar just keeps the total label above it. */}
              {passed > 0 && barBottom - yPassedTop >= 22 && (
                <text
                  x={xCenter(i)}
                  y={(yPassedTop + barBottom) / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-white text-[11px] font-semibold tabular-nums"
                >
                  {passed.toLocaleString()}
                </text>
              )}
              <text
                x={xCenter(i)}
                y={HEIGHT - PAD.bottom + 18}
                textAnchor="middle"
                className="fill-fg-muted text-[11px]"
              >
                {d.label}
              </text>
            </g>
          );
        })}

        {linePoints && (
          <polyline
            points={linePoints}
            fill="none"
            className="stroke-cooper-green"
            strokeWidth={2}
          />
        )}
        {data.map((d, i) =>
          d.fpyPercent == null ? null : (
            <g key={`pt-${d.monthKey}`}>
              <circle
                cx={xCenter(i)}
                cy={yPercent(d.fpyPercent)}
                r={3}
                className="fill-cooper-green"
              />
              <text
                x={xCenter(i)}
                y={yPercent(d.fpyPercent) - 8}
                textAnchor="middle"
                className="fill-cooper-green text-[11px] font-semibold"
              >
                {d.fpyPercent.toFixed(1)}%
              </text>
            </g>
          ),
        )}
      </svg>

      <div
        className={cn(
          "mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-fg-muted",
          large ? "text-base" : "text-xs",
        )}
      >
        <Legend swatch="bg-superior-blue" label={`${unitLabel} passed`} />
        <Legend swatch="bg-cooper-red" label={`${unitLabel} failed`} />
        <Legend swatch="bg-cooper-green" label="FPY%" line />
      </div>
    </div>
  );
}

function Legend({ swatch, label, line }: { swatch: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(line ? "h-0.5 w-3 rounded-full" : "h-2.5 w-2.5 rounded-sm", swatch)} />
      {label}
    </span>
  );
}
