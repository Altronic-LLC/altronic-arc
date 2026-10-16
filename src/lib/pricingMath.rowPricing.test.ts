import { describe, expect, it } from "vitest";
import type { SubAssembly, SubAssemblyLine } from "@/types/pricing";
import {
  MAX_COMPARISON_PARTS,
  addComparisonParts,
  averageBaseGM,
  comparisonFigures,
  parsePartNumberList,
  rowPricingProblems,
  rowSellingPrice,
  rowUnitCost,
  subAssemblyTotals,
} from "./pricingMath";

// =============================================================================
// A sub-assembly's OWN selling price, and the SAP comparison (Ray, 2026-10-14).
// The row is priced on ONE of it at its own cost with its own overhead; the
// discount is the worksheet's unless the row overrides it.
// =============================================================================

const line = (over: Partial<SubAssemblyLine> = {}): SubAssemblyLine => ({
  partNumber: "P1",
  description: "",
  quantity: 1,
  uploadedCost: 10,
  adjustedCost: null,
  ...over,
});

function sub(over: Partial<SubAssembly> = {}): SubAssembly {
  return {
    id: 1,
    worksheetId: 1,
    rev: 1,
    name: "Board",
    kind: "subAssembly",
    altronicPartNumber: "",
    sapPartNumber: "",
    sortOrder: 0,
    quantityPerProduct: 3,
    overheadPct: 20,
    pricing: { input: { kind: "gm", value: 40 }, distributorDiscountPct: null, priceBreaks: [{ minQty: 10, discountPct: 10 }] },
    pricingCorrupt: false,
    lines: [line()],
    linesCorrupt: false,
    fileName: "",
    uploadedAt: null,
    uploadedBy: null,
    ...over,
  };
}

describe("rowUnitCost", () => {
  it("is ONE of the row with its overhead — not times the quantity per product", () => {
    expect(rowUnitCost(sub()).used).toBeCloseTo(12);
  });
});

describe("rowSellingPrice", () => {
  it("is null for a row that isn't sold on its own", () => {
    expect(rowSellingPrice(sub({ pricing: null }), 34)).toBeNull();
  });

  it("prices the row like the product: cost ÷ (1 − GM) ÷ (1 − discount), to the dollar", () => {
    const s = rowSellingPrice(sub(), 34)!;
    // 12 / 0.6 / 0.66 = 30.30 → $30
    expect(s.result.listPrice).toBe(30);
    expect(s.discountPct).toBe(34);
    expect(s.result.distributorPrice).toBeCloseTo(19.8);
    expect(s.result.baseGM).toBeCloseTo(39.39, 1);
    expect(s.breaks).toEqual([expect.objectContaining({ minQty: 10, price: 27 })]);
  });

  it("uses the row's OWN discount when it overrides the worksheet's", () => {
    const s = rowSellingPrice(sub({ pricing: { input: { kind: "gm", value: 40 }, distributorDiscountPct: 0, priceBreaks: [] } }), 34)!;
    expect(s.discountPct).toBe(0);
    expect(s.result.listPrice).toBe(20);
  });

  it("works a customer price back to the list, at the worksheet's discount", () => {
    const s = rowSellingPrice(sub({ pricing: { input: { kind: "customer", value: 19.8 }, distributorDiscountPct: null, priceBreaks: [] } }), 34)!;
    expect(s.result.listPrice).toBe(30);
  });

  it("says a blank box is blank rather than pricing it at 0", () => {
    const s = rowSellingPrice(sub({ pricing: { input: { kind: "gm", value: Number.NaN }, distributorDiscountPct: null, priceBreaks: [] } }), 34)!;
    expect(s.result.listPrice).toBeNull();
    expect(s.result.problem).toBe("Enter a target GM.");
  });
});

describe("rowPricingProblems", () => {
  it("names a row whose typed price can't be used", () => {
    const bad = sub({ pricing: { input: { kind: "gm", value: 120 }, distributorDiscountPct: null, priceBreaks: [] } });
    expect(rowPricingProblems([bad], 34)).toEqual(["Board's own price: The target GM must be above 0% and below 100%."]);
  });

  it("names bad breaks and a bad discount override", () => {
    const breaks = sub({ name: "A", pricing: { input: { kind: "gm", value: 40 }, distributorDiscountPct: null, priceBreaks: [{ minQty: 1, discountPct: 5 }] } });
    const discount = sub({ name: "B", pricing: { input: { kind: "gm", value: 40 }, distributorDiscountPct: 100, priceBreaks: [] } });
    const out = rowPricingProblems([breaks, discount], 34);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^A's own price: Each break needs/);
    expect(out[1]).toMatch(/^B's own price:/);
  });

  it("does NOT block a save while a component's cost is still missing — only what was typed does", () => {
    const halfBuilt = sub({ lines: [line({ uploadedCost: null })] });
    expect(rowSellingPrice(halfBuilt, 34)!.result.listPrice).toBeNull();
    expect(rowPricingProblems([halfBuilt], 34)).toEqual([]);
  });

  it("ignores rows with no own price", () => {
    expect(rowPricingProblems([sub({ pricing: null })], 34)).toEqual([]);
  });
});

describe("subAssemblyTotals — the revision records each row's own price", () => {
  it("records the price, its discount and its breaks — and leaves it off a row that isn't priced", () => {
    const [priced, plain] = subAssemblyTotals(
      [sub({ altronicPartNumber: "791990-24" }), sub({ id: 2, sortOrder: 1, name: "Coil", pricing: null })],
      34,
    );
    expect(priced.altronicPartNumber).toBe("791990-24");
    expect(priced.sellingPrice).toEqual({
      distributorDiscountPct: 34,
      unitCost: expect.closeTo(12, 5),
      listPrice: 30,
      baseGM: expect.closeTo(39.39, 1),
      priceBreaks: [{ minQty: 10, discountPct: 10 }],
    });
    expect(plain).not.toHaveProperty("sellingPrice");
  });
});

describe("SAP comparison", () => {
  it("reads part numbers out of whatever was pasted — lines, commas, tabs — de-duplicated", () => {
    expect(parsePartNumberList("1003-0114-16\n1003-0114-18, 1003-0114-16\t2001-0310-15 ;")).toEqual([
      "1003-0114-16",
      "1003-0114-18",
      "2001-0310-15",
    ]);
  });

  it("adds only what isn't there yet, case-insensitively, and caps the list", () => {
    expect(addComparisonParts(["ab-1"], ["AB-1", "c-2"])).toEqual({ parts: ["ab-1", "c-2"], skipped: 0 });
    const full = Array.from({ length: MAX_COMPARISON_PARTS }, (_, i) => `p${i}`);
    expect(addComparisonParts(full, ["x", "y"])).toEqual({ parts: full, skipped: 2 });
  });

  it("measures base GM at the distributor price — the MPG's discount, else the standard 34%", () => {
    expect(comparisonFigures({ listPrice: 100, cost: 33 }, 50)).toEqual({
      distributorDiscountPct: 50,
      discountFromSap: true,
      distributorPrice: 50,
      baseGM: 34,
    });
    const std = comparisonFigures({ listPrice: 100, cost: null }, null);
    expect(std).toMatchObject({ distributorDiscountPct: 34, discountFromSap: false, distributorPrice: 66, baseGM: null });
  });

  it("averages only the GMs that could be worked out", () => {
    expect(averageBaseGM([40, null, 50])).toEqual({ average: 45, counted: 2 });
    expect(averageBaseGM([null])).toEqual({ average: null, counted: 0 });
  });
});
