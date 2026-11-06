import { PLANT_AREA_KIND_LABELS, type LayoutComponent, type PlantAreaKind, type PlantLayoutArea, type PlantLayoutItem } from "@/types/plant";

// =============================================================================
// The layout editor's state — pure, so every edit and its undo is testable
// without a pointer in sight.
//
// The editor holds a layout's ITEMS plus an undo and a redo stack of earlier
// item lists. Every edit is one action; an action that changes nothing adds
// nothing to the history, so a click that doesn't move an item can't fill the
// undo stack. A drag is ONE action, committed on release — the editor shows
// the in-between positions itself without touching the history.
//
// Sizes and positions are inches; a position is the item's CENTRE.
// =============================================================================

export const DEFAULT_GRID_INCHES = 6;
export const HISTORY_LIMIT = 100;
/** A duplicate lands this far right and down of the original. */
export const DUPLICATE_OFFSET = 24;

/** What the editor edits — the layout's items and its drawn areas. */
export interface EditorDoc {
  items: PlantLayoutItem[];
  areas: PlantLayoutArea[];
}

export interface EditorState extends EditorDoc {
  past: EditorDoc[];
  future: EditorDoc[];
}

/** A change to an item or an area. Keys one doesn't have are ignored for it. */
export type ItemPatch = Partial<
  Pick<PlantLayoutItem, "x" | "y" | "w" | "d" | "rot" | "label" | "locked" | "equipmentId"> & Pick<PlantLayoutArea, "kind">
>;

export type EditorAction =
  | { type: "add"; item: PlantLayoutItem }
  | { type: "addArea"; area: PlantLayoutArea }
  /** Finds the uid among the items, then the areas. */
  | { type: "update"; uid: string; patch: ItemPatch }
  | { type: "delete"; uid: string }
  | { type: "duplicate"; uid: string; newUid: string }
  | { type: "undo" }
  | { type: "redo" }
  /** After a save: what was saved, with the history kept. */
  | { type: "saved"; doc: EditorDoc };

/** Takes the doc, or (older callers) just its items. */
export function initialEditorState(doc: EditorDoc | PlantLayoutItem[]): EditorState {
  const d = Array.isArray(doc) ? { items: doc, areas: [] } : doc;
  return { items: d.items.map((i) => ({ ...i })), areas: (d.areas ?? []).map((a) => ({ ...a })), past: [], future: [] };
}

function snapshot(state: EditorState): EditorDoc {
  return { items: state.items, areas: state.areas };
}

function commit(state: EditorState, next: Partial<EditorDoc>): EditorState {
  const past = [...state.past, snapshot(state)].slice(-HISTORY_LIMIT);
  return { items: next.items ?? state.items, areas: next.areas ?? state.areas, past, future: [] };
}

const ITEM_KEYS = ["x", "y", "w", "d", "rot", "label", "locked", "equipmentId"] as const;
const AREA_KEYS = ["x", "y", "w", "d", "rot", "label", "locked", "kind"] as const;

/** The patch, keeping only keys this shape has and that were given. */
function relevant(patch: ItemPatch, keys: readonly (keyof ItemPatch)[]): ItemPatch {
  const out: ItemPatch = {};
  for (const k of keys) if (patch[k] !== undefined) (out as Record<string, unknown>)[k] = patch[k];
  return out;
}

function changes(shape: object, patch: ItemPatch): boolean {
  return Object.entries(patch).some(([k, v]) => (shape as Record<string, unknown>)[k] !== v);
}

/** A locked shape only takes the change that unlocks it, its label, kind or asset. */
function lockFilter(locked: boolean, patch: ItemPatch): ItemPatch {
  if (!locked || patch.locked === false) return patch;
  return relevant(patch, ["label", "equipmentId", "kind"]);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "add":
      return commit(state, { items: [...state.items, action.item] });
    case "addArea":
      return commit(state, { areas: [...state.areas, action.area] });
    case "update": {
      const item = state.items.find((i) => i.uid === action.uid);
      if (item) {
        const patch = lockFilter(item.locked, relevant(action.patch, ITEM_KEYS));
        if (!changes(item, patch)) return state;
        return commit(state, { items: state.items.map((i) => (i.uid === action.uid ? { ...i, ...patch } : i)) });
      }
      const area = state.areas.find((a) => a.uid === action.uid);
      if (!area) return state;
      const patch = lockFilter(area.locked, relevant(action.patch, AREA_KEYS));
      if (!changes(area, patch)) return state;
      return commit(state, { areas: state.areas.map((a) => (a.uid === action.uid ? { ...a, ...patch } : a)) });
    }
    case "delete": {
      if (state.items.some((i) => i.uid === action.uid)) {
        return commit(state, { items: state.items.filter((i) => i.uid !== action.uid) });
      }
      if (state.areas.some((a) => a.uid === action.uid)) {
        return commit(state, { areas: state.areas.filter((a) => a.uid !== action.uid) });
      }
      return state;
    }
    case "duplicate": {
      const item = state.items.find((i) => i.uid === action.uid);
      if (item) {
        const copy: PlantLayoutItem = {
          ...item,
          uid: action.newUid,
          x: item.x + DUPLICATE_OFFSET,
          y: item.y + DUPLICATE_OFFSET,
          // A copy is a new physical thing: it isn't the same asset, and it isn't pinned.
          equipmentId: null,
          locked: false,
        };
        return commit(state, { items: [...state.items, copy] });
      }
      const area = state.areas.find((a) => a.uid === action.uid);
      if (!area) return state;
      const copy: PlantLayoutArea = {
        ...area,
        uid: action.newUid,
        x: area.x + DUPLICATE_OFFSET,
        y: area.y + DUPLICATE_OFFSET,
        locked: false,
      };
      return commit(state, { areas: [...state.areas, copy] });
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { ...previous, past: state.past.slice(0, -1), future: [snapshot(state), ...state.future] };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...next, past: [...state.past, snapshot(state)], future: rest };
    }
    case "saved":
      return {
        ...state,
        items: action.doc.items.map((i) => ({ ...i })),
        areas: (action.doc.areas ?? []).map((a) => ({ ...a })),
      };
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Round to the grid; a grid of 0 (snap off) rounds to the nearest inch. */
export function snap(value: number, grid: number): number {
  const step = grid > 0 ? grid : 1;
  return Math.round(value / step) * step;
}

