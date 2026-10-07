// =============================================================================
// ER diagram layout — pure geometry for the About page's Data model.
//
// Tables used to carry hand-placed x/y. With 60+ lists that drifted into
// overlapping cards and connectors running through other cards, and every new
// list meant re-nudging its neighbours. Now each table names a GROUP (its
// department) and this file places everything:
//
//   1. Within a group, tables fill columns masonry-style — each one goes to
//      the shortest column, in declaration order. The column count is chosen
//      to keep the block a readable landscape shape.
//   2. Groups are packed left-to-right in rows ("shelves"), in the order the
//      groups are declared, wrapping at MAX_CANVAS_WIDTH.
//
// Every gap is wide enough for a connector to route through, so no two cards
// can overlap and a line never has to cross a card to leave its own.
// =============================================================================

export type ErColumnKind = "pk" | "field" | "fk";

export interface ErColumn {
  name: string;
  type: string;
  kind: ErColumnKind;
  /** Where this FK points, e.g. "Project.id" or "Person.id[]". */
  references?: string;
}

export interface ErTable {
  name: string;
  /** SharePoint list display name (or "Concept" for shared/derived ones). */
  source: string;
  palette: "entity" | "shared";
  /** The id of the ErGroup this table is drawn in. */
  group: string;
  /** Card width — set per table so its longest column name fits. */
  width: number;
  columns: ErColumn[];
}

export interface ErGroup {
  id: string;
  label: string;
}

export interface ErConnection {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  fromCard: "one" | "many";
  toCard: "one" | "many";
}

export interface PlacedTable extends ErTable {
  x: number;
  y: number;
  height: number;
}

