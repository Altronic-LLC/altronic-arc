import { describe, expect, it } from "vitest";
import type { QuoteAssembly } from "@/types/quote";
import {
  quoteTargetSummary,
  lineCostBreakdown,
  priceAtGM,
  priceBreakProblems,
  priceQuote,
  priceQuoteAssembly,
  quoteTiers,
  roundCents,
} from "./quotePricing";

function assembly(over: Partial<QuoteAssembly> = {}): QuoteAssembly {
  return {
    id: 10,
    quoteId: 1,
    lineNo: 1,
    quotedQty: 1,
    materialCost: 100,
    laborCost: null,
    materialOverheadPct: null,
    altronicPartNumber: "791950-08",
    sapPartNumber: "",
    customerPartNumber: "",
    description: "",
    priceBreaks: [],
    targetGM: 50,
    manualPrice: null,
    targetPrice: null,
    estimatedEau: null,
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

describe("lineCostBreakdown / priceAtGM", () => {
  it("is material × (1 + overhead%) + labor — overhead on MATERIAL only", () => {
    const c = lineCostBreakdown({ materialCost: 100, laborCost: 40, materialOverheadPct: 18 });
    expect(c).not.toBeNull();
    expect(c!.material).toBe(100);
    expect(c!.overhead).toBeCloseTo(18, 10);
    expect(c!.labor).toBe(40);
    // 158, not 165.20 (overhead on labor too) or 140 (overhead lost).
    expect(c!.total).toBeCloseTo(158, 10);
  });

  it("counts a blank material, labor or overhead as 0", () => {
    expect(lineCostBreakdown({ materialCost: 100, laborCost: null, materialOverheadPct: null })!.total).toBe(100);
    expect(lineCostBreakdown({ materialCost: null, laborCost: 25, materialOverheadPct: 18 })!.total).toBe(25);
  });

  it("is null with no cost at all, or any negative input", () => {
    expect(lineCostBreakdown({ materialCost: null, laborCost: null, materialOverheadPct: 18 })).toBeNull();
    expect(lineCostBreakdown({ materialCost: 0, laborCost: 0, materialOverheadPct: 18 })).toBeNull();
    expect(lineCostBreakdown({ materialCost: -5, laborCost: 10, materialOverheadPct: null })).toBeNull();
    expect(lineCostBreakdown({ materialCost: 5, laborCost: -1, materialOverheadPct: null })).toBeNull();
    expect(lineCostBreakdown({ materialCost: 5, laborCost: null, materialOverheadPct: -1 })).toBeNull();
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
  // 520 material + 18% overhead (93.60) + 85 labor = 698.60.
  const line = (over: Partial<QuoteAssembly> = {}) =>
    assembly({ materialCost: 520, laborCost: 85, materialOverheadPct: 18, targetGM: 40, ...over });

  it("applies the ONE target GM to the line's total cost", () => {
    const p = priceQuoteAssembly(line());
    expect(p.unitCost).toBeCloseTo(698.6, 10);
    expect(p.cost).toMatchObject({ material: 520, labor: 85 });
    expect(p.cost!.overhead).toBeCloseTo(93.6, 10);
    // roundCents(698.60 / 0.6) = 1,164.33.
    expect(p.computedPrice).toBe(1164.33);
    expect(p.price).toBe(1164.33);
    expect(p.targetGM).toBe(40);
    expect(p.isManual).toBe(false);
    expect(p.gmPct).toBeCloseTo(((1164.33 - 698.6) / 1164.33) * 100, 6);
    expect(p.markupPct).toBeCloseTo(((1164.33 - 698.6) / 698.6) * 100, 6);
    expect(p.profit).toBeCloseTo(1164.33 - 698.6, 10);
    expect(p.problems).toEqual([]);
  });

  it("applies overhead BEFORE the margin", () => {
    // 100 + 10% = 110; at 50% → 220, not 200 (overhead lost).
    const p = priceQuoteAssembly(assembly({ materialCost: 100, materialOverheadPct: 10, targetGM: 50 }));
    expect(p.computedPrice).toBe(220);
    expect(p.gmPct).toBeCloseTo(50, 10);
  });

  it("prices a labor-only line", () => {
    const p = priceQuoteAssembly(assembly({ materialCost: null, laborCost: 30, materialOverheadPct: 18 }));
    expect(p.unitCost).toBe(30);
    expect(p.computedPrice).toBe(60);
  });

  it("rounds ONCE, on the line price — never the cost first", () => {
    // Cost 1.004 at 50% → 2.008 → 2.01. Rounding the cost first (1.00) would quote 2.00.
    const p = priceQuoteAssembly(assembly({ materialCost: 1.004 }));
    expect(p.computedPrice).toBe(2.01);
    expect(p.unitCost).toBe(1.004);
  });

  it("is unpriced with no target GM, and says so", () => {
    const p = priceQuoteAssembly(line({ targetGM: null }));
    expect(p.computedPrice).toBeNull();
    expect(p.price).toBeNull();
    expect(p.targetGM).toBeNull();
    expect(p.unitCost).toBeCloseTo(698.6, 10);
    expect(p.problems).toEqual(["No target GM set for this line."]);
  });

  it("refuses a target GM outside 0 < GM < 100", () => {
    for (const gm of [0, 100, -5]) {
      const p = priceQuoteAssembly(line({ targetGM: gm }));
      expect(p.computedPrice).toBeNull();
      expect(p.problems).toEqual(["The target GM must be between 0 and 100."]);
    }
  });

  it("uses a manual override and recomputes GM from it", () => {
    const p = priceQuoteAssembly(line({ manualPrice: 1100 }));
    expect(p.computedPrice).toBe(1164.33);
    expect(p.price).toBe(1100);
    expect(p.isManual).toBe(true);
    expect(p.gmPct).toBeCloseTo(((1100 - 698.6) / 1100) * 100, 6);
    expect(p.tiers[0].unitPrice).toBe(1100);
  });

  it("prices a manual override with no target GM, and doesn't flag the missing GM", () => {
    const p = priceQuoteAssembly(assembly({ targetGM: null, manualPrice: 80, materialCost: 38.4 }));
    expect(p.computedPrice).toBeNull();
    expect(p.price).toBe(80);
    expect(p.isManual).toBe(true);
    expect(p.gmPct).toBeCloseTo(((80 - 38.4) / 80) * 100, 6);
    expect(p.problems).toEqual([]);
  });

  it("prices a manual override even with no cost entered", () => {
    const p = priceQuoteAssembly(assembly({ manualPrice: 99.999, materialCost: null }));
    expect(p.price).toBe(100);
    expect(p.computedPrice).toBeNull();
    expect(p.unitCost).toBeNull();
    expect(p.cost).toBeNull();
    expect(p.gmPct).toBeNull();
    expect(p.problems).toEqual(["No cost entered — enter the material and/or labor cost."]);
  });

  it("ignores a non-positive manual price, and says so", () => {
    const p = priceQuoteAssembly(assembly({ manualPrice: 0, targetGM: 60, materialCost: 0.1 }));
    expect(p.isManual).toBe(false);
    expect(p.price).toBe(0.25);
    expect(p.problems).toContain("The manual price must be more than 0.");
  });

  it("names the first cost problem", () => {
    expect(priceQuoteAssembly(assembly({ materialCost: -1 })).problems).toEqual([
      "The material cost can't be negative.",
    ]);
    expect(priceQuoteAssembly(assembly({ laborCost: -1 })).problems).toEqual(["The labor cost can't be negative."]);
    expect(priceQuoteAssembly(assembly({ materialOverheadPct: -1 })).problems).toEqual([
      "Overhead can't be negative.",
    ]);
    expect(priceQuoteAssembly(assembly({ materialCost: null })).problems).toEqual([
      "No cost entered — enter the material and/or labor cost.",
    ]);
  });

  it("carries the break table — cost fixed, GM falling — and its problems", () => {
    const p = priceQuoteAssembly(
      assembly({
        materialCost: 400,
        targetGM: 20,
        priceBreaks: [
          { qty: 10, discountPct: 10, note: "" },
          { qty: 1, discountPct: 0, note: "" },
        ],
      }),
    );
    expect(p.tiers[0].unitPrice).toBe(500);
    expect(p.tiers[0].gmPct).toBeCloseTo(20, 10);
    expect(p.problems).toEqual(["Quantity break 2: the quantity must be a whole number of 2 or more."]);
  });
});

describe("the quoted quantity — Subtotal at its break", () => {
  // $32 material + 20% overhead = $38.40, 40% GM → $64.00; breaks 10+ at 5%, 25+ at 10%.
  const line = (over: Partial<QuoteAssembly> = {}) =>
    assembly({
      materialCost: 32,
      materialOverheadPct: 20,
      targetGM: 40,
      priceBreaks: [
        { qty: 10, discountPct: 5, note: "" },
        { qty: 25, discountPct: 10, note: "" },
      ],
      ...over,
    });

  it("in the base tier", () => {
    const p = priceQuoteAssembly(line({ quotedQty: 3 }));
    expect(p.quotedQty).toBe(3);
    expect(p.quotedUnitPrice).toBe(64);
    expect(p.lineTotal).toBe(192);
    expect(p.lineCost).toBeCloseTo(115.2, 10);
    expect(p.lineProfit).toBeCloseTo(76.8, 10);
    expect(p.lineGmPct).toBeCloseTo(40, 6);
  });

  it("exactly at a break takes that break's price", () => {
    const p = priceQuoteAssembly(line({ quotedQty: 10 }));
    expect(p.quotedUnitPrice).toBe(60.8);
    expect(p.lineTotal).toBe(608);
    // Cost is fixed per unit, so the GM at the break is lower.
    expect(p.lineGmPct!).toBeLessThan(40);
  });

  it("above the last break takes the last break's price", () => {
    const p = priceQuoteAssembly(line({ quotedQty: 500 }));
    expect(p.quotedUnitPrice).toBe(57.6);
    expect(p.lineTotal).toBe(28800);
  });

  it("rounds the Subtotal to the cent from the rounded unit price", () => {
    // 33.33 × 7 = 233.31 exactly; a unit price that floats must not drift.
    const p = priceQuoteAssembly(line({ manualPrice: 33.33, priceBreaks: [], quotedQty: 7 }));
    expect(p.lineTotal).toBe(233.31);
  });

  it("follows a manual price", () => {
    const p = priceQuoteAssembly(line({ manualPrice: 50, quotedQty: 12 }));
    expect(p.quotedUnitPrice).toBe(47.5); // 50 less the 10+ break's 5%
    expect(p.lineTotal).toBe(570);
  });

  it("is never blank — a missing or invalid quantity counts as ONE", () => {
    for (const q of [undefined, 0, -2, 1.5, NaN]) {
      const p = priceQuoteAssembly(line({ quotedQty: q as unknown as number }));
      expect(p.quotedQty).toBe(1);
      expect(p.lineTotal).toBe(64);
    }
  });

  it("has no Subtotal while the line has no price", () => {
    const p = priceQuoteAssembly(line({ materialCost: null, quotedQty: 5 }));
    expect(p.quotedUnitPrice).toBeNull();
    expect(p.lineTotal).toBeNull();
    expect(p.lineCost).toBeNull();
  });
});

describe("priceQuote — the Total", () => {
  it("is Σ every line's Subtotal, with cost and GM weighted at the quoted quantities", () => {
    const q = priceQuote([
      assembly({ id: 10, lineNo: 1, materialCost: 400, targetGM: 20, quotedQty: 2 }),
      assembly({ id: 20, lineNo: 2, materialCost: 10, targetGM: 50, quotedQty: 3 }),
    ]);
    // 2 × $500 + 3 × $20 = $1,060; cost 2 × 400 + 3 × 10 = 830.
    expect(q.quoteTotal).toBe(1060);
    expect(q.quoteCost).toBe(830);
    expect(q.quoteGmPct).toBeCloseTo((230 / 1060) * 100, 6);
    expect(q.problems).toEqual([]);
  });

  it("is null when a line can't be priced, and names that line", () => {
    const q = priceQuote([
      assembly({ id: 10, lineNo: 1, materialCost: 400, quotedQty: 2 }),
      assembly({ id: 20, lineNo: 2, altronicPartNumber: "X9", materialCost: null }),
    ]);
    expect(q.quoteTotal).toBeNull();
    expect(q.problems).toEqual(["Line 2 (X9) has no price yet."]);
  });
});

describe("priceQuote", () => {
  it("totals one of each line and WEIGHTS the quote GM over the totals", () => {
    // A $0.10 part at 60% (price 0.25) beside a $400 board at 20% (price 500):
    // weighted GM = 100.15 / 500.25 = 20.02%, NOT the 40% average.
    const a1 = assembly({ id: 10, lineNo: 2, materialCost: 0.1, targetGM: 60 });
    const a2 = assembly({ id: 20, lineNo: 1, materialCost: 400, targetGM: 20 });
    const q = priceQuote([a1, a2]);
    expect(q.assemblies.map((a) => a.assemblyId)).toEqual([20, 10]);
    expect(q.totalPrice).toBe(500.25);
    expect(q.totalCost).toBeCloseTo(400.1, 10);
    expect(q.gmPct).toBeCloseTo(20.02, 2);
    expect(q.gmPct).not.toBeCloseTo(40, 0);
  });

  it("is unpriced when any line is, or there are none", () => {
    expect(priceQuote([])).toMatchObject({ totalPrice: null, totalCost: null, gmPct: null });
    const q = priceQuote([assembly({ id: 10 }), assembly({ id: 20, materialCost: null })]);
    expect(q.totalPrice).toBeNull();
    expect(q.totalCost).toBeNull();
  });
});

describe("quoteTargetSummary — price vs target, revenue and GM at the EAU", () => {
  it("compares each line's price at its quoted quantity with the target, and totals a year at the EAU", () => {
    const s = quoteTargetSummary([
      // 100 at 50% → $200; target $180 → $20 (11.1%) above. 100 a year.
      assembly({ id: 1, lineNo: 1, targetPrice: 180, estimatedEau: 100 }),
      // 50 at 50% → $100; target $120 → $20 below. 200 a year.
      assembly({ id: 2, lineNo: 2, materialCost: 50, targetPrice: 120, estimatedEau: 200 }),
      // No EAU — compared per line, left out of the annual totals.
      assembly({ id: 3, lineNo: 3, materialCost: 25, targetPrice: 50 }),
      // No target — in the revenue, out of the target comparison.
      assembly({ id: 4, lineNo: 4, materialCost: 10, estimatedEau: 10 }),
    ]);
    const [a, b, c, d] = s.lines;
    expect(a).toMatchObject({ unitPrice: 200, vsTarget: 20, annualRevenue: 20000, annualCost: 10000, annualGm: 10000, gmPct: 50 });
    expect(a.vsTargetPct).toBeCloseTo(11.11, 2);
    expect(b).toMatchObject({ unitPrice: 100, vsTarget: -20, annualRevenue: 20000 });
    expect(c).toMatchObject({ unitPrice: 50, vsTarget: 0, annualRevenue: null, annualGm: null });
    expect(d).toMatchObject({ unitPrice: 20, vsTarget: null, annualRevenue: 200, annualGm: 100 });

    expect(s.annualRevenue).toBe(40200);
    expect(s.annualGm).toBe(20100);
    expect(s.annualGmPct).toBe(50);
    // Only lines 1 and 2 have a price, a target AND an EAU: 180×100 + 120×200.
    expect(s.targetRevenue).toBe(42000);
    expect(s.vsTarget).toBe(-2000);
    expect(s.vsTargetPct).toBeCloseTo(-4.76, 2);
    expect(s.linesMissingEau).toBe(1);
    expect(s.linesMissingTarget).toBe(1);
  });

  it("uses the break price at the QUOTED quantity, not the base price", () => {
    const s = quoteTargetSummary([
      assembly({ quotedQty: 10, priceBreaks: [{ qty: 10, discountPct: 10, note: "" }], targetPrice: 175, estimatedEau: 50 }),
    ]);
    expect(s.lines[0].unitPrice).toBe(180);
    expect(s.lines[0].vsTarget).toBe(5);
    expect(s.annualRevenue).toBe(9000);
    // Cost is fixed per unit: (180 − 100) ÷ 180.
    expect(s.annualGmPct).toBeCloseTo(44.44, 2);
  });

  it("a line with a manual price and no cost counts in revenue but never in GM", () => {
    const s = quoteTargetSummary([
      assembly({ id: 1, materialCost: null, targetGM: null, manualPrice: 90, estimatedEau: 10 }),
      assembly({ id: 2, lineNo: 2, estimatedEau: 10 }),
    ]);
    expect(s.annualRevenue).toBe(2900);
    // GM over line 2 only: 2,000 revenue, 1,000 GM.
    expect(s.annualGm).toBe(1000);
    expect(s.annualGmPct).toBe(50);
  });

  it("is all nulls, not zeros, when nothing has been entered", () => {
    const s = quoteTargetSummary([assembly()]);
    expect(s).toMatchObject({
      annualRevenue: null,
      annualGm: null,
      annualGmPct: null,
      targetRevenue: null,
      vsTarget: null,
      linesMissingEau: 1,
      linesMissingTarget: 1,
    });
    expect(quoteTargetSummary([]).lines).toEqual([]);
  });
});
