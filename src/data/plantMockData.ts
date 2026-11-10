import seed from "@/data/plantComponentSeed.json";
import mainPlantWalls from "@/data/plantMock/walls-main-plant.svg?raw";
import panelPlantWalls from "@/data/plantMock/walls-panel-plant.svg?raw";
import engSalesWalls from "@/data/plantMock/walls-eng-sales.svg?raw";
import cleanSample from "@/data/plantMock/sample-layout-main-plant.json";
import collisionSample from "@/data/plantMock/sample-layout-main-plant-collisions.json";
import type {
  LayoutComponent,
  PlantLayout,
  PlantLayoutArea,
  PlantLayoutDoc,
  PlantLayoutItem,
  PlantMapRoleEntry,
} from "@/types/plant";

// =============================================================================
// Plant Map demo data. Every building, symbol and layout here is INVENTED —
// three made-up test plans and twelve generic symbols, built for testing the
// layout builder. None is an Altronic building, so they are safe in this
// public repo (rule 8).
//
// The symbols are `plantComponentSeed.json`, which the list script also seeds
// into SharePoint, so the demo and a fresh live list offer the same library.
// =============================================================================

interface SeedRow {
  key: string;
  Title: string;
  Category: string;
  FootprintW: number;
  FootprintD: number;
  AllowResize: boolean;
  AllowRotate: boolean;
  MinScale: number;
  MaxScale: number;
  Collides: boolean;
  Clearance: number;
  Version: number;
  IsActive: boolean;
  SvgMarkup: string;
  /** Only the L-desk has one — the demo's shaped symbol. */
  CollisionPolygon?: [number, number][];
}

/** The seed rows as components, ids 1…12 in seed order. */
export const MOCK_LAYOUT_COMPONENTS: LayoutComponent[] = (seed as SeedRow[]).map((row, i) => ({
  id: i + 1,
  key: row.key,
  title: row.Title,
  category: row.Category,
  svgMarkup: row.SvgMarkup,
  footprintW: row.FootprintW,
  footprintD: row.FootprintD,
  allowResize: row.AllowResize,
  allowRotate: row.AllowRotate,
  minScale: row.MinScale,
  maxScale: row.MaxScale,
  collides: row.Collides,
  clearance: row.Clearance,
  collisionPolygon: row.CollisionPolygon ?? null,
  version: row.Version,
  active: row.IsActive,
}));

const ID_BY_KEY = new Map(MOCK_LAYOUT_COMPONENTS.map((c) => [c.key, c.id]));

interface SampleItem {
  uid: string;
  componentKey: string;
  componentVersion: number;
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
  label: string;
  locked: boolean;
}

/** A sample layout's items, with its component KEYS turned into ids. */
function sampleItems(sample: { items: SampleItem[] }): PlantLayoutItem[] {
  return sample.items.map((it) => ({
    uid: it.uid,
    componentId: ID_BY_KEY.get(it.componentKey) ?? 0,
    componentVersion: it.componentVersion,
    x: it.x,
    y: it.y,
    w: it.w,
    d: it.d,
    rot: it.rot,
    label: it.label,
    equipmentId: null,
    locked: it.locked,
  }));
}

/** The clean sample layout's items — no problems. */
export const SAMPLE_CLEAN_ITEMS = sampleItems(cleanSample as { items: SampleItem[] });
/** The same plus three bad items (an overlap, one in an aisle, one through a wall). */
export const SAMPLE_COLLISION_ITEMS = sampleItems(collisionSample as { items: SampleItem[] });

/** Mock walls files, by drive item id. */
export const MOCK_WALLS_FILES: Record<string, { name: string; svg: string }> = {
  "mock-walls-main": { name: "walls-main-plant.svg", svg: mainPlantWalls },
  "mock-walls-panel": { name: "walls-panel-plant.svg", svg: panelPlantWalls },
  "mock-walls-eng": { name: "walls-eng-sales.svg", svg: engSalesWalls },
};

function doc(w: number, h: number, items: PlantLayoutItem[], areas: PlantLayoutArea[] = []): PlantLayoutDoc {
  return { schema: 1, units: "in", extent: { w, h }, items, areas };
}