export interface PlacedGroup extends ErGroup {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ErLayout {
  tables: PlacedTable[];
  groups: PlacedGroup[];
  width: number;
  height: number;
}

export const HEADER_HEIGHT = 50;
export const ROW_HEIGHT = 22;
const TABLE_PAD_BOTTOM = 6;

/** Horizontal gap between table columns — room for a connector's bend. */
export const TABLE_GAP_X = 56;
const TABLE_GAP_Y = 36;
/** Padding inside a group's frame, and the band its title sits in. */
const GROUP_PAD = 24;
const GROUP_TITLE = 34;
const GROUP_GAP = 48;
const CANVAS_MARGIN = 20;
export const MAX_CANVAS_WIDTH = 2400;
/** The block shape a group aims for: a little wider than tall. */
const TARGET_ASPECT = 1.4;
/** How much taller a group may make the row it joins before it starts a new one. */
const MAX_ROW_GROWTH = 1.3;

export function tableHeight(t: { columns: unknown[] }): number {
  return HEADER_HEIGHT + t.columns.length * ROW_HEIGHT + TABLE_PAD_BOTTOM;
}

/** Y coordinate of a column's centre (a connector's endpoint). */
export function rowCenterY(t: PlacedTable, columnName: string): number {
  const idx = Math.max(
    0,
    t.columns.findIndex((c) => c.name === columnName),
  );
  return t.y + HEADER_HEIGHT + idx * ROW_HEIGHT + ROW_HEIGHT / 2;
}

interface Block {
  width: number;
  height: number;
  /** Table positions relative to the block's inner top-left. */
  placed: { table: ErTable; dx: number; dy: number }[];
}

/** Masonry: each table to the currently shortest column, in order. */
function masonry(tables: ErTable[], columnCount: number): Block {
  const cols: { tables: ErTable[]; offsets: number[]; height: number }[] = Array.from(
    { length: columnCount },
    () => ({ tables: [], offsets: [], height: 0 }),
  );
  for (const t of tables) {
    let target = cols[0];
    for (const c of cols) if (c.height < target.height) target = c;
    target.offsets.push(target.height === 0 ? 0 : target.height + TABLE_GAP_Y);
    target.height = target.offsets[target.offsets.length - 1] + tableHeight(t);
    target.tables.push(t);
  }
  const used = cols.filter((c) => c.tables.length > 0);
  const placed: Block["placed"] = [];
  let x = 0;
  for (const c of used) {
    const colWidth = Math.max(...c.tables.map((t) => t.width));
    c.tables.forEach((t, i) => placed.push({ table: t, dx: x, dy: c.offsets[i] }));
    x += colWidth + TABLE_GAP_X;
  }
  return {
    width: x - TABLE_GAP_X,
    height: Math.max(...used.map((c) => c.height)),
    placed,
  };
}

const frameWidth = (b: Block) => b.width + GROUP_PAD * 2;
const frameHeight = (b: Block) => b.height + GROUP_PAD * 2 + GROUP_TITLE;

/** Every column count's block for a group, narrowest first. */
function blockOptions(tables: ErTable[]): Block[] {
  const all: Block[] = [];
  for (let k = 1; k <= tables.length; k++) all.push(masonry(tables, k));
  return all;
}

/** A group on its own: the shape closest to TARGET_ASPECT that fits the canvas. */
function standaloneBlock(options: Block[]): Block {
  const fits = options.filter((b) => frameWidth(b) <= MAX_CANVAS_WIDTH - CANVAS_MARGIN * 2);
  const pool = fits.length > 0 ? fits : [options[0]];
  let best = pool[0];
  for (const b of pool) {
    const cost = Math.abs(Math.log(b.width / b.height) - Math.log(TARGET_ASPECT));
    const bestCost = Math.abs(Math.log(best.width / best.height) - Math.log(TARGET_ASPECT));
    if (cost < bestCost) best = b;
  }
  return best;
}

/**
 * A group joining a row that already has something in it: of the shapes that
 * fit the width left, the one whose height best matches the row's — so the
 * row fills out instead of leaving a tall empty strip beside a short group.
 * Null when nothing fits, and the group starts a new row.
 */
function shelfBlock(options: Block[], widthLeft: number, rowHeight: number): Block | null {
  const fits = options.filter((b) => frameWidth(b) <= widthLeft);
  if (fits.length === 0) return null;
  let best = fits[0];
  const miss = (b: Block) => {
    const h = frameHeight(b);
    // Growing the row costs every group already in it, so overshooting is
    // penalised more than falling short.
    return h > rowHeight ? (h - rowHeight) * 2 : rowHeight - h;
  };
  for (const b of fits) if (miss(b) < miss(best)) best = b;
  // Squeezing into a narrow leftover turns a group into a tall single column
  // that drags the whole row down with it — a fresh row is better than that.
  // Measured against the group's OWN preferred height, so a group that is
  // simply taller than the row may still join it.
  const natural = frameHeight(standaloneBlock(options));
  if (frameHeight(best) > Math.max(rowHeight, natural) * MAX_ROW_GROWTH) return null;
  return best;
}

export function layoutEr(tables: ErTable[], groups: ErGroup[]): ErLayout {
  const placedTables: PlacedTable[] = [];
  const placedGroups: PlacedGroup[] = [];

  let shelfX = CANVAS_MARGIN;
  let shelfY = CANVAS_MARGIN;
  let shelfHeight = 0;
  let canvasWidth = 0;

  for (const group of groups) {
    const members = tables.filter((t) => t.group === group.id);
    if (members.length === 0) continue;

    const options = blockOptions(members);
    let block: Block | null = null;
    if (shelfX > CANVAS_MARGIN) {
      block = shelfBlock(options, MAX_CANVAS_WIDTH - CANVAS_MARGIN - shelfX, shelfHeight);
      if (!block) {
        shelfX = CANVAS_MARGIN;
        shelfY += shelfHeight + GROUP_GAP;
        shelfHeight = 0;
      }
    }
    if (!block) block = standaloneBlock(options);
    const frameW = frameWidth(block);
    const frameH = frameHeight(block);

    placedGroups.push({ ...group, x: shelfX, y: shelfY, width: frameW, height: frameH });
    for (const p of block.placed) {
      placedTables.push({
        ...p.table,
        x: shelfX + GROUP_PAD + p.dx,
        y: shelfY + GROUP_PAD + GROUP_TITLE + p.dy,
        height: tableHeight(p.table),
      });
    }

    canvasWidth = Math.max(canvasWidth, shelfX + frameW);
    shelfX += frameW + GROUP_GAP;
    shelfHeight = Math.max(shelfHeight, frameH);
  }

  return {
    tables: placedTables,
    groups: placedGroups,
    width: canvasWidth + CANVAS_MARGIN,
    height: shelfY + shelfHeight + CANVAS_MARGIN,
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Does a horizontal (or vertical) segment pass THROUGH a card? Touching an edge doesn't count. */
function hitsH(y: number, x1: number, x2: number, r: Rect): boolean {
  const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1];
  return y > r.y && y < r.y + r.height && a < r.x + r.width && b > r.x;
}
function hitsV(x: number, y1: number, y2: number, r: Rect): boolean {
  const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1];
  return x > r.x && x < r.x + r.width && a < r.y + r.height && b > r.y;
}

/** How many cards a three-leg route (out, along, in) passes through. */
function crossings(sx: number, sy: number, bx: number, tx: number, ty: number, obstacles: Rect[]): number {
  let n = 0;
  for (const r of obstacles) {
    if (hitsH(sy, sx, bx, r) || hitsV(bx, sy, ty, r) || hitsH(ty, bx, tx, r)) n++;
  }
  return n;
}

/** Room left beside a card for the crow's-foot marker before a line may bend. */
const MARKER_CLEARANCE = 18;

/**
 * A connector's path between two placed tables, as right angles: out of a
 * card edge, along a vertical "bend", and into the other card's edge.
 *
 * Every plausible bend is tried — in each gutter between card columns
 * (`obstacles` supplies the cards), plus just outside each end — for both
 * shapes: a Z out of the facing edges, and a C round the outside of both
 * cards (the only shape for two cards stacked in one column). The route that
 * passes through the fewest cards wins, then the shortest. A line will still
 * cross a card when no clear route exists, but a clear one is never missed.
 *
 * `lane` (any integer) nudges the bend a few pixels, so several connectors
 * sharing a gutter don't draw on top of one another.
 */
export function routeConnection(
  from: PlacedTable,
  fromY: number,
  to: PlacedTable,
  toY: number,
  lane: number,
  obstacles: Rect[] = [],
): string {
  const nudge = ((((lane % 5) + 5) % 5) - 2) * 4; // -8 … +8
  const fromRight = from.x + from.width;
  const toRight = to.x + to.width;

  const gutters = new Set<number>();
  for (const r of [...obstacles, from, to]) {
    gutters.add(r.x - TABLE_GAP_X / 2);
    gutters.add(r.x + r.width + TABLE_GAP_X / 2);
  }

  // Each option: which edge it leaves from (sx) and arrives at (tx), and the
  // range its bend may sit in so it never doubles back over its own card.
  const options: { sx: number; tx: number; lo: number; hi: number }[] = [];
  if (fromRight + MARKER_CLEARANCE <= to.x - MARKER_CLEARANCE) {
    options.push({ sx: fromRight, tx: to.x, lo: fromRight + MARKER_CLEARANCE, hi: to.x - MARKER_CLEARANCE });
  }
  if (toRight + MARKER_CLEARANCE <= from.x - MARKER_CLEARANCE) {
    options.push({ sx: from.x, tx: toRight, lo: toRight + MARKER_CLEARANCE, hi: from.x - MARKER_CLEARANCE });
  }
  const outerRight = Math.max(fromRight, toRight) + MARKER_CLEARANCE;
  options.push({ sx: fromRight, tx: toRight, lo: outerRight, hi: Infinity });
  const outerLeft = Math.min(from.x, to.x) - MARKER_CLEARANCE;
  options.push({ sx: from.x, tx: to.x, lo: -Infinity, hi: outerLeft });

  let best = { cost: Infinity, length: Infinity, d: "" };
  for (const o of options) {
    const candidates = [...gutters].filter((g) => g >= o.lo && g <= o.hi);
    if (Number.isFinite(o.lo)) candidates.push(o.lo + 4);
    if (Number.isFinite(o.hi)) candidates.push(o.hi - 4);
    if (Number.isFinite(o.lo) && Number.isFinite(o.hi)) candidates.push((o.lo + o.hi) / 2);
    for (const g of candidates) {
      const bx = Math.min(o.hi, Math.max(o.lo, g + nudge));
      const cost = crossings(o.sx, fromY, bx, o.tx, toY, obstacles.filter((r) => r !== from && r !== to));
      const length = Math.abs(bx - o.sx) + Math.abs(toY - fromY) + Math.abs(o.tx - bx);
      if (cost < best.cost || (cost === best.cost && length < best.length)) {
        best = { cost, length, d: `M ${o.sx} ${fromY} H ${bx} V ${toY} H ${o.tx}` };
      }
    }
  }
  return best.d;
}
