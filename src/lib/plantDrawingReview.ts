import type { PlantAreaKind, PlantLayoutArea } from "@/types/plant";
import { feetLabel, quadBounds } from "./plantGeometry";
import type { WallsDrawing } from "./plantSvg";

// =============================================================================
// Reviewing a walls drawing before it's saved (Tim, 2026-11-06). New layout
// shows what ARC found in an uploaded drawing and asks two things before
// anything is written:
//
//   * Is the SIZE right? A drawing exported in the wrong units, or with a
//     viewBox that isn't the building, is the likeliest mistake, and every
//     symbol would then be the wrong size against it. The form makes the
//     person confirm "240 ft × 140 ft" in words.
//   * Which of its KEEP-OUTS should become editable aisles and no-go areas on
//     the layout, rather than fixed parts of the drawing? Planning decisions
//     (aisles, docks, clearances) belong on the layout; the drawing keeps the
//     building. Door swings stay in the drawing by default — they belong to
//     the doors drawn there.
//
// ARC does NOT try to clean up a CAD export: that's done once per building,
// outside ARC, to the rules in lib/plantSvg.ts. The review only says what ARC
// could and couldn't read.
// =============================================================================

/** Smaller than this either way, the drawing is probably not in inches. */
const SMALL_INCHES = 20 * 12;
/** Bigger than this either way, it's probably in millimetres or points. */
const LARGE_INCHES = 2000 * 12;

const KEEPOUT_WORDS: Record<string, string> = {
  aisle: "Aisle",
  egress: "Exit route",
  dock: "Dock",
  "overhead-door": "Overhead door",
  electrical: "Electrical clearance",
  "door-swing": "Door swing",
  "no-go": "No-go area",
};

/** One keep-out found in the drawing, and what the review offers to make of it. */
export interface KeepoutChoice {
  id: string;
  /** Its `data-kind` in the drawing ("" when it didn't say). */
  detail: string;
  /** Centre, width and depth, in inches — an area's shape. */
  x: number;
  y: number;
  w: number;
  d: number;
  /** What it becomes if made editable. */
  kind: PlantAreaKind;
  label: string;
  /** Ticked to start with: everything but a door swing. */
  convert: boolean;
}

export interface DrawingReview {
  /** "240 ft × 140 ft" — what the person confirms. */
  sizeLabel: string;
  walls: number;
  columns: number;
  warnings: string[];
  keepouts: KeepoutChoice[];
}

export function reviewWallsDrawing(drawing: WallsDrawing): DrawingReview {
  const { w, h } = drawing.extent;
  const walls = drawing.obstacles.filter((o) => o.kind === "wall").length;
  const columns = drawing.obstacles.filter((o) => o.kind === "column").length;
  const warnings: string[] = [];
  if (w < SMALL_INCHES || h < SMALL_INCHES) {
    warnings.push(
      `That's a very small building (${feetLabel(w)} × ${feetLabel(h)}). Check the drawing was exported in inches, with a viewBox the size of the building.`,
    );
  } else if (w > LARGE_INCHES || h > LARGE_INCHES) {
    warnings.push(
      `That's a very large building (${feetLabel(w)} × ${feetLabel(h)}). Check the drawing was exported in inches, not millimetres or points.`,
    );
  }
  if (walls === 0) {
    warnings.push(
      "ARC found no walls (rectangles in a group named walls), so the placement check can't stop anything being placed through one — only outside the building.",
    );
  }
  if (drawing.skipped > 0) {
    warnings.push(
      `${drawing.skipped} shape${drawing.skipped === 1 ? "" : "s"} in the walls, columns or keepout groups ${drawing.skipped === 1 ? "isn't a plain rectangle" : "aren't plain rectangles"} (curved, turned or drawn as lines), so ARC shows ${drawing.skipped === 1 ? "it" : "them"} but can't check against ${drawing.skipped === 1 ? "it" : "them"}.`,
    );
  }

  const found = drawing.obstacles.filter((o) => o.kind === "keepout");
  const words = found.map((o) => KEEPOUT_WORDS[o.detail] ?? "Keep-out");
  const totals = new Map<string, number>();
  for (const word of words) totals.set(word, (totals.get(word) ?? 0) + 1);
  const counted = new Map<string, number>();
  const keepouts = found.map((o, i): KeepoutChoice => {
    const b = quadBounds(o.quad);
    const word = words[i];
    const n = (counted.get(word) ?? 0) + 1;
    counted.set(word, n);
    return {
      id: o.id,
      detail: o.detail,
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
      w: b.maxX - b.minX,
      d: b.maxY - b.minY,
      kind: o.detail === "aisle" || o.detail === "egress" ? "aisle" : "no-go",
      label: (totals.get(word) ?? 0) > 1 ? `${word} ${n}` : word,
      convert: o.detail !== "door-swing",
    };
  });

  return { sizeLabel: `${feetLabel(w)} × ${feetLabel(h)}`, walls, columns, warnings, keepouts };
}

/** The ticked keep-outs as the layout's starting areas. */
export function keepoutsToAreas(choices: readonly KeepoutChoice[]): PlantLayoutArea[] {
  return choices
    .filter((c) => c.convert)
    .map((c, i) => ({
      uid: `a_d${String(i + 1).padStart(3, "0")}`,
      kind: c.kind,
      x: c.x,
      y: c.y,
      w: c.w,
      d: c.d,
      rot: 0,
      label: c.label.trim(),
      locked: false,
    }));
}
