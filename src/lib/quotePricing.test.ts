import { describe, expect, it } from "vitest";
import type { QuoteAssembly, QuoteItem } from "@/types/quote";
import {
  loadedUnitCost,
  priceAtGM,
  priceBreakProblems,
  priceQuote,
  priceQuoteAssembly,
  priceQuoteItem,
  quoteTiers,
  roundCents,
} from "./quotePricing";

function item(over: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: 1,
    quoteId: 1,
    assemblyId: 10,
    lineNo: 1,
    altronicPartNumber: "601001",
    sapPartNumber: "",
    description: "",
    quantity: 1,
    cost: 100,
    materialOverheadPct: null,
    comments: [],
    watchers: [],
    hasAttachments: false,
    ...over,
  };
}

function assembly(over: Partial<QuoteAssembly> = {}): QuoteAssembly {
  return {
    id: 10,
    quoteId: 1,
    lineNo: 1,
    lineType: "Assembly",
    quotedQty: 1,
    cost: null,
    materialOverheadPct: null,
    altronicPartNumber: "791950-08",
    sapPartNumber: "",
    customerPartNumber: "",
    description: "",
    priceBreaks: [],
    targetGM: 50,
    manualPrice: null,
    customerPrice: null,
    ...over,
  };
}

describe("roundCents", () => {
  it("rounds half up to the cent", () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.344)).toBe(2.34);
    expect(roundCents(0.3333 * 3)).toBe(1);
  });

  it("reads binary noise as the decimal it stands for", () => {
    // 57.195 / 0.6 floats as 95.32499999999999; the real answer is 95.325.
    expect(roundCents(57.195 / 0.6)).toBe(95.33);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(0)).toBe(0);
  });
});

describe("loadedUnitCost / priceAtGM", () => {
  it("applies material overhead to the cost", () => {
    expect(loadedUnitCost({ cost: 100, materialOverheadPct: 10 })).toBeCloseTo(110, 10);
    expect(loadedUnitCost({ cost: 100, materialOverheadPct: null })).toBe(100);
  });

  it("is null with no positive cost or a negative overhead", () => {
    expect(loadedUnitCost({ cost: null, materialOverheadPct: 10 })).toBeNull();
    expect(loadedUnitCost({ cost: 0, materialOverheadPct: null })).toBeNull();
    expect(loadedUnitCost({ cost: -5, materialOverheadPct: null })).toBeNull();
    expect(loadedUnitCost({ cost: 5, materialOverheadPct: -1 })).toBeNull();
  });

  it("matches AQT's cost ÷ (1 − GM/100)", () => {
    expect(priceAtGM(0.1, 60)).toBeCloseTo(0.25, 10);
    expect(priceAtGM(400, 20)).toBe(500);
  });

  it("is null outside 0 < GM < 100, or with no cost", () => {
    for (const gm of [0, 100, -5, 150, null]) {
      expect(priceAtGM(10, gm)).toBeNull();
    }
    expect(priceAtGM(null, 40)).toBeNull();
    expect(priceAtGM(0, 40)).toBeNull();
  });
});

describe("priceQuoteItem", () => {
  it("costs a component, extended by quantity — and carries NO sell or margin", () => {
    const p = priceQuoteItem(item({ cost: 30, quantity: 4 }));
    expect(p.loadedUnitCost).toBe(30);
    expect(p.extendedCost).toBe(120);
    expect(p.problem).toBeNull();
    expect(Object.keys(p).sort()).toEqual(["extendedCost", "itemId", "loadedUnitCost", "problem"]);
  });

  it("applies overhead to the unit cost before extending", () => {
    const p = priceQuoteItem(item({ cost: 100, materialOverheadPct: 10, quantity: 2 }));
    expect(p.loadedUnitCost).toBeCloseTo(110, 10);
    expect(p.extendedCost).toBeCloseTo(220, 10);
  });

  it("names what's missing", () => {
    expect(priceQuoteItem(item({ cost: null })).problem).toBe("No cost entered");
    expect(priceQuoteItem(item({ cost: 0 })).problem).toBe("Cost must be more than 0");
    expect(priceQuoteItem(item({ materialOverheadPct: -2 })).problem).toBe(
      "Material overhead can't be negative",
    );
    const noQty = priceQuoteItem(item({ quantity: 0 }));
    expect(noQty.problem).toBe("Quantity must be more than 0");
    expect(noQty.loadedUnitCost).toBe(100);
    expect(noQty.extendedCost).toBeNull();
  });
});

