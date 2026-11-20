import DOMPurify from "dompurify";
import { rectQuad, type Obstacle } from "./plantGeometry";

// =============================================================================
// Plant Map SVGs — wall drawings and component symbols.
//
// **Every SVG read from SharePoint goes through `sanitiseSvg` before it is
// shown or parsed** (invariant #5's rule, for SVG): an SVG can carry
// `<script>`, `onload=`, `<foreignObject>` with HTML in it, or an external
// reference. They are then shown as `<image href="data:image/svg+xml…">`,
// never injected into the page — an SVG drawn as an image runs no script and
// loads nothing, so it is sandboxed twice over.
//
// The wall drawing's conventions (scripts in the design folder, and the made-up
// test plans in src/data/plantMock):
//   * `viewBox="0 0 W H"` is the building's real size in INCHES, origin top
//     left, no transform. `data-units="in"` on the root (absent = inches).
//   * Walls, columns and keep-outs are axis-aligned `<rect>`s with ids, in
//     `<g id="walls">`, `<g id="columns">` and `<g id="keepout">`; a keep-out
//     names what it is in `data-kind` (aisle, dock, door-swing…). That's what
//     the overlap check reads. A drawing without those groups still shows; it
//     just has nothing to collide with.
// =============================================================================

/** A walls file bigger than this is refused — a cleaned CAD export is well under. */
export const MAX_WALLS_SVG_BYTES = 2 * 1024 * 1024;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Clean an SVG for display. Returns "" for anything that isn't an SVG.
 *
 * `<metadata>` is cut out FIRST, contents and all: tools stamp large blobs in
 * there (the test plans carried a C2PA manifest), and a removed element's text
 * would otherwise be kept as stray text. `SANITIZE_DOM` is off because the
 * result is only ever drawn as an image, never put in the page — the DOM
 * clobbering it protects against can't happen, and it would strip ordinary
 * ids like "body" that the drawings use.
 */
export function sanitiseSvg(raw: string | null | undefined): string {
  if (!raw) return "";
  const stripped = raw
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, "")
    .replace(/<metadata[^>]*\/>/gi, "");
  const clean = DOMPurify.sanitize(stripped, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "style", "foreignObject", "a", "image", "use", "feImage"],
    FORBID_ATTR: ["href", "xlink:href", "style", "onload", "onerror", "onclick"],
    SANITIZE_DOM: false,
  }).trim();
  if (!/^<svg[\s>]/i.test(clean)) return "";
  // Serialised out of an HTML document, the root may lose its namespace, and
  // an SVG drawn as an image renders nothing without one.
  return /^<svg[^>]*\sxmlns=/i.test(clean) ? clean : clean.replace(/^<svg/i, `<svg xmlns="${SVG_NS}"`);
}

