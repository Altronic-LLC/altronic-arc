import { boxCorners, quadBounds, type OrientedBox } from "./plantGeometry";
import { snap } from "./plantEditor";

// =============================================================================
// Alignment guides for the layout editor (Tim, 2026-11-06: "when you're
// dragging and you line up with another object in the same horizontal or
// vertical area it shows a dotted line that it snaps to, so we can align desks
// and machines").
//
// While something is dragged, its left edge, centre and right edge are
// compared with every other item's and area's; the closest within the
// tolerance wins, and the dragged thing snaps onto it. Same again for top,
// middle and bottom. Each axis is decided on its own, so a desk can line up
// with one desk's edge across and another's centre down.
//
//   * An axis with no match falls back to the grid, as before.
//   * Rotated things are compared by their on-screen box (the bounds of their
//     corners), which is what the eye lines up.
//   * The tolerance is given in INCHES by the caller, worked out from a fixed
//     number of screen pixels, so it feels the same at any zoom.
//   * A guide runs the full span of everything on that line, so it reads as
//     "these line up", not just "these two".
// =============================================================================

/** How close, in SCREEN pixels, before a drag snaps onto a neighbour's line. */
export const ALIGN_SNAP_PX = 8;

export interface AlignGuide {
  /** "x" — a vertical line at x = `at`; "y" — a horizontal line at y = `at`. */
  axis: "x" | "y";
  at: number;
  /** Where the line starts and ends, along the other axis. */
  from: number;
  to: number;
}

export interface Alignment {
  x: number;
  y: number;
  guides: AlignGuide[];
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const ON_LINE = 0.01;

const anchorsX = (b: Bounds) => [b.minX, (b.minX + b.maxX) / 2, b.maxX];
const anchorsY = (b: Bounds) => [b.minY, (b.minY + b.maxY) / 2, b.maxY];

/** The smallest shift (within `tolerance`) that puts one of `mine` onto one of `theirs`. */
function bestShift(mine: number[], theirs: number[][], tolerance: number): number | null {
  let best: number | null = null;
  for (const other of theirs) {
    for (const t of other) {
      for (const m of mine) {
        const shift = t - m;
        if (Math.abs(shift) <= tolerance && (best === null || Math.abs(shift) < Math.abs(best))) best = shift;
      }
    }
  }
  return best;
}

/**
 * Where a dragged box should land, and the guides to draw.
 *
 * `moving` is the box at its RAW (unsnapped) position. `others` excludes the
 * box itself. `grid` is the snap for an axis that lines up with nothing
 * (0 = whole inches).
 */
export function alignToNeighbours(
  moving: OrientedBox,
  others: readonly OrientedBox[],
  tolerance: number,
  grid: number,
): Alignment {
  const raw = quadBounds(boxCorners(moving));
  const theirs = others.map((o) => quadBounds(boxCorners(o)));

  const dx = tolerance > 0 ? bestShift(anchorsX(raw), theirs.map(anchorsX), tolerance) : null;
  const dy = tolerance > 0 ? bestShift(anchorsY(raw), theirs.map(anchorsY), tolerance) : null;
  const x = dx === null ? snap(moving.x, grid) : moving.x + dx;
  const y = dy === null ? snap(moving.y, grid) : moving.y + dy;

  // The guides are read off where the box actually lands — so a grid snap
  // that happens to land on a line shows it too.
  const at: Bounds = {
    minX: raw.minX + (x - moving.x),
    maxX: raw.maxX + (x - moving.x),
    minY: raw.minY + (y - moving.y),
    maxY: raw.maxY + (y - moving.y),
  };
  const guides: AlignGuide[] = [];
  const seen = new Set<string>();
  for (const axis of ["x", "y"] as const) {
    const mine = axis === "x" ? anchorsX(at) : anchorsY(at);
    for (const line of mine) {
      const key = `${axis}:${Math.round(line * 100)}`;
      if (seen.has(key)) continue;
      const onIt = theirs.filter((b) => (axis === "x" ? anchorsX(b) : anchorsY(b)).some((v) => Math.abs(v - line) <= ON_LINE));
      if (onIt.length === 0) continue;
      seen.add(key);
      const all = [at, ...onIt];
      guides.push(
        axis === "x"
          ? { axis, at: line, from: Math.min(...all.map((b) => b.minY)), to: Math.max(...all.map((b) => b.maxY)) }
          : { axis, at: line, from: Math.min(...all.map((b) => b.minX)), to: Math.max(...all.map((b) => b.maxX)) },
      );
    }
  }
  return { x, y, guides };
}
