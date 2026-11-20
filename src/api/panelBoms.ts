import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_BOMS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { MOCK_PANEL_BOMS } from "@/data/panelBomMockData";
import type { GraphListItem } from "@/types/task";
import type { PanelBom, PanelBomPicks, PanelBomResult } from "@/types/panelBom";
import { parseBomSnapshot, parsePicks, serializeBomSnapshot, serializePicks } from "@/lib/panelBom";
import { toLookupId } from "@/lib/graphValues";

// =============================================================================
// Panel SAP BOM Builder (BusinessIT#59) — saved BOMs, on ALTRONICPANELTEAM.
//
// A saved BOM is the PICKS (what was chosen — parts by SAP #, kits by name)
// plus a SNAPSHOT of the SAP lines as they stood when it was saved. The picks
// are what reopens and edits it; the snapshot is the record of what went into
// SAP, and lets the builder say when the parts list has moved on since.
// Both are JSON in plain multi-line text columns. NO COST: cost comes from
// SAP per viewer and is never stored.
//
// The Panel Order link is stored ONCE, here, as `PanelOrderRef` — a SINGLE
// lookup into Panel Order Headers, written as a bare integer (null clears),
// with both halves selected on read. It's optional (Tim, 2026-11-05: a BOM
// can be saved before its order exists and linked later). The order page
// lists the BOMs pointing at it; nothing is stored on the order.
//
// It HAS a delete: a saved BOM is a working document, not a record of
// something that happened.
// =============================================================================

const FIELD_SELECT = "Title,Notes,PanelOrderRef,PanelOrderRefLookupId,Picks,BomLines";
const ITEM_SELECT = "id,createdBy,createdDateTime,lastModifiedBy,lastModifiedDateTime";

/** Whether the list is set up. Demo mode always is. */
export const PANEL_BOMS_CONFIGURED = USE_MOCK || !!SP_PANEL_BOMS_LIST_ID;

export interface PanelBomInput {
  panelSystemNumber: string;
  notes: string;
  panelOrderId: number | null;
  picks: PanelBomPicks;
  result: PanelBomResult;
}

let store: PanelBom[] = MOCK_PANEL_BOMS.map((b) => ({ ...b }));
let mockUser = { displayName: "Demo User", email: "demo.user@example.com" };

/** Demo-mode-only: reset the store (tests). */
export function resetPanelBomsMockStore(): void {
  store = MOCK_PANEL_BOMS.map((b) => ({ ...b }));
}

/** Demo-mode-only: who the mock records as the author of a save. */
export function setPanelBomsMockUser(user: { displayName: string; email: string }): void {
  mockUser = user;
}

function listPath(): string {
  return `/sites/${SITES.panelTeam}/lists/${SP_PANEL_BOMS_LIST_ID}/items`;
}

function person(raw: GraphListItem["createdBy"]): PanelBom["createdBy"] {
  const u = raw?.user;
  return u?.displayName || u?.email ? { displayName: u.displayName ?? "", email: u.email ?? "" } : null;
}

