// =============================================================================
// Plant Map (Operations) — plant layouts drawn to scale over a building's wall
// drawing, the equipment symbols placed on them, and who may edit them.
//
// Everything is in INCHES, origin top-left, north up. A placed item's x / y is
// its CENTRE and `rot` is degrees clockwise. Items store their real size
// (w / d) rather than a scale factor, so the drawing stays true to scale.
// =============================================================================

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

/** Lowercase, stored as a CSV in the Plant Map Roles list's `Roles` column. */
/** Being on the list at all is what opens the Plant Map — `viewer` for somebody who only looks. */
export const PLANT_MAP_ROLES = ["viewer", "editor", "admin"] as const;
export type PlantMapRole = (typeof PLANT_MAP_ROLES)[number];

export const PLANT_MAP_ROLE_LABELS: Record<PlantMapRole, string> = {
  viewer: "Viewer",
  editor: "Editor",
  admin: "Plant Map admin",
};

export interface PlantMapRoleEntry {
  id: number;
  /** Title — lower-cased email. */
  email: string;
  displayName: string;
  roles: PlantMapRole[];
  note: string;
}

export interface PlantMapRoleInput {
  email: string;
  displayName: string;
  roles: PlantMapRole[];
  note: string;
}

// -----------------------------------------------------------------------------
// Layout components — the symbol library
// -----------------------------------------------------------------------------

/**
 * Must equal the Category column's choices on Layout Components (strict —
 * a value it doesn't declare is refused); scripts/create-plant-map-lists.ps1
 * carries the same list and adds any that are missing. Safety, Utility and
 * Zone came with the Main Plant CAD extract (2026-11-10); Safety
 * (extinguishers, exits, medical, severe-weather) is the group the safety
 * layer will draw.
 */
export const LAYOUT_COMPONENT_CATEGORIES = [
  "Desk",
  "Machine",
  "Bench",
  "Rack",
  "Storage",
  "Safety",
  "Utility",
  "Zone",
  "Other",
] as const;
export type LayoutComponentCategory = (typeof LAYOUT_COMPONENT_CATEGORIES)[number];

export interface LayoutComponent {
  id: number;
  title: string;
  /** Stable text key ("cnc-vmc-120x96"), kept from the seed. */
  key: string;
  /** Not clamped on read — a category added in SharePoint shows as itself. */
  category: string;
  /** The symbol, `viewBox="0 0 FootprintW FootprintD"`. Raw — sanitise before rendering. */
  svgMarkup: string;
  footprintW: number;
  footprintD: number;
  allowResize: boolean;
  allowRotate: boolean;
  minScale: number;
  maxScale: number;
  /** False for floor markings and zones — they never collide. */
  collides: boolean;
  /** Keep-out margin in inches (not applied yet). */
  clearance: number;
  /**
   * The symbol's real shape when it isn't a rectangle (an L-bench, a stepped
   * line): `[x, y]` points in the symbol's own inches, the frame of its
   * viewBox. The placement check uses it instead of the footprint rectangle.
   * Null = the rectangle.
   */
  collisionPolygon: (readonly [number, number])[] | null;
  version: number;
  active: boolean;
}

// -----------------------------------------------------------------------------
// Layouts
// -----------------------------------------------------------------------------

export const PLANT_LAYOUT_STATUSES = ["Draft", "Published", "Superseded"] as const;
export type PlantLayoutStatus = (typeof PLANT_LAYOUT_STATUSES)[number];

export interface PlantLayoutItem {
  /** Unique within the layout ("i_7f3a"); the published file uses it as the element id. */
  uid: string;
  componentId: number;
  componentVersion: number;
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
  label: string;
  /** Altronic Equipment List item id, when the item is a real asset. */
  equipmentId: number | null;
  locked: boolean;
  /**
   * The layer it's drawn on ("safety"), shown and hidden as one. Absent = the
   * base plan, which is always shown. See lib/plantLayers.ts.
   */
  layer?: string | null;
  /** A group within its layer ("extinguishers"), toggled on its own. Ignored without a layer. */
  group?: string | null;
}

