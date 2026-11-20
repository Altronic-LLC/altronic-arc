// =============================================================================
// Plant Map geometry — pure, in inches, no React.
//
// A placed item is an ORIENTED rectangle: centre (x, y), real size (w × d),
// rotated `rot` degrees clockwise (SVG's y-down rotation). Overlap is the
// separating-axis test on convex polygons. TOUCHING is not an overlap — two
// benches pushed edge to edge are fine — so a projection gap of up to
// `EPSILON` counts as separate.
//
// A symbol that isn't a rectangle (an L-shaped bench, a stepped solder line)
// carries a COLLISION OUTLINE: its real shape as points in the symbol's own
// inches (the frame of its viewBox, 0…FootprintW × 0…FootprintD). The check
// then uses that shape, stretched to the item's size and turned with it, so
// something tucked into the notch of an L is not an overlap. A concave outline
// is cut into triangles (ear clipping) and every pair of pieces is tested;
// an outline that can't be cut (crossing edges, fewer than three points) falls
// back to the rectangle — the safe direction, since the box covers the shape.
//
// The rules a layout is checked against (the ones Publish enforces):
//   * An item whose component COLLIDES may not overlap a wall, a column or a
//     keep-out (aisle, dock, door swing, electrical clearance…), nor another
//     colliding item. Floor markings and zones don't collide.
//   * `Clearance` is carried on the component but not applied yet.
//   * An item MAY sit outside the building (Tim, 2026-11-11): emergency exits
//     and fire extinguishers on the safety layer are placed outside the walls,
//     so being outside the drawing's extent is not a problem. A colliding item
//     out there is still checked against walls, keep-outs and other items.
// These match the generator that built the test plans (gen_samples.py), and
// the two sample layouts pin them: the clean one has no problems, the other
// exactly three.
// =============================================================================

export type Point = readonly [number, number];
export type Quad = readonly [Point, Point, Point, Point];
/** A convex polygon, as its corners in order. */
export type ConvexPiece = readonly Point[];

const EPSILON = 1e-6;

export interface OrientedBox {
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
}

/** The four corners, clockwise from top-left before rotation. */
export function boxCorners({ x, y, w, d, rot }: OrientedBox): Quad {
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const at = (dx: number, dy: number): Point => [x + dx * c - dy * s, y + dx * s + dy * c];
  return [at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)];
}

/** An axis-aligned rectangle as a quad. */
export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function project(q: readonly Point[], ax: number, ay: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [px, py] of q) {
    const v = px * ax + py * ay;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/** Do two quads overlap by more than a touch? Separating-axis test. */
export function quadsOverlap(p: Quad, q: Quad): boolean {
  return convexOverlap(p, q);
}

/** Do two CONVEX polygons overlap by more than a touch? Separating-axis test. */
export function convexOverlap(p: ConvexPiece, q: ConvexPiece): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const ax = y1 - y2;
      const ay = x2 - x1;
      const [pMin, pMax] = project(p, ax, ay);
      const [qMin, qMax] = project(q, ax, ay);
      if (pMax <= qMin + EPSILON || qMax <= pMin + EPSILON) return false;
    }
  }
  return true;
}