describe("quoteTiers", () => {
  it("is one '1+' tier with no breaks", () => {
    const tiers = quoteTiers(100, 60, []);
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ minQty: 1, maxQty: null, rangeLabel: "1+", unitPrice: 100 });
    expect(tiers[0].gmPct).toBeCloseTo(40, 10);
    expect(tiers[0].profit).toBe(40);
  });

  it("labels ranges like AQT and sorts breaks by quantity", () => {
    const tiers = quoteTiers(100, 60, [
      { qty: 25, discountPct: 10, note: "pallet" },
      { qty: 10, discountPct: 5, note: "" },
    ]);
    expect(tiers.map((t) => t.rangeLabel)).toEqual(["1 – 9", "10 – 24", "25+"]);
    expect(tiers.map((t) => t.unitPrice)).toEqual([100, 95, 90]);
    expect(tiers[2].note).toBe("pallet");
    expect(tiers[1]).toMatchObject({ minQty: 10, maxQty: 24, discountPct: 5 });
  });

  it("holds cost fixed, so GM FALLS as the break discount rises", () => {
    const tiers = quoteTiers(100, 60, [
      { qty: 10, discountPct: 5, note: "" },
      { qty: 25, discountPct: 10, note: "" },
    ]);
    // 40% → (95-60)/95 = 36.84% → (90-60)/90 = 33.33%.
    expect(tiers[0].gmPct).toBeCloseTo(40, 6);
    expect(tiers[1].gmPct).toBeCloseTo(36.8421, 3);
    expect(tiers[2].gmPct).toBeCloseTo(33.3333, 3);
    expect(tiers[1].gmPct!).toBeLessThan(tiers[0].gmPct!);
    expect(tiers[2].gmPct!).toBeLessThan(tiers[1].gmPct!);
  });

  it("rounds each tier price to the cent", () => {
    const tiers = quoteTiers(33.33, null, [{ qty: 5, discountPct: 7, note: "" }]);
    expect(tiers[1].unitPrice).toBe(31); // 33.33 × 0.93 = 30.9969
    expect(tiers[1].gmPct).toBeNull();
    expect(tiers[1].profit).toBeNull();
  });

  it("labels a one-quantity base tier as a single number", () => {
    expect(quoteTiers(10, 5, [{ qty: 2, discountPct: 1, note: "" }])[0].rangeLabel).toBe("1");
  });

  it("carries null prices through", () => {
    expect(quoteTiers(null, 5, [{ qty: 5, discountPct: 1, note: "" }]).map((t) => t.unitPrice)).toEqual([
      null,
      null,
    ]);
  });
});

