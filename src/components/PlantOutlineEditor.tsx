import { useEffect, useRef, useState } from "react";
import { RotateCcw, Undo2 } from "lucide-react";
import type { Point } from "@/lib/plantGeometry";
import { outlineProblem, snapOutlinePoint } from "@/lib/plantSymbolImport";

// =============================================================================
// Drawing a symbol's collision OUTLINE on the Add / Replace symbol form. Click
// the corners in order around the solid part of the symbol, on its preview;
// each corner snaps to the inch and stays inside the footprint. The corners
// can also be typed ("0,0 60,0 60,30 …"), which is the keyboard way in.
//
// The svg uses preserveAspectRatio="none" with its box sized to the footprint's
// proportions, so a click maps to inches with one multiplication — no screen
// matrix, which jsdom hasn't got.
// =============================================================================

const formatPoints = (pts: readonly Point[]) => pts.map(([x, y]) => `${x},${y}`).join(" ");

/** "0,0 60,0 60 30" → points, or null when a pair can't be read. */
export function parsePointsText(text: string): Point[] | null {
  const nums = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (nums.length % 2 !== 0 || nums.some((n) => !Number.isFinite(n))) return null;
  const out: Point[] = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

export function PlantOutlineEditor({
  w,
  d,
  previewSrc,
  points,
  onChange,
  disabled,
}: {
  /** The footprint, inches — the symbol's viewBox. */
  w: number;
  d: number;
  /** The symbol as it will be saved, as a data URL. */
  previewSrc: string | null;
  points: readonly Point[];
  onChange: (points: Point[]) => void;
  disabled?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [text, setText] = useState(formatPoints(points));
  const [textProblem, setTextProblem] = useState<string | null>(null);
  // The box follows clicks and Undo; what's typed is only replaced when the points change elsewhere.
  useEffect(() => {
    setText(formatPoints(points));
    setTextProblem(null);
  }, [points]);

  const pad = Math.max(w, d) * 0.04;
  const dot = Math.max(w, d) / 70;
  const problem = outlineProblem(points);

  function click(e: React.MouseEvent<SVGSVGElement>) {
    if (disabled || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = -pad + ((e.clientX - rect.left) / rect.width) * (w + 2 * pad);
    const y = -pad + ((e.clientY - rect.top) / rect.height) * (d + 2 * pad);
    onChange([...points, snapOutlinePoint(x, y, w, d)]);
  }

  function commitText() {
    if (text === formatPoints(points)) return;
    const parsed = parsePointsText(text);
    if (!parsed) return setTextProblem("Type the corners as x,y pairs in inches, e.g. 0,0 60,0 60,30.");
    onChange(parsed.map(([x, y]) => snapOutlinePoint(x, y, w, d, 0.01)));
  }

  return (
    <div className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${d + 2 * pad}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Click the outline's corners"
        onClick={click}
        className="max-w-full cursor-crosshair self-start rounded-md border border-border bg-white"
        // Sized by its proportions (never stretched): full width, or 18rem tall, whichever is smaller.
        style={{
          aspectRatio: `${w + 2 * pad} / ${d + 2 * pad}`,
          width: `min(100%, ${(18 * (w + 2 * pad)) / (d + 2 * pad)}rem)`,
        }}
        data-testid="outline-canvas"
      >
        {previewSrc && <image href={previewSrc} x={0} y={0} width={w} height={d} opacity={0.6} preserveAspectRatio="none" />}
        <rect x={0} y={0} width={w} height={d} fill="none" stroke="#6b7280" strokeWidth={dot / 3} strokeDasharray={`${dot} ${dot}`} />
        {points.length >= 2 && (
          <polygon
            points={formatPoints(points)}
            fill={problem ? "#f59e0b33" : "#dc262633"}
            stroke={problem ? "#d97706" : "#dc2626"}
            strokeWidth={dot / 2}
          />
        )}
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={dot} fill={i === 0 ? "#2563eb" : "#dc2626"} data-corner={i} />
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(points.slice(0, -1))}
          disabled={disabled || points.length === 0}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo corner
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={disabled || points.length === 0}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Start again
        </button>
        <span className={problem ? "text-xs text-fg" : "text-xs text-fg-muted"} data-testid="outline-status">
          {problem ?? `${points.length} corners. Only the inside of the outline counts as solid.`}
        </span>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-fg-muted">Or type the corners, x,y in inches from the top-left</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            }
          }}
          aria-label="Outline corners"
          disabled={disabled}
          className="select font-mono text-xs"
        />
        {textProblem && (
          <span role="alert" className="text-xs text-cooper-red">
            {textProblem}
          </span>
        )}
      </label>
    </div>
  );
}
