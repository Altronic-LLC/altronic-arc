import { describe, expect, it } from "vitest";
import {
  bomCost,
  bomsForOrder,
  computePanelBom,
  itemNumber,
  kitCluster,
  kitCost,
  kitShown,
  panelBomCsv,
  panelBomCsvName,
  panelBomKitProblem,
  panelBomPartProblem,
  parseBomSnapshot,
  parseKitComponents,
  parsePicks,
  partShown,
  partsBySap,
  sameBomLines,
  sapPasteBlocks,
  sapPasteText,
  serializeBomSnapshot,
  serializeKitComponents,
  serializePicks,
  setPick,
  sortPanelBomParts,
  type PanelBomFilters,
  type PanelBomPartInput,
} from "./panelBom";
import type { PanelBom, PanelBomKit, PanelBomPart } from "@/types/panelBom";

// The Panel SAP BOM Builder's rules (BusinessIT#59), ported from Mark
// Balent's computeBom(). Every fixture here is invented.

let id = 1;
function part(sap: string, cluster: number, category: string, description: string, extra: Partial<PanelBomPart> = {}): PanelBomPart {
  return {
    id: id++,
    sapPartNumber: sap,
    altronicPartNumber: "",
    description,
    cluster,
    category,
    standard: false,
    preferred: false,
    doNotQuote: false,
    datasheet: "",
    qtyIfUsed: null,
    active: true,
    ...extra,
  };
}
function kit(name: string, components: PanelBomKit["components"], extra: Partial<PanelBomKit> = {}): PanelBomKit {
  return { id: id++, name, description: name, category: "Kits", standard: false, preferred: false, active: true, components, componentsCorrupt: false, ...extra };
}

const PARTS = [
  part("1000-0000-03", 2, "Relays", "Relay B"),
  part("1000-0000-01", 0, "Enclosures", "Enclosure"),
  part("1000-0000-04", 2, "Relays", "Relay A"),
  part("1000-0000-02", 0, "Mounting", "Lift lug"),
  part("1000-0000-05", 5, "Fuses", "Fuse"),
  // The same SAP # on a second row, in a later cluster — the first row
  // (cluster 2) names and numbers it.
  part("1000-0000-03", 9, "Spares", "Relay B (spare)"),
];
const KITS = [
  kit("KIT-ENC", [
    { qty: 1, sapPartNumber: "1000-0000-01", mfgPartNumber: "E", description: "Enclosure" },
    { qty: 4, sapPartNumber: "1000-0000-02", mfgPartNumber: "L", description: "Lift lug" },
  ]),
  kit("KIT-PURGE", [
    { qty: 1, sapPartNumber: "1000-0000-05", mfgPartNumber: "F", description: "Fuse" },
    { qty: 2, sapPartNumber: "", mfgPartNumber: "VENT-1", description: "Purge vent" },
  ]),
];