/** Degrees into 0 … 359, whole degrees. */
export function normaliseRotation(deg: number): number {
  const r = Math.round(deg) % 360;
  return r < 0 ? r + 360 : r;
}

/** The size a component may be stretched to, given its scale limits. */
export function sizeLimits(c: LayoutComponent): { minW: number; maxW: number; minD: number; maxD: number } {
  if (!c.allowResize) return { minW: c.footprintW, maxW: c.footprintW, minD: c.footprintD, maxD: c.footprintD };
  const lo = Math.min(c.minScale, c.maxScale) || 1;
  const hi = Math.max(c.minScale, c.maxScale) || 1;
  return { minW: c.footprintW * lo, maxW: c.footprintW * hi, minD: c.footprintD * lo, maxD: c.footprintD * hi };
}

/** A typed size, held inside the component's limits. */
export function clampSize(c: LayoutComponent, w: number, d: number): { w: number; d: number } {
  const lim = sizeLimits(c);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  return { w: round2(clamp(w, lim.minW, lim.maxW)), d: round2(clamp(d, lim.minD, lim.maxD)) };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * A uid not already on the layout. `random` is injectable for tests. Areas
 * pass `prefix: "a"` and their own list — items and areas never share a uid.
 */
export function newItemUid(
  taken: readonly { uid: string }[],
  random: () => number = Math.random,
  prefix: "i" | "a" = "i",
): string {
  const used = new Set(taken.map((i) => i.uid));
  for (;;) {
    const uid = `${prefix}_${Math.floor(random() * 0xffffff)
      .toString(16)
      .padStart(6, "0")}`;
    if (!used.has(uid)) return uid;
  }
}

/** "CNC Lathe (generic) 3" — the component's name, numbered past the ones already placed. */
export function nextItemLabel(component: LayoutComponent, items: readonly PlantLayoutItem[]): string {
  const used = items.filter((i) => i.componentId === component.id).length;
  return used === 0 ? component.title : `${component.title} ${used + 1}`;
}

/** A component placed at a point, at its own footprint, snapped to the grid. */
export function placeComponent(
  component: LayoutComponent,
  point: { x: number; y: number },
  items: readonly PlantLayoutItem[],
  grid: number,
  random?: () => number,
): PlantLayoutItem {
  return {
    uid: newItemUid(items, random),
    componentId: component.id,
    componentVersion: component.version,
    x: snap(point.x, grid),
    y: snap(point.y, grid),
    w: component.footprintW,
    d: component.footprintD,
    rot: 0,
    label: nextItemLabel(component, items),
    equipmentId: null,
    locked: false,
  };
}

/** A client (screen) point → inches on the plan, from the drawing's on-screen box. */
export function clientToPlan(
  client: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  extent: { w: number; h: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((client.x - rect.left) / rect.width) * extent.w,
    y: ((client.y - rect.top) / rect.height) * extent.h,
  };
}

/** Same item lists, by value. */
export function sameItems(a: readonly PlantLayoutItem[], b: readonly PlantLayoutItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Same items AND areas — for "are there unsaved changes". */
export function sameDoc(a: EditorDoc, b: EditorDoc): boolean {
  return sameItems(a.items, b.items) && JSON.stringify(a.areas) === JSON.stringify(b.areas);
}

/** An area smaller than this either way is a stray click, not a drawing. */
export const MIN_AREA_INCHES = 12;

/**
 * A drawn rectangle → an area of that kind, corners snapped to the grid,
 * labelled "Aisle 2" etc. Null when it's too small to be meant.
 */
export function areaFromCorners(
  a: { x: number; y: number },
  b: { x: number; y: number },
  kind: PlantAreaKind,
  areas: readonly PlantLayoutArea[],
  grid: number,
  random?: () => number,
): PlantLayoutArea | null {
  const x1 = snap(Math.min(a.x, b.x), grid);
  const x2 = snap(Math.max(a.x, b.x), grid);
  const y1 = snap(Math.min(a.y, b.y), grid);
  const y2 = snap(Math.max(a.y, b.y), grid);
  const w = x2 - x1;
  const d = y2 - y1;
  if (w < MIN_AREA_INCHES || d < MIN_AREA_INCHES) return null;
  const same = areas.filter((x) => x.kind === kind).length;
  const name = PLANT_AREA_KIND_LABELS[kind];
  return {
    uid: newItemUid(areas, random, "a"),
    kind,
    x: x1 + w / 2,
    y: y1 + d / 2,
    w,
    d,
    rot: 0,
    label: same === 0 ? name : `${name} ${same + 1}`,
    locked: false,
  };
}

/** An area's size: at least MIN_AREA_INCHES, to the whole inch. */
export function clampAreaSize(w: number, d: number): { w: number; d: number } {
  const fix = (v: number) => Math.max(MIN_AREA_INCHES, Math.round(Number.isFinite(v) ? v : MIN_AREA_INCHES));
  return { w: fix(w), d: fix(d) };
}