function date(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toPanelBom(item: GraphListItem): PanelBom {
  const f = item.fields as Record<string, unknown>;
  const { picks, corrupt } = parsePicks(f.Picks);
  const snapshot = parseBomSnapshot(f.BomLines);
  // A single lookup comes back as a bare `PanelOrderRefLookupId` (a STRING),
  // whatever the $select says — the order's title is joined in from the
  // Panel Orders cache by the screens, not here.
  const orderId = toLookupId(f.PanelOrderRefLookupId);
  const expanded = f.PanelOrderRef as { LookupValue?: string } | undefined;
  return {
    id: parseInt(item.id, 10),
    panelSystemNumber: typeof f.Title === "string" ? f.Title.trim() : "",
    notes: typeof f.Notes === "string" ? f.Notes : "",
    panelOrder: orderId ? { lookupId: orderId, title: expanded?.LookupValue ?? "" } : null,
    picks,
    picksCorrupt: corrupt,
    savedLines: snapshot.lines,
    savedManual: snapshot.manual,
    createdBy: person(item.createdBy),
    createdAt: date(item.createdDateTime),
    modifiedBy: person(item.lastModifiedBy),
    modifiedAt: date(item.lastModifiedDateTime),
  };
}

export async function listPanelBoms(): Promise<PanelBom[]> {
  if (USE_MOCK) return mockDelay(store.map((b) => ({ ...b })));
  if (!SP_PANEL_BOMS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$select=${ITEM_SELECT}&$expand=fields($select=${FIELD_SELECT})&$top=999`,
  );
  return items.map(toPanelBom);
}

/** One saved BOM, fresh. Null only when it's gone (404). */
export async function getPanelBom(id: number): Promise<PanelBom | null> {
  if (USE_MOCK) return mockDelay(store.find((b) => b.id === id) ?? null);
  if (!SP_PANEL_BOMS_LIST_ID) return null;
  try {
    const item = await graphFetch<GraphListItem>(`${listPath()}/${id}?$select=${ITEM_SELECT}&$expand=fields($select=${FIELD_SELECT})`);
    return toPanelBom(item);
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}

/** The columns a save writes. `PanelOrderRefLookupId` is a bare integer; null clears it. */
export function panelBomFields(input: PanelBomInput): Record<string, unknown> {
  return {
    Title: input.panelSystemNumber.trim(),
    Notes: input.notes,
    PanelOrderRefLookupId: input.panelOrderId,
    Picks: serializePicks(input.picks),
    BomLines: serializeBomSnapshot(input.result),
  };
}

function requireConfigured(action: string): void {
  if (!SP_PANEL_BOMS_LIST_ID) {
    throw new Error(
      `The Panel BOMs list isn't set up yet, so ARC can't ${action}. ` +
        "Run scripts/create-panel-bom-lists.ps1 and set VITE_SP_PANEL_BOMS_LIST_ID.",
    );
  }
}

function mockRow(input: PanelBomInput, id: number, created: PanelBom | null): PanelBom {
  const now = new Date();
  return {
    id,
    panelSystemNumber: input.panelSystemNumber.trim(),
    notes: input.notes,
    panelOrder: input.panelOrderId ? { lookupId: input.panelOrderId, title: "" } : null,
    picks: { parts: { ...input.picks.parts }, kits: { ...input.picks.kits } },
    picksCorrupt: false,
    savedLines: input.result.lines.map((l) => ({ ...l })),
    savedManual: input.result.manual.map((m) => ({ ...m })),
    createdBy: created?.createdBy ?? { ...mockUser },
    createdAt: created?.createdAt ?? now,
    modifiedBy: { ...mockUser },
    modifiedAt: now,
  };
}

export async function createPanelBom(input: PanelBomInput): Promise<PanelBom> {
  if (USE_MOCK) {
    const row = mockRow(input, Math.max(0, ...store.map((b) => b.id)) + 1, null);
    store = [...store, row];
    return mockDelay({ ...row });
  }
  requireConfigured("save a BOM");
  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({ fields: panelBomFields(input) }),
  });
  // Re-read for the item-level createdBy, which the POST's answer may omit.
  return (await getPanelBom(parseInt(created.id, 10))) ?? toPanelBom(created);
}

/**
 * Save over an existing BOM. Refuses when its stored picks couldn't be read —
 * writing over a value ARC failed to read is the one outcome worse than an
 * error message.
 */
export async function updatePanelBom(id: number, input: PanelBomInput, previous: PanelBom): Promise<PanelBom> {
  if (previous.picksCorrupt) {
    throw new Error(
      `ARC couldn't read what was picked on ${previous.panelSystemNumber || `BOM ${id}`}, so it won't save over it. ` +
        "Save this as a new BOM instead.",
    );
  }
  if (USE_MOCK) {
    const i = store.findIndex((b) => b.id === id);
    if (i < 0) throw new Error(`BOM ${id} not found.`);
    store[i] = mockRow(input, id, store[i]);
    return mockDelay({ ...store[i] });
  }
  requireConfigured("save a BOM");
  await graphFetch(`${listPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(panelBomFields(input)) });
  const fresh = await getPanelBom(id);
  if (!fresh) throw new Error(`BOM ${id} disappeared after it was saved.`);
  return fresh;
}

/** Link a saved BOM to a Panel Order, or unlink it (null). Only that column moves. */
export async function setPanelBomOrder(id: number, panelOrderId: number | null): Promise<PanelBom> {
  if (USE_MOCK) {
    const i = store.findIndex((b) => b.id === id);
    if (i < 0) throw new Error(`BOM ${id} not found.`);
    store[i] = { ...store[i], panelOrder: panelOrderId ? { lookupId: panelOrderId, title: "" } : null };
    return mockDelay({ ...store[i] });
  }
  requireConfigured("link a BOM");
  await graphFetch(`${listPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ PanelOrderRefLookupId: panelOrderId }),
  });
  const fresh = await getPanelBom(id);
  if (!fresh) throw new Error(`BOM ${id} disappeared after it was linked.`);
  return fresh;
}

export async function deletePanelBom(id: number): Promise<void> {
  if (USE_MOCK) {
    store = store.filter((b) => b.id !== id);
    return mockDelay(undefined);
  }
  requireConfigured("delete a BOM");
  await graphFetch(`${listPath()}/${id}`, { method: "DELETE" });
}
