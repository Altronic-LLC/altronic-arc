import { describe, expect, it } from "vitest";
import type { NewProductRevision, PricingHistoryEntry } from "@/types/pricing";
import {
  HistoryUnreadableError,
  appendPricingHistory,
  parsePricingHistory,
  parseRevisionHistory,
  saveRevisionHistory,
} from "./pricingHistory";

function entry(over: Partial<PricingHistoryEntry> = {}): PricingHistoryEntry {
  return {
    pricedAt: "2026-10-13T12:00:00Z",
    pricedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    cost: 100,
    costSource: "SAP",
    distributorDiscountPct: 34,
    discountSource: "SAP",
    input: { kind: "gm", value: 40 },
    listPrice: 253,
    baseGM: 40.1,
    customerGroup: "",
    customerDiscountPct: null,
    customerPrice: null,
    customerGM: null,
    mpg: null,
    family: null,
    note: "",
    ...over,
  };
}

function rev(n: number, over: Partial<NewProductRevision> = {}): NewProductRevision {
  return {
    rev: n,
    savedAt: "2026-10-13T12:00:00Z",
    savedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    note: `R${n}`,
    subAssemblies: [],
    overheadPct: 0,
    uploadedUnitCost: null,
    unitCost: null,
    mpg: "",
    distributorDiscountPct: 34,
    discountSource: "Default",
    input: null,
    listPrice: null,
    baseGM: null,
    priceBreaks: [],
    ...over,
  };
}

describe("parsePricingHistory", () => {
  it("reads blank, null and undefined as an EMPTY history, not a corrupt one", () => {
    for (const raw of [null, undefined, "", "   "]) {
      expect(parsePricingHistory(raw)).toEqual({ entries: [], corrupt: false });
    }
  });

  it("reads unparseable JSON, a non-array and a non-string as CORRUPT", () => {
    for (const raw of ["{not json", '{"a":1}', 42, { a: 1 }]) {
      expect(parsePricingHistory(raw)).toEqual({ entries: [], corrupt: true });
    }
  });

  it("drops entries that aren't pricings without calling the whole value corrupt", () => {
    const raw = JSON.stringify([entry(), null, "x", { pricedAt: 3, listPrice: 1 }, { pricedAt: "t" }]);
    const out = parsePricingHistory(raw);
    expect(out.corrupt).toBe(false);
    expect(out.entries).toEqual([entry()]);
  });
});

describe("appendPricingHistory", () => {
  it("appends to what was there", () => {
    const first = appendPricingHistory("", entry({ listPrice: 200 }));
    const second = appendPricingHistory(first, entry({ listPrice: 253 }));
    expect(JSON.parse(second).map((e: PricingHistoryEntry) => e.listPrice)).toEqual([200, 253]);
  });

  it("REFUSES to write over a value it couldn't read", () => {
    expect(() => appendPricingHistory("{oops", entry())).toThrow(HistoryUnreadableError);
    expect(() => appendPricingHistory("{oops", entry())).toThrow(/won't write over it/);
  });
});

describe("parseRevisionHistory", () => {
  it("keeps only revision snapshots, oldest first", () => {
    const raw = JSON.stringify([rev(3), { rev: 9 }, rev(1), "x", rev(2)]);
    const out = parseRevisionHistory(raw);
    expect(out.corrupt).toBe(false);
    expect(out.entries.map((e) => e.rev)).toEqual([1, 2, 3]);
  });

  it("reads blank as empty and junk as corrupt", () => {
    expect(parseRevisionHistory("")).toEqual({ entries: [], corrupt: false });
    expect(parseRevisionHistory("[1,")).toEqual({ entries: [], corrupt: true });
  });
});

describe("saveRevisionHistory", () => {
  it("starts a history from nothing", () => {
    expect(JSON.parse(saveRevisionHistory(null, rev(1)))).toEqual([rev(1)]);
  });

  it("REPLACES the current revision's entry on a plain Save", () => {
    const raw = JSON.stringify([rev(1), rev(2, { note: "old" })]);
    const out = JSON.parse(saveRevisionHistory(raw, rev(2, { note: "new" }))) as NewProductRevision[];
    expect(out.map((e) => e.rev)).toEqual([1, 2]);
    expect(out[1].note).toBe("new");
    expect(out[0]).toEqual(rev(1));
  });

  it("APPENDS the next revision", () => {
    const raw = JSON.stringify([rev(1), rev(2)]);
    const out = JSON.parse(saveRevisionHistory(raw, rev(3))) as NewProductRevision[];
    expect(out.map((e) => e.rev)).toEqual([1, 2, 3]);
  });

  it("REFUSES to rewrite an earlier revision", () => {
    const raw = JSON.stringify([rev(1), rev(2), rev(3)]);
    expect(() => saveRevisionHistory(raw, rev(2, { note: "rewrite" }))).toThrow(
      "R2 is an earlier revision — only R3 can be saved over.",
    );
  });

  it("REFUSES to write over a value it couldn't read", () => {
    expect(() => saveRevisionHistory("garbage", rev(1))).toThrow(HistoryUnreadableError);
  });
});
