import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_LAYOUT_COMPONENTS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { LayoutComponent, NewLayoutComponentInput } from "@/types/plant";
import { MAX_SYMBOL_MARKUP_CHARS } from "@/lib/plantSymbolImport";
import { toNumberOrNull } from "@/lib/graphValues";
import { parseCollisionPolygon } from "@/lib/plantGeometry";
import { MOCK_LAYOUT_COMPONENTS } from "@/data/plantMockData";

// =============================================================================
// Layout Components — the symbol library a plant layout is built from. On
// Altronic_PMO, seeded by scripts/create-plant-map-lists.ps1 from
// src/data/plantComponentSeed.json (only while the list is EMPTY).
//
// Symbols are ADDED from Plant Map → Symbols (an admin; the SVG is built by
// lib/plantSymbolImport.ts). Not edited or deleted yet: a component is RETIRED
// (IsActive = No), never deleted — layouts point at it by id. `SvgMarkup` is
// raw on READ — it is sanitised before anything draws it (lib/plantSvg.ts).
//
// `CollisionPolygon` (JSON `[[x, y], …]` in the symbol's inches) was added to
// the list after it was created. Selecting a column a list hasn't got 400s the
// WHOLE read, and the column is added by a script run separately from any
// deploy — so a 400 retries once without it and remembers (the MRB Watchers
// arrangement). Every symbol is then checked as its rectangle.
// =============================================================================

export const LAYOUT_COMPONENT_SELECT = [
  "Title",
  "ComponentKey",
  "Category",
  "SvgMarkup",
  "FootprintW",
  "FootprintD",
  "AllowResize",
  "AllowRotate",
  "MinScale",
  "MaxScale",
  "Collides",
  "Clearance",
  "Version",
  "IsActive",
].join(",");

const COLLISION_POLYGON_COLUMN = "CollisionPolygon";
let collisionPolygonMissing = false;

/** Tests only. */
export function __resetCollisionPolygonFallback(): void {
  collisionPolygonMissing = false;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

/** A Yes/No column; a missing value reads as the given default. */
function yesNo(v: unknown, fallback: boolean): boolean {
  if (v === null || v === undefined || v === "") return fallback;
  return v === true || v === "true" || v === "Yes" || v === 1;
}

export function toLayoutComponent(item: GraphListItem): LayoutComponent {
  const f = item.fields ?? {};
  const w = toNumberOrNull(f.FootprintW) ?? 0;
  const d = toNumberOrNull(f.FootprintD) ?? 0;
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    key: text(f.ComponentKey).trim(),
    category: text(f.Category).trim() || "Other",
    svgMarkup: text(f.SvgMarkup),
    footprintW: w,
    footprintD: d,
    allowResize: yesNo(f.AllowResize, false),
    allowRotate: yesNo(f.AllowRotate, true),
    minScale: toNumberOrNull(f.MinScale) ?? 1,
    maxScale: toNumberOrNull(f.MaxScale) ?? 1,
    // A component that doesn't say is treated as solid — the safe direction.
    collides: yesNo(f.Collides, true),
    clearance: toNumberOrNull(f.Clearance) ?? 0,
    // Unreadable = no shape: the symbol is checked as its rectangle.
    collisionPolygon: parseCollisionPolygon(f.CollisionPolygon),
    version: toNumberOrNull(f.Version) ?? 1,
    // A missing IsActive reads as ACTIVE, or adding the column would hide them all.
    active: yesNo(f.IsActive, true),
  };
}

let mockComponents: LayoutComponent[] = MOCK_LAYOUT_COMPONENTS.map((c) => ({ ...c }));

/** Tests only. */
export function __resetLayoutComponentsMockStore(): void {
  mockComponents = MOCK_LAYOUT_COMPONENTS.map((c) => ({ ...c }));
}