/** A sanitised SVG as an `<image href>` — percent-encoded, so no base64 cost. */
export function svgDataUrl(cleanSvg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanSvg)}`;
}

function parseSvg(clean: string): SVGSVGElement | null {
  if (!clean) return null;
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length > 0) return null;
  return root as unknown as SVGSVGElement;
}

/** The viewBox as numbers, or null. */
export function readViewBox(root: Element): { x: number; y: number; w: number; h: number } | null {
  const raw = root.getAttribute("viewBox");
  if (!raw) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function num(el: Element, attr: string): number | null {
  const v = Number(el.getAttribute(attr));
  return el.hasAttribute(attr) && Number.isFinite(v) ? v : null;
}

const OBSTACLE_GROUPS: { group: string; kind: Obstacle["kind"] }[] = [
  { group: "walls", kind: "wall" },
  { group: "columns", kind: "column" },
  { group: "keepout", kind: "keepout" },
];

function obstacleGroup(root: Element, group: string): Element | undefined {
  return Array.from(root.getElementsByTagName("g")).find((el) => el.getAttribute("id") === group);
}

/** A rect's obstacle id: its own, or its place in the group — the same rule wherever it's looked up. */
function obstacleId(rect: Element, group: string, i: number): string {
  return rect.getAttribute("id") || `${group}-${i + 1}`;
}

/**
 * The walls, columns and keep-outs a placed item may not overlap — and how
 * many shapes in those groups ARC couldn't place (anything but a plain rect
 * with a size, or one with a transform), so the review can say so.
 */
export function scanObstacles(root: Element): { obstacles: Obstacle[]; skipped: number } {
  const obstacles: Obstacle[] = [];
  let skipped = 0;
  for (const { group, kind } of OBSTACLE_GROUPS) {
    const g = obstacleGroup(root, group);
    if (!g) continue;
    // Paths, polygons and lines in a group are drawn but can't be checked.
    for (const tag of ["path", "polygon", "polyline", "line", "circle", "ellipse"]) skipped += g.getElementsByTagName(tag).length;
    Array.from(g.getElementsByTagName("rect")).forEach((rect, i) => {
      const x = num(rect, "x") ?? 0;
      const y = num(rect, "y") ?? 0;
      const w = num(rect, "width");
      const h = num(rect, "height");
      // A rect with a transform isn't where its attributes say — skip it rather than guess.
      if (w === null || h === null || w <= 0 || h <= 0 || rect.hasAttribute("transform")) {
        skipped += 1;
        return;
      }
      obstacles.push({
        id: obstacleId(rect, group, i),
        kind,
        detail: kind === "keepout" ? (rect.getAttribute("data-kind") ?? "") : "",
        quad: rectQuad(x, y, w, h),
      });
    });
  }
  return { obstacles, skipped };
}

/** The walls, columns and keep-outs a placed item may not overlap. */
export function readObstacles(root: Element): Obstacle[] {
  return scanObstacles(root).obstacles;
}

/**
 * A sanitised drawing with some of its keep-outs taken out — the ones the
 * New layout review turned into editable areas. Matched by obstacle id (see
 * `obstacleId`), so an unnamed rect is found by its place in the group. Any
 * other shape is left exactly as it was.
 */
export function removeKeepouts(cleanSvg: string, ids: ReadonlySet<string>): string {
  if (ids.size === 0) return cleanSvg;
  const root = parseSvg(cleanSvg);
  const g = root && obstacleGroup(root, "keepout");
  if (!root || !g) return cleanSvg;
  const doomed = Array.from(g.getElementsByTagName("rect")).filter((rect, i) => ids.has(obstacleId(rect, "keepout", i)));
  if (doomed.length === 0) return cleanSvg;
  doomed.forEach((rect) => rect.parentNode?.removeChild(rect));
  return new XMLSerializer().serializeToString(root);
}

export interface WallsDrawing {
  /** Sanitised — safe to draw as an image. */
  svg: string;
  extent: { w: number; h: number };
  obstacles: Obstacle[];
  /** Shapes in the walls / columns / keepout groups ARC couldn't place, so can't check against. */
  skipped: number;
  /** `data-building` on the root, if the drawing names itself. */
  building: string;
}

export type WallsCheck = { ok: true; drawing: WallsDrawing } | { ok: false; problem: string };

/**
 * Read a walls drawing, saying what's wrong with one ARC can't use. Used when
 * one is uploaded (so a bad file is refused before anything is written) and
 * every time one is shown.
 */
export function readWallsSvg(raw: string): WallsCheck {
  if (!raw.trim()) return { ok: false, problem: "That file is empty." };
  const svg = sanitiseSvg(raw);
  const root = parseSvg(svg);
  if (!root) return { ok: false, problem: "That file isn't an SVG drawing ARC can read." };
  const box = readViewBox(root);
  if (!box) {
    return {
      ok: false,
      problem: 'The drawing has no viewBox. Export it with viewBox="0 0 <width> <height>" in inches.',
    };
  }
  if (box.x !== 0 || box.y !== 0) {
    return { ok: false, problem: "The drawing's viewBox must start at 0 0 (the building's top-left corner)." };
  }
  const units = (root.getAttribute("data-units") ?? "in").trim().toLowerCase();
  if (units !== "in") {
    return { ok: false, problem: `The drawing is in "${units}". Plant Map layouts are in inches — export it in inches.` };
  }
  const { obstacles, skipped } = scanObstacles(root);
  return {
    ok: true,
    drawing: {
      svg,
      extent: { w: box.w, h: box.h },
      obstacles,
      skipped,
      building: (root.getAttribute("data-building") ?? "").trim(),
    },
  };
}