/**
 * The Engineering & Sales draft: desks in the open office, a lab, two offices
 * and the lobby, with a walkway drawn through the open office. Placed clear of
 * every wall, column and keep-out — the demo of a clean office layout.
 */
function engSalesItems(): PlantLayoutItem[] {
  const place = (uid: string, key: string, x: number, y: number, rot: number, label: string): PlantLayoutItem => {
    const c = MOCK_LAYOUT_COMPONENTS.find((m) => m.key === key)!;
    return {
      uid,
      componentId: c.id,
      componentVersion: c.version,
      x,
      y,
      w: c.footprintW,
      d: c.footprintD,
      rot,
      label,
      equipmentId: null,
      locked: false,
    };
  };
  return [
    place("e_0001", "desk-60x30", 120, 450, 0, "Eng desk 1"),
    place("e_0002", "desk-60x30", 200, 450, 0, "Eng desk 2"),
    place("e_0003", "desk-60x30", 380, 450, 0, "Eng desk 3"),
    place("e_0004", "desk-60x30", 460, 450, 0, "Eng desk 4"),
    place("e_0005", "desk-60x30", 120, 540, 180, "Eng desk 5"),
    place("e_0006", "desk-60x30", 200, 540, 180, "Eng desk 6"),
    place("e_0007", "desk-60x30", 380, 540, 180, "Eng desk 7"),
    place("e_0008", "desk-60x30", 460, 540, 180, "Eng desk 8"),
    place("e_0009", "conference-table-144x48", 650, 800, 0, "Huddle table"),
    place("e_0010", "workbench-72x30", 150, 880, 0, "Prototype bench"),
    place("e_0011", "test-station-72x36", 1000, 450, 0, "Lab test 1"),
    place("e_0012", "test-station-72x36", 1100, 450, 0, "Lab test 2"),
    place("e_0013", "workbench-72x30", 1050, 600, 0, "Lab bench"),
    place("e_0014", "storage-cabinet-48x24", 940, 900, 0, "Lab cabinet"),
    place("e_0015", "desk-l-72x72", 72, 130, 0, "Office 201 desk"),
    place("e_0016", "desk-60x30", 216, 100, 0, "Office 202 desk"),
    place("e_0017", "desk-60x30", 1260, 660, 0, "Reception"),
  ];
}

export const SAMPLE_ENG_SALES_ITEMS = engSalesItems();

/**
 * An area from a drawing-style rectangle (top-left corner, width, depth) —
 * an area itself is stored by its centre. The demo drawings used to carry
 * their aisles, docks and panel clearances as keep-outs; they were moved
 * onto the layouts (Tim, 2026-11-06) so they can be edited, at exactly the
 * same place and size. Only the door swings stay in the drawings, beside the
 * doors they belong to.
 */
function rectArea(uid: string, kind: PlantLayoutArea["kind"], x: number, y: number, w: number, d: number, label: string): PlantLayoutArea {
  return { uid, kind, x: x + w / 2, y: y + d / 2, w, d, rot: 0, label, locked: false };
}

/** The Main Plant's aisles, docks and clearances — on both of its layouts. */
export const MAIN_PLANT_AREAS: PlantLayoutArea[] = [
  rectArea("a_m01", "aisle", 370, 860, 2320, 120, "Main aisle"),
  rectArea("a_m02", "aisle", 1500, 92, 120, 768, "N-S aisle north"),
  rectArea("a_m03", "aisle", 1500, 980, 120, 608, "N-S aisle south"),
  rectArea("a_m04", "aisle", 730, 1250, 770, 72, "Office aisle"),
  rectArea("a_m05", "aisle", 10, 1340, 710, 100, "Exit corridor"),
  rectArea("a_m06", "no-go", 2000, 10, 144, 240, "Drive-in clear"),
  rectArea("a_m07", "no-go", 2690, 270, 180, 180, "Dock 1"),
  rectArea("a_m08", "no-go", 2690, 510, 180, 180, "Dock 2"),
  rectArea("a_m09", "no-go", 2690, 750, 180, 180, "Dock 3"),
  rectArea("a_m10", "no-go", 1180, 10, 140, 82, "MCC clearance"),
  rectArea("a_m11", "no-go", 1680, 1588, 120, 82, "Panel LP-2 clearance"),
];

