import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PLANT_LAYOUTS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { uploadWallsFile } from "./plantLayoutFiles";
import type { GraphListItem } from "@/types/task";
import {
  PLANT_LAYOUT_STATUSES,
  type NewPlantLayoutInput,
  type PlantLayout,
  type PlantLayoutDoc,
  type PlantLayoutStatus,
} from "@/types/plant";
import { toNumberOrNull } from "@/lib/graphValues";
import { emptyLayoutDoc, layoutKeyFor, parseLayoutDoc, serializeLayoutDoc } from "@/lib/plantLayoutDoc";
import { MOCK_PLANT_LAYOUTS } from "@/data/plantMockData";

// =============================================================================
// Plant Layouts — one row per VERSION of a layout, on Altronic_PMO.
//
//   Title, Area, LayoutKey (groups the versions of one layout), Status
//   (Draft / Published / Superseded), Version, WallsFile (drive item id in
//   Plant Layout Files), LayoutJson (the whole layout — lib/plantLayoutDoc.ts),
//   SupersedesId.
//
// **A Published row is never written.** SharePoint can't freeze a row, so
// ARC holds the line: a save re-reads the row first and refuses anything that
// isn't a Draft. Changing a published layout will be "copy to a new draft"
// (Phase 3). A saved layout ARC can't parse is never written over either.
// =============================================================================

export const PLANT_LAYOUT_SELECT = "Title,Building,Area,LayoutKey,Status,Version,WallsFile,LayoutJson,SupersedesId";

let mockLayouts: PlantLayout[] = clone(MOCK_PLANT_LAYOUTS);

function clone(rows: PlantLayout[]): PlantLayout[] {
  return rows.map((l) => ({ ...l, doc: { ...l.doc, extent: { ...l.doc.extent }, items: l.doc.items.map((i) => ({ ...i })) } }));
}

/** For tests: put the mock store back. */
export function __resetPlantLayoutsMockStore(): void {
  mockLayouts = clone(MOCK_PLANT_LAYOUTS);
}

function itemsPath(): string {
  if (!SP_PLANT_LAYOUTS_LIST_ID) throw new Error("Plant Layouts isn't set up yet: VITE_SP_PLANT_LAYOUTS_LIST_ID is not set.");
  return `/sites/${SITES.pmo}/lists/${SP_PLANT_LAYOUTS_LIST_ID}/items`;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function toStatus(v: unknown): PlantLayoutStatus {
  const s = text(v).trim();
  return (PLANT_LAYOUT_STATUSES as readonly string[]).includes(s) ? (s as PlantLayoutStatus) : "Draft";
}

export function toPlantLayout(item: GraphListItem): PlantLayout {
  const f = item.fields ?? {};
  const read = parseLayoutDoc(f.LayoutJson, { w: 0, h: 0 });
  const supersedes = toNumberOrNull(f.SupersedesId);
  const title = text(f.Title).trim();
  return {
    id: parseInt(item.id, 10),
    building: text(f.Building).trim() || title,
    title,
    area: text(f.Area).trim(),
    layoutKey: text(f.LayoutKey).trim(),
    status: toStatus(f.Status),
    version: toNumberOrNull(f.Version) ?? 1,
    wallsFileId: text(f.WallsFile).trim(),
    doc: read.ok ? read.doc : emptyLayoutDoc({ w: 0, h: 0 }),
    docCorrupt: !read.ok,
    supersedesId: supersedes && supersedes > 0 ? supersedes : null,
    modifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
    modifiedBy: item.lastModifiedBy?.user?.displayName ?? "",
  };
}

/** Every layout version. A few dozen rows, so fetched whole. */
export async function listPlantLayouts(): Promise<PlantLayout[]> {
  if (USE_MOCK) return mockDelay(clone(mockLayouts));
  if (!SP_PLANT_LAYOUTS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath()}?$select=id,lastModifiedDateTime,lastModifiedBy&$expand=fields($select=${PLANT_LAYOUT_SELECT})&$top=200`,
  );
  return items.map(toPlantLayout);
}

/** One layout version, fresh. Null only when it doesn't exist; anything else throws. */
export async function getPlantLayout(id: number): Promise<PlantLayout | null> {
  if (USE_MOCK) {
    const row = mockLayouts.find((l) => l.id === id);
    return mockDelay(row ? clone([row])[0] : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(
      `${itemsPath()}/${id}?$select=id,lastModifiedDateTime,lastModifiedBy&$expand=fields($select=${PLANT_LAYOUT_SELECT})`,
    );
    return toPlantLayout(item);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Start a layout: save the walls drawing to the library, then create a Draft
 * (version 1, no items) pointing at it. The file goes FIRST because the row
 * needs its id; if the row is then refused, the file is left in `walls/` and
 * the error says so.
 */
export async function createPlantLayout(input: NewPlantLayoutInput): Promise<PlantLayout> {
  const title = input.title.trim();
  const building = input.building.trim();
  if (!building) throw new Error("Pick the building, or type a new one.");
  if (!title) throw new Error("Give the layout a name.");
  const doc = { ...emptyLayoutDoc(input.extent), areas: (input.areas ?? []).map((a) => ({ ...a })) };
  const layoutKey = layoutKeyFor(title, Date.now().toString(36));
  // A building that already has a drawing keeps using it: no second copy in the library.
  const walls = input.walls;
  const file = walls.kind === "upload" ? await uploadWallsFile(walls.fileName, walls.svg) : { id: walls.fileId, name: "" };

  if (USE_MOCK) {
    const row: PlantLayout = {
      id: Math.max(0, ...mockLayouts.map((l) => l.id)) + 1,
      building,
      title,
      area: input.area.trim(),
      layoutKey,
      status: "Draft",
      version: 1,
      wallsFileId: file.id,
      doc,
      docCorrupt: false,
      supersedesId: null,
      modifiedAt: new Date(),
      modifiedBy: "Demo User",
    };
    mockLayouts = [...mockLayouts, row];
    return mockDelay(clone([row])[0]);
  }

  try {
    const created = await graphFetch<GraphListItem>(itemsPath(), {
      method: "POST",
      body: JSON.stringify({
        fields: {
          Title: title,
          Building: building,
          Area: input.area.trim(),
          LayoutKey: layoutKey,
          Status: "Draft",
          Version: 1,
          WallsFile: file.id,
          LayoutJson: serializeLayoutDoc(doc),
        },
      }),
    });
    return toPlantLayout(created);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (walls.kind === "existing") throw new Error(`The layout couldn't be created: ${why}`);
    throw new Error(`The walls drawing was saved as "${file.name}", but the layout couldn't be created: ${why}`);
  }
}