/** A group within a layer — shown and hidden on its own. */
export interface PlantLayerGroup {
  /** Stored on the item ("fire-exits"). */
  key: string;
  title: string;
}

/**
 * A layer declared on a layout: items carrying its key are drawn only while
 * it's shown. Showing and hiding is per viewer and never saved; what's saved
 * is whether it starts hidden.
 */
export interface PlantLayer {
  key: string;
  title: string;
  hiddenByDefault: boolean;
  groups: PlantLayerGroup[];
}

/**
 * Areas drawn ON the layout — aisles and no-go areas the people planning it
 * add, on top of whatever keep-outs the walls drawing carries (which ARC never
 * edits). A colliding item may not sit in one; a floor zone may.
 */
export const PLANT_AREA_KINDS = ["aisle", "no-go"] as const;
export type PlantAreaKind = (typeof PLANT_AREA_KINDS)[number];
export const PLANT_AREA_KIND_LABELS: Record<PlantAreaKind, string> = {
  aisle: "Aisle",
  "no-go": "No-go area",
};

export interface PlantLayoutArea {
  /** Unique within the layout ("a_7f3a01") — never the same as an item's. */
  uid: string;
  kind: PlantAreaKind;
  /** Centre, size and rotation in inches / degrees, like an item. */
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
  label: string;
  locked: boolean;
}

/** What the `LayoutJson` column holds. */
export interface PlantLayoutDoc {
  schema: 1;
  units: "in";
  /** The building's size in inches — the walls file's viewBox. */
  extent: { w: number; h: number };
  items: PlantLayoutItem[];
  /** Added after the first layouts were saved; a layout without it has none. */
  areas: PlantLayoutArea[];
  /**
   * The layers it declares (2026-11-10). Optional: a layout without any has
   * only the base plan, and a layer an item names but the list doesn't
   * declare is still shown (lib/plantLayers.ts).
   */
  layers?: PlantLayer[];
}

export interface PlantLayout {
  id: number;
  /**
   * The building it's in ("Main Plant") — the Layouts list's tabs. Buildings
   * aren't a list of their own: the first layout in a new building names it.
   * A row saved without one reads its title.
   */
  building: string;
  title: string;
  area: string;
  /** Groups the versions of one layout. */
  layoutKey: string;
  status: PlantLayoutStatus;
  version: number;
  /** Drive item id of the walls SVG in the Plant Layout Files library. */
  wallsFileId: string;
  doc: PlantLayoutDoc;
  /** `LayoutJson` couldn't be read. Shown as an error and never written over. */
  docCorrupt: boolean;
  supersedesId: number | null;
  modifiedAt: Date | null;
  modifiedBy: string;
}

/** A new symbol for the library — its SVG already built (lib/plantSymbolImport.ts). */
export interface NewLayoutComponentInput {
  title: string;
  key: string;
  category: LayoutComponentCategory;
  svgMarkup: string;
  footprintW: number;
  footprintD: number;
  allowResize: boolean;
  allowRotate: boolean;
  minScale: number;
  maxScale: number;
  collides: boolean;
  clearance: number;
  /** Optional real shape; the Add symbol form doesn't set one (a CAD load does). */
  collisionPolygon?: (readonly [number, number])[] | null;
}

/** Where a new layout's walls drawing comes from. */
export type NewLayoutWalls =
  /** A drawing picked now, already read and checked (see lib/plantSvg.ts) — uploaded on create. */
  | { kind: "upload"; svg: string; fileName: string }
  /** The drawing the building's layouts already use — nothing is uploaded. */
  | { kind: "existing"; fileId: string };

export interface NewPlantLayoutInput {
  /** An existing building, or a new one — typed. */
  building: string;
  title: string;
  area: string;
  walls: NewLayoutWalls;
  extent: { w: number; h: number };
  /** Aisles and no-go areas to start with — copied from the building's layout. */
  areas?: PlantLayoutArea[];
}
