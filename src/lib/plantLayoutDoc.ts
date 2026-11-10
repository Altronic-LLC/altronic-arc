import {
  PLANT_AREA_KINDS,
  type PlantAreaKind,
  type PlantLayout,
  type PlantLayoutArea,
  type PlantLayoutDoc,
  type PlantLayoutItem,
} from "@/types/plant";

// =============================================================================
// The `LayoutJson` column — a whole layout in one JSON value, so a save is ONE
// write (SharePoint has no transactions; one row per placed item could be
// left half-saved). A plain multi-line column holds about 64,000 characters,
// which is a few hundred placed items.
//
// Reading is strict about the SHAPE and tolerant about details:
//   * A value ARC can't parse — not JSON, not an object, no items array, a
//     schema from the future — is `corrupt`. The screen says so and **ARC
//     never writes over it** (the ECN checklist rule): replacing data we
//     failed to read is worse than an error message.
//   * A single item (or area) missing its uid or with a non-number position
//     is dropped and counted, rather than throwing away the rest of the layout.
//   * `areas` was added after the first layouts: a layout without it has none.
// =============================================================================

export const PLANT_LAYOUT_SCHEMA = 1;

/**
 * The largest LayoutJson ARC will write. Measured, not assumed: on
 * 2026-11-10 scripts/test-plant-layout-json-size.ps1 wrote values up to
 * 1,000,000 characters to the live column and read each back identical. The
 * old 63,000 was the UI's documented limit, which the API doesn't apply. A
 * layout past this is refused rather than risk SharePoint cutting it off.
 */
export const LAYOUT_JSON_MAX_CHARS = 1_000_000;

export type LayoutDocRead =
  | { ok: true; doc: PlantLayoutDoc; dropped: number }
  | { ok: false; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finite(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function readItem(raw: unknown): PlantLayoutItem | null {
  if (!isObject(raw)) return null;
  const uid = typeof raw.uid === "string" ? raw.uid.trim() : "";
  const componentId = finite(raw.componentId);
  const x = finite(raw.x);
  const y = finite(raw.y);
  const w = finite(raw.w);
  const d = finite(raw.d);
  if (!uid || componentId === null || x === null || y === null || w === null || d === null || w <= 0 || d <= 0) {
    return null;
  }
  const equipmentId = finite(raw.equipmentId);
  return {
    uid,
    componentId,
    componentVersion: finite(raw.componentVersion) ?? 1,
    x,
    y,
    w,
    d,
    rot: finite(raw.rot) ?? 0,
    label: typeof raw.label === "string" ? raw.label : "",
    equipmentId: equipmentId !== null && equipmentId > 0 ? equipmentId : null,
    locked: raw.locked === true,
  };
}

function readArea(raw: unknown): PlantLayoutArea | null {
  if (!isObject(raw)) return null;
  const uid = typeof raw.uid === "string" ? raw.uid.trim() : "";
  const x = finite(raw.x);
  const y = finite(raw.y);
  const w = finite(raw.w);
  const d = finite(raw.d);
  if (!uid || x === null || y === null || w === null || d === null || w <= 0 || d <= 0) return null;
  // An area kind this version doesn't know is read as a no-go area — the safe direction.
  const kind: PlantAreaKind = (PLANT_AREA_KINDS as readonly unknown[]).includes(raw.kind) ? (raw.kind as PlantAreaKind) : "no-go";
  return {
    uid,
    kind,
    x,
    y,
    w,
    d,
    rot: finite(raw.rot) ?? 0,
    label: typeof raw.label === "string" ? raw.label : "",
    locked: raw.locked === true,
  };
}

/** Read a stored `LayoutJson`. Blank is an empty layout of the given size. */
export function parseLayoutDoc(raw: unknown, fallbackExtent: { w: number; h: number }): LayoutDocRead {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, doc: emptyLayoutDoc(fallbackExtent), dropped: 0 };
  }
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "The saved layout isn't valid JSON." };
    }
  }
  if (!isObject(value)) return { ok: false, reason: "The saved layout isn't a layout." };
  if (value.schema !== PLANT_LAYOUT_SCHEMA) {
    return { ok: false, reason: `The saved layout is schema ${String(value.schema)}; this version of ARC reads schema ${PLANT_LAYOUT_SCHEMA}.` };
  }
  if (!Array.isArray(value.items)) return { ok: false, reason: "The saved layout has no items list." };
  const extent = isObject(value.extent) ? value.extent : {};
  const w = finite(extent.w);
  const h = finite(extent.h);
  const items: PlantLayoutItem[] = [];
  let dropped = 0;
  for (const rawItem of value.items) {
    const item = readItem(rawItem);
    if (item) items.push(item);
    else dropped += 1;
  }
  // `areas` was added later: missing is none, but a value that isn't a list is corrupt.
  if (value.areas !== undefined && !Array.isArray(value.areas)) {
    return { ok: false, reason: "The saved layout's areas aren't a list." };
  }
  const areas: PlantLayoutArea[] = [];
  for (const rawArea of (value.areas as unknown[] | undefined) ?? []) {
    const area = readArea(rawArea);
    if (area) areas.push(area);
    else dropped += 1;
  }
  return {
    ok: true,
    doc: {
      schema: 1,
      units: "in",
      extent: w !== null && h !== null && w > 0 && h > 0 ? { w, h } : fallbackExtent,
      items,
      areas,
    },
    dropped,
  };
}