describe("computePanelBom", () => {
  it("sums a part picked directly and the same part from a kit (extras on top of a kit)", () => {
    const r = computePanelBom(PARTS, KITS, { parts: { "1000-0000-02": 2 }, kits: { "KIT-ENC": 2 } });
    expect(r.lines.find((l) => l.sapPartNumber === "1000-0000-02")?.qty).toBe(2 + 4 * 2);
    expect(r.lines.find((l) => l.sapPartNumber === "1000-0000-01")?.qty).toBe(2);
  });

  it("puts a kit component with no SAP # on the hand-entry list, never on the SAP lines", () => {
    const r = computePanelBom(PARTS, KITS, { parts: {}, kits: { "KIT-PURGE": 3 } });
    expect(r.lines.map((l) => l.sapPartNumber)).toEqual(["1000-0000-05"]);
    expect(r.manual).toEqual([{ reason: "manual", qty: 6, partNumber: "VENT-1", description: "Purge vent", kitName: "KIT-PURGE" }]);
  });

  it("lists an SAP # that isn't on the parts list instead of dropping it", () => {
    const r = computePanelBom(PARTS, KITS, { parts: { "1999-9999-99": 2 }, kits: {} });
    expect(r.lines).toEqual([]);
    expect(r.manual).toEqual([{ reason: "unlisted", qty: 2, partNumber: "1999-9999-99", description: "", kitName: null }]);
  });

  it("lists a picked kit that's no longer on the kits list", () => {
    const r = computePanelBom(PARTS, KITS, { parts: {}, kits: { "KIT-GONE": 1 } });
    expect(r.manual[0]).toMatchObject({ reason: "unlisted", partNumber: "KIT-GONE" });
  });

  it("emits lines in parts-list order with item numbers banded by cluster", () => {
    const r = computePanelBom(PARTS, KITS, {
      parts: { "1000-0000-01": 1, "1000-0000-02": 1, "1000-0000-03": 1, "1000-0000-04": 1, "1000-0000-05": 1 },
      kits: {},
    });
    expect(r.lines.map((l) => [l.item, l.sapPartNumber])).toEqual([
      [10, "1000-0000-01"], // cluster 0, Enclosures
      [20, "1000-0000-02"], // cluster 0, Mounting
      [2000, "1000-0000-04"], // cluster 2, Relays, "Relay A"
      [2010, "1000-0000-03"], // cluster 2, Relays, "Relay B"
      [5000, "1000-0000-05"],
    ]);
  });

  it("numbers a part on two rows ONCE, from its first row in list order", () => {
    const r = computePanelBom(PARTS, KITS, { parts: { "1000-0000-03": 5 }, kits: {} });
    expect(r.lines).toEqual([{ item: 2000, qty: 5, sapPartNumber: "1000-0000-03", description: "Relay B", cluster: 2 }]);
  });

  it("ignores zero and negative quantities", () => {
    expect(computePanelBom(PARTS, KITS, { parts: { "1000-0000-01": 0 }, kits: { "KIT-ENC": -1 } })).toEqual({ lines: [], manual: [] });
  });

  it("keeps float noise out of kit quantities", () => {
    const k = [kit("KIT-WIRE", [{ qty: 0.1, sapPartNumber: "1000-0000-05", mfgPartNumber: "", description: "" }])];
    expect(computePanelBom(PARTS, k, { parts: {}, kits: { "KIT-WIRE": 3 } }).lines[0].qty).toBe(0.3);
  });
});

describe("item numbers", () => {
  it("cluster 0 runs 10, 20, 30; cluster N starts at N × 1000 and steps by 10", () => {
    expect([1, 2, 3].map((n) => itemNumber(0, n))).toEqual([10, 20, 30]);
    expect([1, 2].map((n) => itemNumber(4, n))).toEqual([4000, 4010]);
  });
});

describe("SAP paste blocks", () => {
  it("is 28 rows first, then 27", () => {
    expect(sapPasteBlocks(10)).toEqual([[0, 10]]);
    expect(sapPasteBlocks(28)).toEqual([[0, 28]]);
    expect(sapPasteBlocks(29)).toEqual([[0, 28], [28, 29]]);
    expect(sapPasteBlocks(82)).toEqual([[0, 28], [28, 55], [55, 82]]);
    expect(sapPasteBlocks(0)).toEqual([]);
  });

  it("copies Item, L, Qty, SAP # tab-separated", () => {
    expect(sapPasteText([{ item: 10, qty: 2, sapPartNumber: "1000-0000-01", description: "x", cluster: 0 }])).toBe("10\tL\t2\t1000-0000-01");
  });
});

describe("CSV", () => {
  it("has Mark's columns, quotes descriptions, and marks hand-entry lines", () => {
    const csv = panelBomCsv({
      lines: [{ item: 10, qty: 1, sapPartNumber: "1000-0000-01", description: 'Enclosure, 36" tall', cluster: 0 }],
      manual: [
        { reason: "manual", qty: 2, partNumber: "VENT-1", description: "Purge vent", kitName: "KIT-PURGE" },
        { reason: "unlisted", qty: 1, partNumber: "1999-9999-99", description: "", kitName: null },
      ],
    });
    expect(csv.split("\r\n")).toEqual([
      "Item,L CNT,QTY,SAP Part #,Description",
      '10,L,1,1000-0000-01,"Enclosure, 36"" tall"',
      "MANUAL,,2,VENT-1,Purge vent",
      "NOT LISTED,,1,1999-9999-99,",
      "",
    ]);
  });

  it("names the file after the Panel System #, safely", () => {
    expect(panelBomCsvName("PS-1001")).toBe("PS-1001 - BOM.csv");
    expect(panelBomCsvName("A/B:C")).toBe("A-B-C - BOM.csv");
    expect(panelBomCsvName("  ")).toBe("Panel - BOM.csv");
  });
});