/** Every component, retired ones included — a layout may still use one. */
export async function listLayoutComponents(): Promise<LayoutComponent[]> {
  if (USE_MOCK) return mockDelay(mockComponents.map((c) => ({ ...c })));
  if (!SP_LAYOUT_COMPONENTS_LIST_ID) return [];
  const read = (withPolygon: boolean) =>
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.pmo}/lists/${SP_LAYOUT_COMPONENTS_LIST_ID}/items?$expand=fields($select=${LAYOUT_COMPONENT_SELECT}${
        withPolygon ? `,${COLLISION_POLYGON_COLUMN}` : ""
      })&$top=500`,
    );
  if (collisionPolygonMissing) return (await read(false)).map(toLayoutComponent);
  try {
    return (await read(true)).map(toLayoutComponent);
  } catch (err) {
    if (!(err instanceof GraphError && err.status === 400)) throw err;
    // Only conclude the column is missing once the read WITHOUT it works;
    // both failing is something else, and the original fault is reported.
    let items: GraphListItem[];
    try {
      items = await read(false);
    } catch {
      throw err;
    }
    collisionPolygonMissing = true;
    return items.map(toLayoutComponent);
  }
}

/**
 * Add a symbol. Its key must be new — checked against a FRESH read, since the
 * library may have changed since the form opened — and its SVG must fit the
 * column. Version 1, active.
 */
export async function createLayoutComponent(input: NewLayoutComponentInput): Promise<LayoutComponent> {
  const title = input.title.trim();
  if (!title) throw new Error("Give the symbol a name.");
  if (!(input.footprintW > 0 && input.footprintD > 0)) throw new Error("The footprint needs a width and a depth.");
  if (input.svgMarkup.length > MAX_SYMBOL_MARKUP_CHARS) {
    throw new Error("That symbol is too detailed to store. Simplify the drawing, or trace the picture smaller.");
  }
  const existing = await listLayoutComponents();
  if (existing.some((c) => c.key.toLowerCase() === input.key.toLowerCase())) {
    throw new Error(`A symbol with the key "${input.key}" was added meanwhile. Change the name and try again.`);
  }
  const row: Omit<LayoutComponent, "id"> = {
    title,
    key: input.key,
    category: input.category,
    svgMarkup: input.svgMarkup,
    footprintW: input.footprintW,
    footprintD: input.footprintD,
    allowResize: input.allowResize,
    allowRotate: input.allowRotate,
    minScale: input.allowResize ? input.minScale : 1,
    maxScale: input.allowResize ? input.maxScale : 1,
    collides: input.collides,
    clearance: Math.max(0, input.clearance),
    collisionPolygon: input.collisionPolygon ?? null,
    version: 1,
    active: true,
  };
  if (USE_MOCK) {
    const created = { ...row, id: Math.max(0, ...mockComponents.map((c) => c.id)) + 1 };
    mockComponents = [...mockComponents, created];
    return mockDelay({ ...created });
  }
  if (!SP_LAYOUT_COMPONENTS_LIST_ID) throw new Error("The Layout Components list isn't set up yet.");
  const item = await graphFetch<GraphListItem>(`/sites/${SITES.pmo}/lists/${SP_LAYOUT_COMPONENTS_LIST_ID}/items`, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Title: row.title,
        ComponentKey: row.key,
        Category: row.category,
        SvgMarkup: row.svgMarkup,
        FootprintW: row.footprintW,
        FootprintD: row.footprintD,
        AllowResize: row.allowResize,
        AllowRotate: row.allowRotate,
        MinScale: row.minScale,
        MaxScale: row.maxScale,
        Collides: row.collides,
        Clearance: row.clearance,
        Version: 1,
        IsActive: true,
        // Only written when there is one, so a list without the column can still take a plain symbol.
        ...(row.collisionPolygon ? { [COLLISION_POLYGON_COLUMN]: JSON.stringify(row.collisionPolygon) } : {}),
      },
    }),
  });
  return toLayoutComponent(item);
}