/** The axis-aligned bounds of a quad (or any polygon). */
export function quadBounds(q: readonly Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// -----------------------------------------------------------------------------
// Collision outlines — symbols that aren't rectangles
// -----------------------------------------------------------------------------

/** A symbol's real shape: `points` in a frame `w × d` inches (its footprint). */
export interface CollisionOutline {
  points: readonly Point[];
  w: number;
  d: number;
}

/**
 * Read a stored outline — a JSON string or an array of `[x, y]` pairs. Anything
 * else, or fewer than three points, is null: the symbol is then checked as its
 * rectangle.
 */
export function parseCollisionPolygon(raw: unknown): Point[] | null {
  let value = raw;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const points: Point[] = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (p[0] === null || p[1] === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push([x, y]);
  }
  return points.length >= 3 ? points : null;
}

/** A component's outline in the shape the check wants, or null for "use the rectangle". */
export function collisionOutlineOf(
  c: { collisionPolygon?: readonly Point[] | null; footprintW: number; footprintD: number } | undefined,
): CollisionOutline | null {
  if (!c?.collisionPolygon || c.collisionPolygon.length < 3 || !(c.footprintW > 0 && c.footprintD > 0)) return null;
  return { points: c.collisionPolygon, w: c.footprintW, d: c.footprintD };
}

const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function signedArea(pts: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

const samePoint = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Drop repeated points (a closing copy of the first included) and points on a straight run. */
function cleanOutline(points: readonly Point[]): Point[] {
  let pts: Point[] = [];
  for (const p of points) if (pts.length === 0 || !samePoint(pts[pts.length - 1], p)) pts.push(p);
  while (pts.length > 1 && samePoint(pts[0], pts[pts.length - 1])) pts.pop();
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      if (Math.abs(cross(prev, pts[i], next)) < 1e-9) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Inside a counter-clockwise triangle, or on one of its edges. */
function insideTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  return cross(a, b, p) >= -EPSILON && cross(b, c, p) >= -EPSILON && cross(c, a, p) >= -EPSILON;
}

/**
 * An outline as convex pieces: itself when it's convex, else triangles cut by
 * ear clipping. Null when it can't be cut (a self-crossing outline).
 */
export function convexPieces(points: readonly Point[]): Point[][] | null {
  let pts = cleanOutline(points);
  if (pts.length < 3) return null;
  const area = signedArea(pts);
  if (Math.abs(area) < EPSILON) return null;
  if (area < 0) pts = [...pts].reverse();
  const n = pts.length;
  if (pts.every((p, i) => cross(pts[(i - 1 + n) % n], p, pts[(i + 1) % n]) > 0)) return [pts];
  const idx = pts.map((_, i) => i);
  const pieces: Point[][] = [];
  while (idx.length > 3) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k - 1 + idx.length) % idx.length];
      const ib = idx[k];
      const ic = idx[(k + 1) % idx.length];
      const [a, b, c] = [pts[ia], pts[ib], pts[ic]];
      if (cross(a, b, c) <= EPSILON) continue; // a reflex corner can't be an ear
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && insideTriangle(pts[j], a, b, c))) continue;
      pieces.push([a, b, c]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) return null;
  }
  const [a, b, c] = idx.map((i) => pts[i]);
  if (cross(a, b, c) <= EPSILON) return null;
  pieces.push([a, b, c]);
  return pieces;
}

const piecesCache = new WeakMap<readonly Point[], Point[][] | null>();

function cachedPieces(points: readonly Point[]): Point[][] | null {
  if (!piecesCache.has(points)) piecesCache.set(points, convexPieces(points));
  return piecesCache.get(points) ?? null;
}

/**
 * Where an item really is, as convex pieces in plan inches: its outline
 * stretched to its size, turned and moved — or its rectangle when it has none.
 */
export function itemPieces(it: OrientedBox & { outline?: CollisionOutline | null }): ConvexPiece[] {
  const outline = it.outline;
  const local = outline ? cachedPieces(outline.points) : null;
  if (!outline || !local) return [boxCorners(it)];
  const a = (it.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sx = it.w / outline.w;
  const sy = it.d / outline.d;
  const at = ([px, py]: Point): Point => {
    const dx = px * sx - it.w / 2;
    const dy = py * sy - it.d / 2;
    return [it.x + dx * c - dy * s, it.y + dx * s + dy * c];
  };
  return local.map((piece) => piece.map(at));
}

type Bounds = ReturnType<typeof quadBounds>;

const boundsApart = (a: Bounds, b: Bounds) =>
  a.maxX <= b.minX + EPSILON || b.maxX <= a.minX + EPSILON || a.maxY <= b.minY + EPSILON || b.maxY <= a.minY + EPSILON;

function piecesOverlap(a: readonly ConvexPiece[], b: readonly ConvexPiece[]): boolean {
  return a.some((p) => b.some((q) => convexOverlap(p, q)));
}

// -----------------------------------------------------------------------------
// Checking a layout
// -----------------------------------------------------------------------------

/** A wall, column or keep-out read out of the walls drawing. */
export interface Obstacle {
  id: string;
  kind: "wall" | "column" | "keepout";
  /** A keep-out's `data-kind` (aisle, dock, door-swing…), else "". */
  detail: string;
  /** A drawn area's label, named in the problem sentence. */
  label?: string;
  quad: Quad;
}

/**
 * The aisles and no-go areas drawn ON a layout, as keep-outs. They join the
 * walls drawing's own obstacles — a colliding item may not sit in one.
 */
export function areaObstacles(
  areas: readonly { uid: string; kind: string; x: number; y: number; w: number; d: number; rot: number; label: string }[],
): Obstacle[] {
  return areas.map((a) => ({
    id: a.uid,
    kind: "keepout" as const,
    detail: a.kind,
    label: a.label.trim() || undefined,
    quad: boxCorners(a),
  }));
}

export interface CheckableItem extends OrientedBox {
  uid: string;
  label: string;
  /** Unknown components count as colliding — the safe direction. */
  collides: boolean;
  /** The symbol's real shape when it isn't a rectangle; absent = the rectangle. */
  outline?: CollisionOutline | null;
}

export type LayoutProblem =
  | { kind: "obstacle"; uid: string; obstacle: Obstacle }
  | { kind: "overlap"; uid: string; other: string };

/**
 * Every problem with a layout, in item order. A pair overlapping is reported
 * once, against the earlier item.
 */
export function findLayoutProblems(
  items: readonly CheckableItem[],
  obstacles: readonly Obstacle[],
): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  // Each item's pieces and their bounds, worked out once. The bounds test
  // skips nearly every pair before the separating-axis test runs.
  const pieces = items.map((it) => itemPieces(it));
  const bounds = pieces.map((ps) => quadBounds(ps.flat()));
  const obstacleBounds = obstacles.map((o) => quadBounds(o.quad));
  items.forEach((it, i) => {
    if (!it.collides) return;
    obstacles.forEach((obstacle, k) => {
      if (boundsApart(bounds[i], obstacleBounds[k])) return;
      if (piecesOverlap(pieces[i], [obstacle.quad])) problems.push({ kind: "obstacle", uid: it.uid, obstacle });
    });
  });
  for (let i = 0; i < items.length; i++) {
    if (!items[i].collides) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!items[j].collides || boundsApart(bounds[i], bounds[j])) continue;
      if (piecesOverlap(pieces[i], pieces[j])) problems.push({ kind: "overlap", uid: items[i].uid, other: items[j].uid });
    }
  }
  return problems;
}