describe("picks", () => {
  it("keys by SAP # and kit name; 0 removes; whole numbers only", () => {
    let p = setPick({ parts: {}, kits: {} }, "parts", "1000-0000-01", 2.7);
    expect(p.parts).toEqual({ "1000-0000-01": 2 });
    p = setPick(p, "kits", "KIT-ENC", 1);
    p = setPick(p, "parts", "1000-0000-01", 0);
    expect(p).toEqual({ parts: {}, kits: { "KIT-ENC": 1 } });
  });

  it("round-trips, reads blank as empty, and calls anything else corrupt", () => {
    const picks = { parts: { "1000-0000-01": 3 }, kits: { "KIT-ENC": 1 } };
    expect(parsePicks(serializePicks(picks))).toEqual({ picks, corrupt: false });
    expect(parsePicks("")).toEqual({ picks: { parts: {}, kits: {} }, corrupt: false });
    expect(parsePicks(null).corrupt).toBe(false);
    expect(parsePicks("{not json").corrupt).toBe(true);
    expect(parsePicks('{"parts":{"x":"two"}}').corrupt).toBe(true);
    expect(parsePicks('{"parts":[1]}').corrupt).toBe(true);
  });

  it("snapshots round-trip, and an unreadable snapshot reads as empty", () => {
    const result = computePanelBom(PARTS, KITS, { parts: {}, kits: { "KIT-PURGE": 1 } });
    expect(parseBomSnapshot(serializeBomSnapshot(result))).toEqual(result);
    expect(parseBomSnapshot("{bad")).toEqual({ lines: [], manual: [] });
  });

  it("compares saved lines by item, qty and SAP #", () => {
    const a = computePanelBom(PARTS, KITS, { parts: { "1000-0000-01": 1 }, kits: {} }).lines;
    expect(sameBomLines(a, a.map((l) => ({ ...l, description: "renamed" })))).toBe(true);
    expect(sameBomLines(a, a.map((l) => ({ ...l, qty: 2 })))).toBe(false);
    expect(sameBomLines(a, [])).toBe(false);
  });
});

describe("kit components", () => {
  it("round-trips with short keys and refuses a bad quantity", () => {
    const c = KITS[1].components;
    expect(parseKitComponents(serializeKitComponents(c))).toEqual({ components: c, corrupt: false });
    expect(JSON.parse(serializeKitComponents(c))[0]).toEqual({ qty: 1, sap: "1000-0000-05", mfg: "F", desc: "Fuse" });
    expect(parseKitComponents('[{"qty":0}]').corrupt).toBe(true);
    expect(parseKitComponents("{}").corrupt).toBe(true);
    expect(parseKitComponents("")).toEqual({ components: [], corrupt: false });
  });

  it("puts a kit in its components' most common cluster, the lower one on a tie", () => {
    const bySap = partsBySap(PARTS);
    expect(kitCluster(KITS[0], bySap)).toBe(0);
    const tie = kit("T", [
      { qty: 1, sapPartNumber: "1000-0000-05", mfgPartNumber: "", description: "" },
      { qty: 1, sapPartNumber: "1000-0000-04", mfgPartNumber: "", description: "" },
    ]);
    expect(kitCluster(tie, bySap)).toBe(2);
    expect(kitCluster(kit("N", [{ qty: 1, sapPartNumber: "", mfgPartNumber: "", description: "x" }]), bySap)).toBe(0);
  });
});