/** Thrown when a save reaches a layout that is no longer a Draft. */
export class LayoutNotDraftError extends Error {
  constructor(status: PlantLayoutStatus) {
    super(`This layout is ${status}, so it can't be changed. Copy it to a new draft instead.`);
    this.name = "LayoutNotDraftError";
  }
}

/**
 * Save a Draft's items. Re-reads the row first and refuses one that has been
 * published since, or whose saved layout ARC can't read.
 */
export async function savePlantLayoutDraft(id: number, doc: PlantLayoutDoc): Promise<PlantLayout> {
  const current = await getPlantLayout(id);
  if (!current) throw new Error("That layout has been deleted.");
  if (current.status !== "Draft") throw new LayoutNotDraftError(current.status);
  if (current.docCorrupt) {
    throw new Error("The saved layout couldn't be read, so ARC won't write over it. Fix LayoutJson in SharePoint first.");
  }
  const value = serializeLayoutDoc(doc);
  if (USE_MOCK) {
    mockLayouts = mockLayouts.map((l) =>
      l.id === id ? { ...l, doc: JSON.parse(value) as PlantLayoutDoc, modifiedAt: new Date() } : l,
    );
    return mockDelay(clone(mockLayouts.filter((l) => l.id === id))[0]);
  }
  await graphFetch(`${itemsPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify({ LayoutJson: value }) });
  const after = await getPlantLayout(id);
  if (!after) throw new Error("That layout has been deleted.");
  return after;
}

/**
 * Changing a published layout: a NEW Draft row, one version up, with the same
 * walls and items, pointing back at the version it copies. One layout has at
 * most one draft — if there already is one, that's what comes back
 * (`existing`), so two people pressing the button edit the same draft.
 */
export async function copyLayoutToDraft(id: number): Promise<{ layout: PlantLayout; existing: boolean }> {
  const source = await getPlantLayout(id);
  if (!source) throw new Error("That layout has been deleted.");
  if (source.docCorrupt) throw new Error("The saved layout couldn't be read, so it can't be copied.");
  if (source.status === "Draft") return { layout: source, existing: true };
  const siblings = source.layoutKey ? (await listPlantLayouts()).filter((l) => l.layoutKey === source.layoutKey) : [];
  const draft = siblings.find((l) => l.status === "Draft");
  if (draft) return { layout: draft, existing: true };
  const version = Math.max(source.version, ...siblings.map((l) => l.version)) + 1;
  const layoutKey = source.layoutKey || layoutKeyFor(source.title, Date.now().toString(36));

  if (USE_MOCK) {
    const row: PlantLayout = {
      ...clone([source])[0],
      id: Math.max(0, ...mockLayouts.map((l) => l.id)) + 1,
      layoutKey,
      status: "Draft",
      version,
      supersedesId: source.id,
      modifiedAt: new Date(),
      modifiedBy: "Demo User",
    };
    mockLayouts = [...mockLayouts, row];
    return mockDelay({ layout: clone([row])[0], existing: false });
  }

  const created = await graphFetch<GraphListItem>(itemsPath(), {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Title: source.title,
        Building: source.building,
        Area: source.area,
        LayoutKey: layoutKey,
        Status: "Draft",
        Version: version,
        WallsFile: source.wallsFileId,
        LayoutJson: serializeLayoutDoc(source.doc),
        SupersedesId: source.id,
      },
    }),
  });
  return { layout: toPlantLayout(created), existing: false };
}
