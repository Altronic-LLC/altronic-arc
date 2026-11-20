import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_BOM_KITS_LIST_ID, SP_PANEL_BOM_PARTS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { MOCK_PANEL_BOM_KITS, MOCK_PANEL_BOM_PARTS } from "@/data/panelBomMockData";
import type { GraphListItem } from "@/types/task";
import type { PanelBomKit, PanelBomPart } from "@/types/panelBom";
import {
  categoryOrDefault,
  isCluster,
  parseKitComponents,
  serializeKitComponents,
  type PanelBomKitInput,
  type PanelBomPartInput,
} from "@/lib/panelBom";
import { toNumberOrNull } from "@/lib/graphValues";

// =============================================================================
// Panel SAP BOM Builder (BusinessIT#59) — the parts and kits lists, on
// ALTRONICPANELTEAM. Loaded once from Mark Balent's PANEL Parts Database
// workbook (scripts/load-panel-bom-lists.ps1); ARC is the master from then on.
//
// Both lists are read WHOLE (~800 parts, ~30 kits) — far under the 5,000-item
// threshold, and the builder searches every column in the browser anyway.
//
// NO COST COLUMN on either list, on purpose: cost comes from SAP through
// Fabric, per viewer (api/panelBomCosts.ts). A cost column here would be
// readable by everyone who can read the list.
//
// NO DELETE on either: a part or kit that stops being used is retired
// (Active = false). It leaves the picker, and a saved BOM that uses it keeps
// it. A saved BOM stores SAP #s and kit names, not row ids, so removing a row
// in SharePoint is survivable — the BOM then lists it as "not on the parts
// list" — but ARC doesn't offer it.
// =============================================================================

const PART_SELECT =
  "Title,AltronicPartNumber,Description,Cluster,Category,Standard,Preferred,DoNotQuote,Datasheet,QtyIfUsed,Active";
const KIT_SELECT = "Title,Description,Category,Standard,Preferred,Active,Components";

/** Whether both lists are set up. Demo mode always is. */
export const PANEL_BOM_PARTS_CONFIGURED = USE_MOCK || (!!SP_PANEL_BOM_PARTS_LIST_ID && !!SP_PANEL_BOM_KITS_LIST_ID);

let partStore: PanelBomPart[] = MOCK_PANEL_BOM_PARTS.map((p) => ({ ...p }));
let kitStore: PanelBomKit[] = MOCK_PANEL_BOM_KITS.map((k) => ({ ...k, components: k.components.map((c) => ({ ...c })) }));