describe("validation", () => {
  const good: PanelBomPartInput = {
    sapPartNumber: "1000-0000-01",
    altronicPartNumber: "",
    description: "Thing",
    cluster: 3,
    category: "",
    standard: false,
    preferred: false,
    doNotQuote: false,
    datasheet: "",
    qtyIfUsed: null,
    active: true,
  };
  it("checks a part's SAP #, description, cluster and hint", () => {
    expect(panelBomPartProblem(good)).toBeNull();
    expect(panelBomPartProblem({ ...good, sapPartNumber: "1000-0000" })).toMatch(/####/);
    expect(panelBomPartProblem({ ...good, description: " " })).toMatch(/description/);
    expect(panelBomPartProblem({ ...good, cluster: 10 })).toMatch(/cluster/);
    expect(panelBomPartProblem({ ...good, qtyIfUsed: NaN })).toMatch(/Qty if used/);
  });

  it("checks a kit's name (unique), components and their SAP #s", () => {
    const k = { name: "KIT-X", description: "", category: "", standard: false, preferred: false, active: true, components: KITS[1].components };
    expect(panelBomKitProblem(k, ["KIT-ENC"])).toBeNull();
    expect(panelBomKitProblem(k, ["kit-x"])).toMatch(/already exists/);
    expect(panelBomKitProblem({ ...k, components: [] }, [])).toMatch(/at least one/);
    expect(panelBomKitProblem({ ...k, components: [{ qty: 1, sapPartNumber: "12", mfgPartNumber: "", description: "x" }] }, [])).toMatch(/####/);
    expect(panelBomKitProblem({ ...k, components: [{ qty: 1, sapPartNumber: "", mfgPartNumber: "", description: "" }] }, [])).toMatch(/description/);
  });
});

describe("the picker", () => {
  const all: PanelBomFilters = { search: "", preferredOnly: false, standardOnly: false, hideDoNotQuote: true };
  it("hides Do Not Quote and retired parts — unless they're already picked", () => {
    const dnq = part("1000-0000-09", 1, "X", "Old relay", { doNotQuote: true });
    const retired = part("1000-0000-08", 1, "X", "Old fuse", { active: false });
    expect(partShown(dnq, all, false)).toBe(false);
    expect(partShown(dnq, all, true)).toBe(true);
    expect(partShown(dnq, { ...all, hideDoNotQuote: false }, false)).toBe(true);
    expect(partShown(retired, all, false)).toBe(false);
    expect(partShown(retired, all, true)).toBe(true);
  });

  it("searches every word across SAP #, MFG #, description and category", () => {
    const p = part("1000-0000-07", 1, "Relays", "Relay, 24 VDC", { altronicPartNumber: "RLY-24" });
    expect(partShown(p, { ...all, search: "24 relay" }, false)).toBe(true);
    expect(partShown(p, { ...all, search: "rly-24" }, false)).toBe(true);
    expect(partShown(p, { ...all, search: "fuse" }, false)).toBe(false);
    expect(kitShown(KITS[0], { ...all, search: "kit-enc" }, false)).toBe(true);
    expect(kitShown(KITS[0], { ...all, preferredOnly: true }, false)).toBe(false);
  });

  it("orders the list by cluster, category, then description", () => {
    expect(sortPanelBomParts(PARTS).map((p) => p.description)).toEqual([
      "Enclosure",
      "Lift lug",
      "Relay A",
      "Relay B",
      "Fuse",
      "Relay B (spare)",
    ]);
  });
});

describe("cost (from SAP, never stored)", () => {
  const costs = new Map<string, number | null>([
    ["1000-0000-01", 100],
    ["1000-0000-02", 2.5],
    ["1000-0000-05", null],
  ]);
  it("totals a kit, counting components SAP has no cost for", () => {
    expect(kitCost(KITS[0], costs)).toEqual({ cost: 110, missing: 0 });
    expect(kitCost(KITS[1], costs)).toEqual({ cost: 0, missing: 2 });
  });
  it("totals a BOM, leaving out lines with no cost and saying how many", () => {
    const { lines } = computePanelBom(PARTS, KITS, { parts: { "1000-0000-05": 1 }, kits: { "KIT-ENC": 1 } });
    expect(bomCost(lines, costs)).toEqual({ cost: 110, missing: 1 });
  });
});

describe("bomsForOrder", () => {
  it("lists the BOMs pointing at the order, newest first", () => {
    const b = (bid: number, orderId: number | null, at: string) =>
      ({ id: bid, panelOrder: orderId ? { lookupId: orderId, title: "" } : null, modifiedAt: new Date(at) }) as PanelBom;
    const boms = [b(1, 7, "2026-01-01"), b(2, 8, "2026-01-02"), b(3, 7, "2026-01-03"), b(4, null, "2026-01-04")];
    expect(bomsForOrder(boms, 7).map((x) => x.id)).toEqual([3, 1]);
  });
});