/** A building's walls drawing (and its aisles and no-go areas), read off its layouts. */
export interface BuildingSource {
  fileId: string;
  extent: { w: number; h: number };
  areas: PlantLayoutArea[];
  /** The layout it was taken from — named on the New layout form. */
  layout: PlantLayout;
}

/**
 * The drawing a new layout in `building` should reuse: the building's
 * PUBLISHED layout if it has one (the current, agreed version), otherwise its
 * most recently changed. Matched case- and space-insensitively. Null for a
 * new building, or one whose layouts have no drawing. A layout ARC can't read
 * lends its drawing but no areas.
 */
export function buildingSource(layouts: readonly PlantLayout[], building: string): BuildingSource | null {
  const key = building.trim().toLowerCase();
  if (!key) return null;
  const mine = layouts.filter((l) => l.building.trim().toLowerCase() === key && l.wallsFileId);
  if (mine.length === 0) return null;
  const newest = (a: PlantLayout, b: PlantLayout) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0);
  const pick = [...mine].sort((a, b) => {
    const pa = a.status === "Published" ? 0 : 1;
    const pb = b.status === "Published" ? 0 : 1;
    return pa - pb || newest(a, b) || b.version - a.version;
  })[0];
  return {
    fileId: pick.wallsFileId,
    extent: { ...pick.doc.extent },
    areas: pick.docCorrupt ? [] : pick.doc.areas.map((a) => ({ ...a })),
    layout: pick,
  };
}

export function emptyLayoutDoc(extent: { w: number; h: number }): PlantLayoutDoc {
  return { schema: 1, units: "in", extent: { ...extent }, items: [], areas: [] };
}

/**
 * The value written to `LayoutJson`. Throws when it won't fit the column —
 * SharePoint would truncate it silently, which is a corrupt layout.
 */
export function serializeLayoutDoc(doc: PlantLayoutDoc): string {
  const out = JSON.stringify({
    schema: PLANT_LAYOUT_SCHEMA,
    units: "in",
    extent: doc.extent,
    items: doc.items,
    areas: doc.areas ?? [],
  });
  if (out.length > LAYOUT_JSON_MAX_CHARS) {
    throw new Error(
      `This layout is too big to save (${out.length.toLocaleString()} characters; the limit is ${LAYOUT_JSON_MAX_CHARS.toLocaleString()}). Split it into two layouts.`,
    );
  }
  return out;
}

/** A layout key from a title — groups the versions of one layout. */
export function layoutKeyFor(title: string, suffix: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "layout"}-${suffix}`;
}

/**
 * The layouts that use `fileId` as their walls drawing, `exceptId` left out.
 * One drawing is usually SHARED: every version of a layout keeps it (copy to
 * draft), and every layout in a building reuses it (New layout).
 */
export function layoutsSharingWalls(layouts: readonly PlantLayout[], fileId: string, exceptId: number): PlantLayout[] {
  if (!fileId) return [];
  return layouts.filter((l) => l.id !== exceptId && l.wallsFileId === fileId);
}