/** The uids of every item involved in a problem — both sides of an overlap. */
export function itemsWithProblems(problems: readonly LayoutProblem[]): Set<string> {
  const out = new Set<string>();
  for (const p of problems) {
    out.add(p.uid);
    if (p.kind === "overlap") out.add(p.other);
  }
  return out;
}

const OBSTACLE_WORDS: Record<string, string> = {
  aisle: "an aisle",
  dock: "a dock",
  "door-swing": "a door swing",
  electrical: "electrical clearance",
  egress: "an exit route",
  "overhead-door": "an overhead door",
  "no-go": "a no-go area",
};

/** One problem as a sentence, naming items by label. */
export function describeLayoutProblem(p: LayoutProblem, labelOf: (uid: string) => string): string {
  const name = labelOf(p.uid);
  if (p.kind === "overlap") return `${name} overlaps ${labelOf(p.other)}.`;
  const { obstacle } = p;
  if (obstacle.kind === "wall") return `${name} goes through a wall.`;
  if (obstacle.kind === "column") return `${name} sits on a column.`;
  const where = OBSTACLE_WORDS[obstacle.detail] ?? "a keep-out area";
  return obstacle.label ? `${name} sits in ${where} (${obstacle.label}).` : `${name} sits in ${where}.`;
}

/**
 * The angle an item's label is drawn at: along the item's LONG side, turned
 * with it, and never upside down — the way a CAD drawing labels a room or a
 * bench. Kept in [-90, 90), so vertical text reads bottom to top.
 */
export function labelAngle({ w, d, rot }: { w: number; d: number; rot: number }): number {
  const along = rot + (d > w ? 90 : 0);
  const a = ((along % 360) + 360) % 360;
  if (a < 90) return a;
  if (a < 270) return a - 180;
  return a - 360;
}

/** "240 ft × 140 ft" — inches as feet and inches, for people. */
export function feetLabel(inches: number): string {
  const whole = Math.round(inches);
  const ft = Math.floor(whole / 12);
  const inch = whole % 12;
  if (ft === 0) return `${inch} in`;
  return inch === 0 ? `${ft} ft` : `${ft} ft ${inch} in`;
}


/** What the check needs from an item's symbol. */
export interface ItemShape {
  collides: boolean;
  outline: CollisionOutline | null;
}

/**
 * A symbol's shape for the check. An unknown symbol collides, as a rectangle —
 * the safe direction.
 */
export function shapeOfComponent(
  c: { collides: boolean; collisionPolygon?: readonly Point[] | null; footprintW: number; footprintD: number } | undefined,
): ItemShape {
  return { collides: c?.collides ?? true, outline: collisionOutlineOf(c) };
}

/**
 * A saved layout's placement check — the ONE recipe, used by the layout page
 * and by Publish (which asks it again on fresh data before writing): its items
 * against the walls drawing's obstacles plus its own drawn areas. Where an item
 * sits relative to the building's extent doesn't matter (see the header).
 */
export function checkLayout(
  doc: {
    items: readonly (OrientedBox & { uid: string; label: string; componentId: number })[];
    areas?: Parameters<typeof areaObstacles>[0];
  },
  shapeOf: (componentId: number) => ItemShape,
  drawing: { obstacles: readonly Obstacle[] } | null,
): LayoutProblem[] {
  const items: CheckableItem[] = doc.items.map((it) => ({ ...it, ...shapeOf(it.componentId) }));
  const obstacles = [...(drawing?.obstacles ?? []), ...areaObstacles(doc.areas ?? [])];
  return findLayoutProblems(items, obstacles);
}
