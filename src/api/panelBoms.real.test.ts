import { beforeEach, describe, expect, it, vi } from "vitest";

// The BOM Builder's three lists in REAL mode (BusinessIT#59) — none of this is
// visible from the mock branch. What's pinned:
//  - no cost column is read or written on any list;
//  - a saved BOM's Panel Order is a SINGLE lookup: both halves selected,
//    written as a bare integer, null to unlink;
//  - a write over picks (or kit components) ARC couldn't read is refused.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({ graphFetch, graphFetchAll }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, panelTeam: "panel-site" },
    SP_PANEL_BOM_PARTS_LIST_ID: "parts-list",
    SP_PANEL_BOM_KITS_LIST_ID: "kits-list",
    SP_PANEL_BOMS_LIST_ID: "boms-list",
  };
});

import { listPanelBomKits, listPanelBomParts, panelBomPartFields, updatePanelBomKit } from "./panelBomParts";
import { createPanelBom, listPanelBoms, setPanelBomOrder, toPanelBom, updatePanelBom } from "./panelBoms";
import type { PanelBom, PanelBomKit } from "@/types/panelBom";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
});

const RESULT = { lines: [{ item: 10, qty: 1, sapPartNumber: "1000-0000-01", description: "x", cluster: 0 }], manual: [] };

describe("parts and kits", () => {
  it("reads the parts list's columns — and no cost", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "4", fields: { Title: "1000-0000-01", Cluster: 3, Category: "", Standard: true, DoNotQuote: false, QtyIfUsed: "2" } },
    ]);
    const [p] = await listPanelBomParts();
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("/sites/panel-site/lists/parts-list/items");
    expect(url).toMatch(/Title,AltronicPartNumber,Description,Cluster,Category/);
    expect(url).not.toMatch(/cogs|cost/i);
    expect(p).toMatchObject({ id: 4, sapPartNumber: "1000-0000-01", cluster: 3, category: "(No Category)", standard: true, qtyIfUsed: 2, active: true });
  });

  it("writes every part column and no cost", () => {
    const fields = panelBomPartFields({
      sapPartNumber: " 1000-0000-01 ",
      altronicPartNumber: "A",
      description: "D",
      cluster: 2,
      category: " ",
      standard: false,
      preferred: true,
      doNotQuote: false,
      datasheet: "",
      qtyIfUsed: null,
      active: false,
    });
    expect(fields).toEqual({
      Title: "1000-0000-01",
      AltronicPartNumber: "A",
      Description: "D",
      Cluster: 2,
      Category: "(No Category)",
      Standard: false,
      Preferred: true,
      DoNotQuote: false,
      Datasheet: "",
      QtyIfUsed: null,
      Active: false,
    });
  });

  it("reads kit components from JSON, and flags an unreadable value", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { Title: "KIT-A", Components: '[{"qty":2,"sap":"1000-0000-01","mfg":"M","desc":"D"}]' } },
      { id: "2", fields: { Title: "KIT-B", Components: "not json" } },
    ]);
    const [a, b] = await listPanelBomKits();
    expect(a.components).toEqual([{ qty: 2, sapPartNumber: "1000-0000-01", mfgPartNumber: "M", description: "D" }]);
    expect(b.componentsCorrupt).toBe(true);
  });

  it("refuses to write over components it couldn't read", async () => {
    const previous = { id: 2, name: "KIT-B", componentsCorrupt: true } as PanelBomKit;
    await expect(
      updatePanelBomKit(2, { name: "KIT-B", description: "", category: "", standard: false, preferred: false, active: true, components: [] }, previous),
    ).rejects.toThrow(/won't write over/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});

describe("saved BOMs", () => {
  it("selects both halves of the order lookup and the item-level author", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listPanelBoms();
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("PanelOrderRef,PanelOrderRefLookupId");
    expect(url).toContain("$select=id,createdBy,createdDateTime,lastModifiedBy");
  });

  it("reads a bare PanelOrderRefLookupId (a string) as the order", () => {
    const bom = toPanelBom({
      id: "5",
      createdDateTime: "2026-11-05T10:00:00Z",
      lastModifiedDateTime: "2026-11-05T11:00:00Z",
      lastModifiedBy: { user: { displayName: "Pat", email: "pat@example.com" } },
      fields: { Title: "PS-1", PanelOrderRefLookupId: "12", Picks: '{"parts":{"1000-0000-01":2},"kits":{}}', BomLines: JSON.stringify(RESULT) },
    });
    expect(bom.panelOrder).toEqual({ lookupId: 12, title: "" });
    expect(bom.picks.parts).toEqual({ "1000-0000-01": 2 });
    expect(bom.savedLines).toEqual(RESULT.lines);
    expect(bom.modifiedBy?.displayName).toBe("Pat");
  });

  it("creates with the order as a bare integer and the picks and lines as JSON", async () => {
    graphFetch.mockResolvedValueOnce({ id: "9", fields: {} }).mockResolvedValueOnce({ id: "9", createdDateTime: "", lastModifiedDateTime: "", fields: { Title: "PS-1" } });
    await createPanelBom({ panelSystemNumber: " PS-1 ", notes: "n", panelOrderId: 12, picks: { parts: { "1000-0000-01": 1 }, kits: {} }, result: RESULT });
    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toBe("/sites/panel-site/lists/boms-list/items");
    const fields = JSON.parse((init as RequestInit).body as string).fields;
    expect(fields.PanelOrderRefLookupId).toBe(12);
    expect(fields).not.toHaveProperty("PanelOrderRef");
    expect(fields.Title).toBe("PS-1");
    expect(JSON.parse(fields.Picks)).toEqual({ parts: { "1000-0000-01": 1 }, kits: {} });
    expect(JSON.parse(fields.BomLines).lines).toEqual(RESULT.lines);
    expect(JSON.stringify(fields)).not.toMatch(/cost/i);
  });

  it("unlinks with null, touching nothing else", async () => {
    graphFetch.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "9", createdDateTime: "", lastModifiedDateTime: "", fields: {} });
    await setPanelBomOrder(9, null);
    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toBe("/sites/panel-site/lists/boms-list/items/9/fields");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ PanelOrderRefLookupId: null });
  });

  it("refuses to save over picks it couldn't read", async () => {
    const previous = { id: 9, panelSystemNumber: "PS-1", picksCorrupt: true } as PanelBom;
    await expect(
      updatePanelBom(9, { panelSystemNumber: "PS-1", notes: "", panelOrderId: null, picks: { parts: {}, kits: {} }, result: RESULT }, previous),
    ).rejects.toThrow(/won't save over it/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