describe("priceBreakProblems", () => {
  it("accepts valid breaks", () => {
    expect(
      priceBreakProblems([
        { qty: 10, discountPct: 0, note: "" },
        { qty: 25, discountPct: 99, note: "" },
      ]),
    ).toEqual([]);
  });

  it("refuses more than three", () => {
    const four = [2, 3, 4, 5].map((qty) => ({ qty, discountPct: 1, note: "" }));
    expect(priceBreakProblems(four)).toEqual(["At most 3 quantity breaks are allowed."]);
  });

  it("refuses a bad quantity, a duplicate and a bad discount", () => {
    const problems = priceBreakProblems([
      { qty: 1, discountPct: 5, note: "" },
      { qty: 2.5, discountPct: 5, note: "" },
      { qty: 10, discountPct: 100, note: "" },
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/break 1.*2 or more/);
    expect(problems[1]).toMatch(/break 2.*2 or more/);
    expect(problems[2]).toMatch(/break 3.*between 0 and 99/);
    expect(
      priceBreakProblems([
        { qty: 10, discountPct: 5, note: "" },
        { qty: 10, discountPct: 8, note: "" },
      ]),
    ).toEqual(["Quantity break 2: another break already starts at 10."]);
    expect(priceBreakProblems([{ qty: 10, discountPct: -1, note: "" }])).toHaveLength(1);
  });
});

describe("priceQuoteAssembly", () => {
  // 32 + 20% overhead = 38.40; 3 × 6.265 = 18.795. Total cost 57.195.
  const housing = item({ id: 1, lineNo: 1, altronicPartNumber: "H1", cost: 32, materialOverheadPct: 20 });
  const pins = item({ id: 2, lineNo: 2, altronicPartNumber: "P1", cost: 6.265, quantity: 3 });

  it("applies the ONE target GM to the assembly's total component cost", () => {
    const p = priceQuoteAssembly(assembly({ targetGM: 40 }), [housing, pins]);
    expect(p.unitCost).toBeCloseTo(57.195, 10);
    // roundCents(57.195 / 0.6) = 95.33.
    expect(p.computedPrice).toBe(95.33);
    expect(p.price).toBe(95.33);
    expect(p.targetGM).toBe(40);
    expect(p.isManual).toBe(false);
    expect(p.gmPct).toBeCloseTo(((95.33 - 57.195) / 95.33) * 100, 6);
    expect(p.markupPct).toBeCloseTo(((95.33 - 57.195) / 57.195) * 100, 6);
    expect(p.profit).toBeCloseTo(95.33 - 57.195, 10);
    expect(p.problems).toEqual([]);
  });

  it("applies overhead BEFORE the margin", () => {
    // 100 + 10% = 110 loaded; at 50% → 220, not 200 (overhead lost) or 210.
    const p = priceQuoteAssembly(assembly({ targetGM: 50 }), [item({ cost: 100, materialOverheadPct: 10 })]);
    expect(p.computedPrice).toBe(220);
    expect(p.gmPct).toBeCloseTo(50, 10);
  });

  it("rounds ONCE, on the assembly price — never the cost first", () => {
    // Cost 1.004 at 50% → 2.008 → 2.01. Rounding the cost first (1.00) would quote 2.00.
    const p = priceQuoteAssembly(assembly({ targetGM: 50 }), [item({ cost: 1.004 })]);
    expect(p.computedPrice).toBe(2.01);
    expect(p.unitCost).toBe(1.004);
  });

  it("multiplies each component by its quantity in ONE assembly", () => {
    const p = priceQuoteAssembly(assembly({ targetGM: 40 }), [item({ cost: 6, quantity: 4 })]);
    expect(p.unitCost).toBe(24);
    expect(p.computedPrice).toBe(40);
  });

  it("is unpriced with no target GM, and says so", () => {
    const p = priceQuoteAssembly(assembly({ targetGM: null }), [housing]);
    expect(p.computedPrice).toBeNull();
    expect(p.price).toBeNull();
    expect(p.targetGM).toBeNull();
    expect(p.unitCost).toBeCloseTo(38.4, 10);
    expect(p.problems).toEqual(["No target GM set for this assembly."]);
  });

  it("refuses a target GM outside 0 < GM < 100", () => {
    for (const gm of [0, 100, -5]) {
      const p = priceQuoteAssembly(assembly({ targetGM: gm }), [housing]);
      expect(p.computedPrice).toBeNull();
      expect(p.problems).toEqual(["The target GM must be between 0 and 100."]);
    }
  });

  it("uses a manual override and recomputes GM from it", () => {
    const p = priceQuoteAssembly(assembly({ targetGM: 40, manualPrice: 90 }), [housing, pins]);
    expect(p.computedPrice).toBe(95.33);
    expect(p.price).toBe(90);
    expect(p.isManual).toBe(true);
    expect(p.gmPct).toBeCloseTo(((90 - 57.195) / 90) * 100, 6);
    expect(p.tiers[0].unitPrice).toBe(90);
  });

  it("prices a manual override with no target GM, and doesn't flag the missing GM", () => {
    const p = priceQuoteAssembly(assembly({ targetGM: null, manualPrice: 80 }), [housing]);
    expect(p.computedPrice).toBeNull();
    expect(p.price).toBe(80);
    expect(p.isManual).toBe(true);
    expect(p.gmPct).toBeCloseTo(((80 - 38.4) / 80) * 100, 6);
    expect(p.problems).toEqual([]);
  });

  it("prices a manual override even when components are incomplete", () => {
    const p = priceQuoteAssembly(assembly({ manualPrice: 99.999 }), [item({ cost: null })]);
    expect(p.price).toBe(100);
    expect(p.computedPrice).toBeNull();
    expect(p.unitCost).toBeNull();
    expect(p.gmPct).toBeNull();
    expect(p.problems).toEqual(["Line 1 (601001): No cost entered."]);
  });

  it("ignores a non-positive manual price, and says so", () => {
    const p = priceQuoteAssembly(assembly({ manualPrice: 0, targetGM: 60 }), [item({ cost: 0.1 })]);
    expect(p.isManual).toBe(false);
    expect(p.price).toBe(0.25);
    expect(p.problems).toContain("The manual price must be more than 0.");
  });

  it("counts only this assembly's components", () => {
    const other = item({ id: 9, assemblyId: 99, cost: 1000 });
    expect(
      priceQuoteAssembly(assembly({ targetGM: 60 }), [item({ cost: 0.1 }), other]).computedPrice,
    ).toBe(0.25);
  });

  it("a component with no cost blocks the price, and each problem is named by line", () => {
    const empty = priceQuoteAssembly(assembly(), []);
    expect(empty.price).toBeNull();
    expect(empty.unitCost).toBeNull();
    expect(empty.problems).toEqual(["No components yet."]);

    const p = priceQuoteAssembly(assembly(), [
      housing,
      item({ id: 3, lineNo: 3, altronicPartNumber: "", quantity: 0 }),
      item({ id: 4, lineNo: 4, altronicPartNumber: "X9", cost: null }),
    ]);
    expect(p.computedPrice).toBeNull();
    expect(p.price).toBeNull();
    expect(p.unitCost).toBeNull();
    expect(p.problems).toEqual([
      "Line 3: Quantity must be more than 0.",
      "Line 4 (X9): No cost entered.",
    ]);
  });

  it("carries the break table — cost fixed, GM falling — and its problems", () => {
    const p = priceQuoteAssembly(
      assembly({
        targetGM: 20,
        priceBreaks: [
          { qty: 10, discountPct: 10, note: "" },
          { qty: 1, discountPct: 0, note: "" },
        ],
      }),
      [item({ cost: 400 })],
    );
    expect(p.tiers[0].unitPrice).toBe(500);
    expect(p.tiers[0].gmPct).toBeCloseTo(20, 10);
    expect(p.problems).toEqual(["Quantity break 2: the quantity must be a whole number of 2 or more."]);
  });
});

describe("priceQuoteAssembly — a standalone PART line", () => {
  const part = (over: Partial<QuoteAssembly> = {}) =>
    assembly({ lineType: "Part", altronicPartNumber: "SPARE-1", cost: 32, materialOverheadPct: 20, targetGM: 40, ...over });

  it("prices from its own loaded cost: cost × (1 + overhead) ÷ (1 − GM)", () => {
    const p = priceQuoteAssembly(part(), []);
    expect(p.lineType).toBe("Part");
    expect(p.unitCost).toBeCloseTo(38.4, 10);
    expect(p.computedPrice).toBe(64); // 38.40 / 0.6
    expect(p.price).toBe(64);
    expect(p.gmPct).toBeCloseTo(40, 10);
    expect(p.items).toEqual([]);
    expect(p.problems).toEqual([]);
  });

  it("treats a blank overhead as 0", () => {
    expect(priceQuoteAssembly(part({ materialOverheadPct: null }), []).computedPrice).toBe(53.33);
  });

  it("ignores stray components entirely", () => {
    const stray = item({ assemblyId: 10, cost: 9999, quantity: 5 });
    const p = priceQuoteAssembly(part(), [stray, item({ assemblyId: 10, cost: null })]);
    expect(p.unitCost).toBeCloseTo(38.4, 10);
    expect(p.computedPrice).toBe(64);
    expect(p.items).toEqual([]);
    expect(p.problems).toEqual([]);
  });

  it("uses a manual price, and tiers off it with cost fixed", () => {
    const p = priceQuoteAssembly(
      part({ manualPrice: 60, priceBreaks: [{ qty: 10, discountPct: 10, note: "" }] }),
      [],
    );
    expect(p.price).toBe(60);
    expect(p.isManual).toBe(true);
    expect(p.computedPrice).toBe(64);
    expect(p.gmPct).toBeCloseTo(((60 - 38.4) / 60) * 100, 6);
    expect(p.tiers.map((t) => t.unitPrice)).toEqual([60, 54]);
  });

  it("names a missing cost, a negative overhead and a missing GM", () => {
    expect(priceQuoteAssembly(part({ cost: null }), []).problems).toEqual(["No cost entered for this part."]);
    expect(priceQuoteAssembly(part({ cost: 0 }), []).problems).toEqual(["The part's cost must be more than 0."]);
    const neg = priceQuoteAssembly(part({ materialOverheadPct: -1 }), []);
    expect(neg.price).toBeNull();
    expect(neg.problems).toEqual(["Material overhead can't be negative."]);
    expect(priceQuoteAssembly(part({ targetGM: null }), []).problems).toEqual(["No target GM set for this part."]);
  });

  it("an ASSEMBLY ignores the line's own cost fields", () => {
    const p = priceQuoteAssembly(assembly({ cost: 5000, materialOverheadPct: 10, targetGM: 50 }), [item({ cost: 10 })]);
    expect(p.unitCost).toBe(10);
    expect(p.computedPrice).toBe(20);
  });
});

describe("the quoted quantity — Subtotal at its break", () => {
  // A Part at $38.40 loaded, 40% GM → $64.00; breaks 10+ at 5%, 25+ at 10%.
  const line = (over: Partial<QuoteAssembly> = {}) =>
    assembly({
      lineType: "Part",
      cost: 32,
      materialOverheadPct: 20,
      targetGM: 40,
      priceBreaks: [
        { qty: 10, discountPct: 5, note: "" },
        { qty: 25, discountPct: 10, note: "" },
      ],
      ...over,
    });

  it("in the base tier", () => {
    const p = priceQuoteAssembly(line({ quotedQty: 3 }), []);
    expect(p.quotedQty).toBe(3);
    expect(p.quotedUnitPrice).toBe(64);
    expect(p.lineTotal).toBe(192);
    expect(p.lineCost).toBeCloseTo(115.2, 10);
    expect(p.lineProfit).toBeCloseTo(76.8, 10);
    expect(p.lineGmPct).toBeCloseTo(40, 6);
  });

  it("exactly at a break takes that break's price", () => {
    const p = priceQuoteAssembly(line({ quotedQty: 10 }), []);
    expect(p.quotedUnitPrice).toBe(60.8);
    expect(p.lineTotal).toBe(608);
    // Cost is fixed per unit, so the GM at the break is lower.
    expect(p.lineGmPct!).toBeLessThan(40);
  });

  it("above the last break takes the last break's price", () => {
    const p = priceQuoteAssembly(line({ quotedQty: 500 }), []);
    expect(p.quotedUnitPrice).toBe(57.6);
    expect(p.lineTotal).toBe(28800);
  });

  it("rounds the Subtotal to the cent from the rounded unit price", () => {
    // 33.33 × 7 = 233.31 exactly; a unit price that floats must not drift.
    const p = priceQuoteAssembly(line({ manualPrice: 33.33, priceBreaks: [], quotedQty: 7 }), []);
    expect(p.lineTotal).toBe(233.31);
  });

  it("follows a manual price", () => {
    const p = priceQuoteAssembly(line({ manualPrice: 50, quotedQty: 12 }), []);
    expect(p.quotedUnitPrice).toBe(47.5); // 50 less the 10+ break's 5%
    expect(p.lineTotal).toBe(570);
  });

  it("is never blank — a missing or invalid quantity counts as ONE", () => {
    for (const q of [undefined, 0, -2, 1.5, NaN]) {
      const p = priceQuoteAssembly(line({ quotedQty: q as unknown as number }), []);
      expect(p.quotedQty).toBe(1);
      expect(p.lineTotal).toBe(64);
    }
  });

  it("has no Subtotal while the line has no price", () => {
    const p = priceQuoteAssembly(line({ cost: null, quotedQty: 5 }), []);
    expect(p.quotedUnitPrice).toBeNull();
    expect(p.lineTotal).toBeNull();
    expect(p.lineCost).toBeNull();
  });
});

describe("priceQuote — the Total", () => {
  it("is Σ every line's Subtotal, with cost and GM weighted at the quoted quantities", () => {
    const q = priceQuote(
      [
        assembly({ id: 10, lineNo: 1, targetGM: 20, quotedQty: 2 }),
        assembly({ id: 20, lineNo: 2, lineType: "Part", cost: 10, targetGM: 50, quotedQty: 3 }),
      ],
      [item({ id: 1, assemblyId: 10, cost: 400 })],
    );
    // 2 × $500 + 3 × $20 = $1,060; cost 2 × 400 + 3 × 10 = 830.
    expect(q.quoteTotal).toBe(1060);
    expect(q.quoteCost).toBe(830);
    expect(q.quoteGmPct).toBeCloseTo((230 / 1060) * 100, 6);
    expect(q.problems).toEqual([]);
  });

  it("is null when a line can't be priced, and names that line", () => {
    const q = priceQuote(
      [assembly({ id: 10, lineNo: 1, quotedQty: 2 }), assembly({ id: 20, lineNo: 2, altronicPartNumber: "X9" })],
      [item({ id: 1, assemblyId: 10, cost: 400 })],
    );
    expect(q.quoteTotal).toBeNull();
    expect(q.problems).toEqual(["Line 2 (X9) has no price yet."]);
  });
});

describe("priceQuote", () => {
  it("totals one of each assembly and WEIGHTS the quote GM over the totals", () => {
    // A $0.10 part at 60% (price 0.25) beside a $400 board at 20% (price 500):
    // weighted GM = 100.15 / 500.25 = 20.02%, NOT the 40% average.
    const a1 = assembly({ id: 10, lineNo: 2, targetGM: 60 });
    const a2 = assembly({ id: 20, lineNo: 1, targetGM: 20 });
    const items = [
      item({ id: 1, assemblyId: 10, cost: 0.1 }),
      item({ id: 2, assemblyId: 20, cost: 400 }),
    ];
    const q = priceQuote([a1, a2], items);
    expect(q.assemblies.map((a) => a.assemblyId)).toEqual([20, 10]);
    expect(q.totalPrice).toBe(500.25);
    expect(q.totalCost).toBeCloseTo(400.1, 10);
    expect(q.gmPct).toBeCloseTo(20.02, 2);
    expect(q.gmPct).not.toBeCloseTo(40, 0);
  });

  it("is unpriced when any assembly is, or there are none", () => {
    expect(priceQuote([], [])).toMatchObject({ totalPrice: null, totalCost: null, gmPct: null });
    const q = priceQuote([assembly({ id: 10 }), assembly({ id: 20 })], [item({ assemblyId: 10 })]);
    expect(q.totalPrice).toBeNull();
    expect(q.totalCost).toBeNull();
  });
});
