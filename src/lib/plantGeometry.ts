// =============================================================================
// Plant Map geometry — pure, in inches, no React.
//
// A placed item is an ORIENTED rectangle: centre (x, y), real size (w × d),
// rotated `rot` degrees clockwise (SVG's y-down rotation). Overlap is the
// separating-axis test on two convex quadrilaterals. TOUCHING is not an
// overlap — two benches pushed edge to edge are fine — so a projection gap of
// up to `EPSILON` counts as separate.
//
// The rules a layout is checked against (the ones Publish will enforce):
//   * No part of an item may fall outside the building.
//   * An item whose component COLLIDES may not overlap a wall, a column or a
//     keep-out (aisle, dock, door swing, electrical clearance…), nor another
//     colliding item. Floor markings and zones don't collide.
//   * `Clearance` is carried on the component but not applied yet.
// These match the generator that built the test plans (gen_samples.py), and
// the two sample layouts pin them: the clean one has no problems, the other
// exactly three.
// =============================================================================

export type Point = readonly [number, number];
export type Quad = readonly [Point, Point, Point, Point];

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

function project(q: Quad, ax: number, ay: number): [number, number] {
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
  for (const poly of [p, q]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % 4];
      const ax = y1 - y2;
      const ay = x2 - x1;
      const [pMin, pMax] = project(p, ax, ay);
      const [qMin, qMax] = project(q, ax, ay);
      if (pMax <= qMin + EPSILON || qMax <= pMin + EPSILON) return false;
    }
  }
  return true;
}

/** The axis-aligned bounds of a quad. */
export function quadBounds(q: Quad): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Does any corner fall outside a building `w × h` inches? */
export function outsideExtent(q: Quad, extent: { w: number; h: number }): boolean {
  return q.some(([px, py]) => px < -EPSILON || py < -EPSILON || px > extent.w + EPSILON || py > extent.h + EPSILON);
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
}

export type LayoutProblem =
  | { kind: "outside"; uid: string }
  | { kind: "obstacle"; uid: string; obstacle: Obstacle }
  | { kind: "overlap"; uid: string; other: string };

/**
 * Every problem with a layout, in item order. A pair overlapping is reported
 * once, against the earlier item.
 */
export function findLayoutProblems(
  items: readonly CheckableItem[],
  obstacles: readonly Obstacle[],
  extent: { w: number; h: number },
): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const quads = items.map((it) => boxCorners(it));
  items.forEach((it, i) => {
    const q = quads[i];
    if (outsideExtent(q, extent)) problems.push({ kind: "outside", uid: it.uid });
    if (!it.collides) return;
    for (const obstacle of obstacles) {
      if (quadsOverlap(q, obstacle.quad)) problems.push({ kind: "obstacle", uid: it.uid, obstacle });
    }
  });
  for (let i = 0; i < items.length; i++) {
    if (!items[i].collides) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!items[j].collides) continue;
      if (quadsOverlap(quads[i], quads[j])) problems.push({ kind: "overlap", uid: items[i].uid, other: items[j].uid });
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
  if (p.kind === "outside") return `${name} goes outside the building.`;
  if (p.kind === "overlap") return `${name} overlaps ${labelOf(p.other)}.`;
  const { obstacle } = p;
  if (obstacle.kind === "wall") return `${name} goes through a wall.`;
  if (obstacle.kind === "column") return `${name} sits on a column.`;
  const where = OBSTACLE_WORDS[obstacle.detail] ?? "a keep-out area";
  return obstacle.label ? `${name} sits in ${where} (${obstacle.label}).` : `${name} sits in ${where}.`;
}

/** "240 ft × 140 ft" — inches as feet and inches, for people. */
export function feetLabel(inches: number): string {
  const whole = Math.round(inches);
  const ft = Math.floor(whole / 12);
  const inch = whole % 12;
  if (ft === 0) return `${inch} in`;
  return inch === 0 ? `${ft} ft` : `${ft} ft ${inch} in`;
}


/**
 * A saved layout's placement check — the ONE recipe, used by the layout page
 * and by Publish (which asks it again on fresh data before writing): its items
 * against the walls drawing's obstacles plus its own drawn areas, inside the
 * drawing's extent (the layout's own extent when there's no drawing).
 */
export function checkLayout(
  doc: {
    items: readonly (OrientedBox & { uid: string; label: string; componentId: number })[];
    areas?: Parameters<typeof areaObstacles>[0];
    extent: { w: number; h: number };
  },
  collidesOf: (componentId: number) => boolean,
  drawing: { obstacles: readonly Obstacle[]; extent: { w: number; h: number } } | null,
): LayoutProblem[] {
  const items: CheckableItem[] = doc.items.map((it) => ({ ...it, collides: collidesOf(it.componentId) }));
  const obstacles = [...(drawing?.obstacles ?? []), ...areaObstacles(doc.areas ?? [])];
  return findLayoutProblems(items, obstacles, drawing?.extent ?? doc.extent);
}