/** The Panel Plant's. */
export const PANEL_PLANT_AREAS: PlantLayoutArea[] = [
  rectArea("a_p01", "aisle", 10, 540, 1310, 120, "Main aisle"),
  rectArea("a_p02", "aisle", 1320, 760, 420, 240, "Forklift lane"),
  rectArea("a_p03", "no-go", 1730, 670, 180, 180, "Dock 1"),
  rectArea("a_p04", "no-go", 1730, 920, 180, 180, "Dock 2"),
  rectArea("a_p05", "no-go", 1700, 10, 140, 82, "Test power clearance"),
];

/** Engineering & Sales: a walkway through the open office, plus the building's own. */
export const SAMPLE_ENG_SALES_AREAS: PlantLayoutArea[] = [
  { uid: "a_0101", kind: "aisle", x: 450, y: 615, w: 860, d: 50, rot: 0, label: "Main walkway", locked: false },
  rectArea("a_e01", "aisle", 8, 240, 1424, 120, "Corridor"),
  rectArea("a_e02", "aisle", 1312, 762, 112, 108, "Entry"),
  rectArea("a_e03", "no-go", 1060, 870, 100, 82, "Electrical panel clearance"),
];

/** Drawn on the Main Plant draft, clear of every item — the demo of a no-go area. */
export const SAMPLE_AREAS: PlantLayoutArea[] = [
  ...MAIN_PLANT_AREAS,
  { uid: "a_0001", kind: "no-go", x: 2160, y: 1440, w: 240, d: 144, rot: 0, label: "Forklift charging", locked: false },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

export const MOCK_PLANT_LAYOUTS: PlantLayout[] = [
  {
    id: 1,
    building: "Main Plant",
    title: "Main Plant",
    area: "Production floor",
    layoutKey: "main-plant",
    status: "Published",
    version: 1,
    wallsFileId: "mock-walls-main",
    doc: doc(2880, 1680, SAMPLE_CLEAN_ITEMS, MAIN_PLANT_AREAS),
    docCorrupt: false,
    supersedesId: null,
    modifiedAt: daysAgo(12),
    modifiedBy: "Morgan Example",
  },
  {
    id: 2,
    building: "Main Plant",
    title: "Main Plant",
    area: "Production floor",
    layoutKey: "main-plant",
    status: "Draft",
    version: 2,
    wallsFileId: "mock-walls-main",
    doc: doc(2880, 1680, SAMPLE_COLLISION_ITEMS, SAMPLE_AREAS),
    docCorrupt: false,
    supersedesId: 1,
    modifiedAt: daysAgo(1),
    modifiedBy: "Demo User",
  },
  {
    id: 3,
    building: "Panel Plant",
    title: "Panel Plant",
    area: "Panel shop",
    layoutKey: "panel-plant",
    status: "Draft",
    version: 1,
    wallsFileId: "mock-walls-panel",
    doc: doc(1920, 1200, [], PANEL_PLANT_AREAS),
    docCorrupt: false,
    supersedesId: null,
    modifiedAt: daysAgo(3),
    modifiedBy: "Riley Sample",
  },
  {
    id: 4,
    building: "Engineering & Sales",
    title: "Engineering & Sales",
    area: "Offices, lab and lobby",
    layoutKey: "eng-sales",
    status: "Draft",
    version: 1,
    wallsFileId: "mock-walls-eng",
    doc: doc(1440, 960, SAMPLE_ENG_SALES_ITEMS, SAMPLE_ENG_SALES_AREAS),
    docCorrupt: false,
    supersedesId: null,
    modifiedAt: daysAgo(2),
    modifiedBy: "Morgan Example",
  },
];

export const MOCK_PLANT_MAP_ROLES: PlantMapRoleEntry[] = [
  { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["editor", "admin"], note: "" },
  { id: 2, email: "morgan.example@example.com", displayName: "Morgan Example", roles: ["editor"], note: "Facilities" },
  { id: 3, email: "riley.sample@example.com", displayName: "Riley Sample", roles: ["editor"], note: "" },
  { id: 4, email: "sam.viewer@example.com", displayName: "Sam Viewer", roles: ["viewer"], note: "Looks, doesn't edit" },
];