/** Demo-mode-only: reset both stores (tests). */
export function resetPanelBomPartsMockStore(): void {
  partStore = MOCK_PANEL_BOM_PARTS.map((p) => ({ ...p }));
  kitStore = MOCK_PANEL_BOM_KITS.map((k) => ({ ...k, components: k.components.map((c) => ({ ...c })) }));
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

function partsPath(): string {
  return `/sites/${SITES.panelTeam}/lists/${SP_PANEL_BOM_PARTS_LIST_ID}/items`;
}
function kitsPath(): string {
  return `/sites/${SITES.panelTeam}/lists/${SP_PANEL_BOM_KITS_LIST_ID}/items`;
}

export function toPanelBomPart(item: GraphListItem): PanelBomPart {
  const f = item.fields as Record<string, unknown>;
  const cluster = toNumberOrNull(f.Cluster);
  return {
    id: parseInt(item.id, 10),
    sapPartNumber: text(f.Title),
    altronicPartNumber: text(f.AltronicPartNumber),
    description: text(f.Description),
    // A cluster outside the ten is shown under 0 rather than dropped; the
    // edit form refuses to save one, so only a hand edit in SharePoint can
    // produce it.
    cluster: isCluster(cluster) ? cluster : 0,
    category: categoryOrDefault(text(f.Category)),
    standard: f.Standard === true,
    preferred: f.Preferred === true,
    doNotQuote: f.DoNotQuote === true,
    datasheet: text(f.Datasheet),
    qtyIfUsed: toNumberOrNull(f.QtyIfUsed),
    // A blank Active reads as active: a row added in SharePoint without
    // touching the box is meant to be used.
    active: f.Active !== false,
  };
}

export function toPanelBomKit(item: GraphListItem): PanelBomKit {
  const f = item.fields as Record<string, unknown>;
  const { components, corrupt } = parseKitComponents(f.Components);
  return {
    id: parseInt(item.id, 10),
    name: text(f.Title),
    description: text(f.Description),
    category: categoryOrDefault(text(f.Category)),
    standard: f.Standard === true,
    preferred: f.Preferred === true,
    active: f.Active !== false,
    components,
    componentsCorrupt: corrupt,
  };
}

export async function listPanelBomParts(): Promise<PanelBomPart[]> {
  if (USE_MOCK) return mockDelay(partStore.map((p) => ({ ...p })));
  if (!SP_PANEL_BOM_PARTS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(`${partsPath()}?$expand=fields($select=${PART_SELECT})&$top=999`);
  return items.map(toPanelBomPart);
}

export async function listPanelBomKits(): Promise<PanelBomKit[]> {
  if (USE_MOCK) return mockDelay(kitStore.map((k) => ({ ...k, components: k.components.map((c) => ({ ...c })) })));
  if (!SP_PANEL_BOM_KITS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(`${kitsPath()}?$expand=fields($select=${KIT_SELECT})&$top=999`);
  return items.map(toPanelBomKit);
}

function requireConfigured(listId: string | undefined, list: string, action: string): void {
  if (!listId) {
    throw new Error(
      `The ${list} list isn't set up yet, so ARC can't ${action}. ` +
        "Run scripts/create-panel-bom-lists.ps1 and set its list ids.",
    );
  }
}

/** The columns a part write sends — every one, so a blank clears. */
export function panelBomPartFields(input: PanelBomPartInput): Record<string, unknown> {
  return {
    Title: input.sapPartNumber.trim(),
    AltronicPartNumber: input.altronicPartNumber.trim(),
    Description: input.description.trim(),
    Cluster: input.cluster,
    Category: categoryOrDefault(input.category),
    Standard: input.standard,
    Preferred: input.preferred,
    DoNotQuote: input.doNotQuote,
    Datasheet: input.datasheet.trim(),
    QtyIfUsed: input.qtyIfUsed,
    Active: input.active,
  };
}

/** The columns a kit write sends. Components go as one JSON value. */
export function panelBomKitFields(input: PanelBomKitInput): Record<string, unknown> {
  return {
    Title: input.name.trim(),
    Description: input.description.trim(),
    Category: categoryOrDefault(input.category),
    Standard: input.standard,
    Preferred: input.preferred,
    Active: input.active,
    Components: serializeKitComponents(input.components),
  };
}

function mockPart(input: PanelBomPartInput, id: number): PanelBomPart {
  const f = panelBomPartFields(input);
  return {
    id,
    sapPartNumber: f.Title as string,
    altronicPartNumber: f.AltronicPartNumber as string,
    description: f.Description as string,
    cluster: input.cluster,
    category: f.Category as string,
    standard: input.standard,
    preferred: input.preferred,
    doNotQuote: input.doNotQuote,
    datasheet: f.Datasheet as string,
    qtyIfUsed: input.qtyIfUsed,
    active: input.active,
  };
}

function mockKit(input: PanelBomKitInput, id: number): PanelBomKit {
  return toPanelBomKit({ id: String(id), createdDateTime: "", lastModifiedDateTime: "", fields: panelBomKitFields(input) } as GraphListItem);
}

export async function createPanelBomPart(input: PanelBomPartInput): Promise<PanelBomPart> {
  if (USE_MOCK) {
    const row = mockPart(input, Math.max(0, ...partStore.map((p) => p.id)) + 1);
    partStore = [...partStore, row];
    return mockDelay({ ...row });
  }
  requireConfigured(SP_PANEL_BOM_PARTS_LIST_ID, "Panel BOM Parts", "add a part");
  const created = await graphFetch<GraphListItem>(partsPath(), {
    method: "POST",
    body: JSON.stringify({ fields: panelBomPartFields(input) }),
  });
  return toPanelBomPart(created);
}

export async function updatePanelBomPart(id: number, input: PanelBomPartInput): Promise<PanelBomPart> {
  if (USE_MOCK) {
    const i = partStore.findIndex((p) => p.id === id);
    if (i < 0) throw new Error(`Part ${id} not found.`);
    partStore[i] = mockPart(input, id);
    return mockDelay({ ...partStore[i] });
  }
  requireConfigured(SP_PANEL_BOM_PARTS_LIST_ID, "Panel BOM Parts", "change a part");
  await graphFetch(`${partsPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(panelBomPartFields(input)) });
  const item = await graphFetch<GraphListItem>(`${partsPath()}/${id}?$expand=fields($select=${PART_SELECT})`);
  return toPanelBomPart(item);
}

export async function createPanelBomKit(input: PanelBomKitInput): Promise<PanelBomKit> {
  if (USE_MOCK) {
    const row = mockKit(input, Math.max(0, ...kitStore.map((k) => k.id)) + 1);
    kitStore = [...kitStore, row];
    return mockDelay({ ...row });
  }
  requireConfigured(SP_PANEL_BOM_KITS_LIST_ID, "Panel BOM Kits", "add a kit");
  const created = await graphFetch<GraphListItem>(kitsPath(), {
    method: "POST",
    body: JSON.stringify({ fields: panelBomKitFields(input) }),
  });
  return toPanelBomKit(created);
}

/**
 * Change a kit. Refuses when the kit's stored components couldn't be read:
 * writing the form's (empty) list over them would lose the kit's contents.
 */
export async function updatePanelBomKit(id: number, input: PanelBomKitInput, previous: PanelBomKit): Promise<PanelBomKit> {
  if (previous.componentsCorrupt) {
    throw new Error(
      `ARC couldn't read ${previous.name}'s components, so it won't write over them. Fix the Components value in SharePoint first.`,
    );
  }
  if (USE_MOCK) {
    const i = kitStore.findIndex((k) => k.id === id);
    if (i < 0) throw new Error(`Kit ${id} not found.`);
    kitStore[i] = mockKit(input, id);
    return mockDelay({ ...kitStore[i] });
  }
  requireConfigured(SP_PANEL_BOM_KITS_LIST_ID, "Panel BOM Kits", "change a kit");
  await graphFetch(`${kitsPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(panelBomKitFields(input)) });
  const item = await graphFetch<GraphListItem>(`${kitsPath()}/${id}?$expand=fields($select=${KIT_SELECT})`);
  return toPanelBomKit(item);
}
