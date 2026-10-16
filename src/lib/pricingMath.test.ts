import { describe, expect, it } from "vitest";
import type { SapPart, SubAssembly, SubAssemblyLine } from "@/types/pricing";
import {
  MAX_PRICE_BREAKS,
  STANDARD_DISTRIBUTOR_DISCOUNT_PCT,
  baseGrossMarginPct,
  buildComparablesPanel,
  customerPriceBreaks,
  discountProblem,
  distributorPrice,
  familyPrefix,
  grossMarginPct,
  lineUnitCost,
  listPriceForTargetGm,
  priceBreaks,
  priceBreaksProblem,
  priceFromInput,
  subAssemblyCost,
  subAssemblyTotals,
  summarizePanel,
  tierRanges,
  worksheetCost,
  overheadFactor,
} from "./pricingMath";

// =============================================================================
// Sales Pricing maths. The rules pinned here are the ones the module header
// states: base GM is measured at the DISTRIBUTOR price, a back-calculated list
// is rounded to the WHOLE DOLLAR (a typed one is kept to the cent), each
// comparable is measured at ITS OWN MPG's discount, and a cost that can't be
// worked out is null with a named problem — never a silent 0.
// =============================================================================

function line(over: Partial<SubAssemblyLine> = {}): SubAssemblyLine {
  return { partNumber: "P1", description: "", quantity: 1, uploadedCost: 10, adjustedCost: null, ...over };
}

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
    quantityPerProduct: 1,
    pricing: null,
    pricingCorrupt: false,
    overheadPct: null,
    lines: [line()],
    linesCorrupt: false,
    fileName: "",
    uploadedAt: null,
    uploadedBy: null,
    ...over,
  };
}

function part(over: Partial<SapPart> = {}): SapPart {
  return {
    altronicPartNumber: "791950-08",
    sapPartNumber: "1000-0000-01",
    description: "Part",
    mpg: "M1",
    listPrice: 100,
    cost: 33,
    ...over,
  };
}

describe("distributorPrice / grossMarginPct / baseGrossMarginPct", () => {
  it("takes the discount off list", () => {
    expect(distributorPrice(100, 34)).toBeCloseTo(66, 10);
    expect(distributorPrice(100, 0)).toBe(100);
  });

  it("works out GM as (price − cost) ÷ price", () => {
    expect(grossMarginPct(200, 150)).toBe(25);
    expect(grossMarginPct(100, 120)).toBe(-20);
  });

  it("is null for an unknown or non-positive price, or an unknown cost", () => {
    expect(grossMarginPct(null, 10)).toBeNull();
    expect(grossMarginPct(undefined, 10)).toBeNull();
    expect(grossMarginPct(0, 10)).toBeNull();
    expect(grossMarginPct(-5, 10)).toBeNull();
    expect(grossMarginPct(100, null)).toBeNull();
    expect(grossMarginPct(Number.NaN, 10)).toBeNull();
  });

  it("measures base GM at the distributor price, not at list", () => {
    // list 100 at 34% → 66; cost 33 → 50%. At list it would be 67%.
    expect(baseGrossMarginPct(100, 33, 34)).toBeCloseTo(50, 10);
    expect(baseGrossMarginPct(null, 33, 34)).toBeNull();
    expect(baseGrossMarginPct(100, null, 34)).toBeNull();
  });
});

describe("discountProblem", () => {
  it("accepts 0 up to (not including) 100", () => {
    expect(discountProblem(0)).toBeNull();
    expect(discountProblem(99.9)).toBeNull();
  });

  it("refuses blank, negative and 100%+, naming the field", () => {
    expect(discountProblem(null)).toMatch(/Enter the distributor discount/);
    expect(discountProblem(-1)).toMatch(/at least 0%/);
    expect(discountProblem(100)).toMatch(/below 100%/);
    expect(discountProblem(null, "customer discount")).toMatch(/customer discount/);
  });
});

describe("listPriceForTargetGm", () => {
  it("rounds the back-calculated list to the WHOLE dollar (cost 100, GM 40%, 34% → $253)", () => {
    const r = listPriceForTargetGm(100, 40, 34);
    if ("problem" in r) throw new Error(r.problem);
    expect(r.unrounded).toBeCloseTo(252.525, 3);
    expect(r.listPrice).toBe(253);
    // The ACTUAL base GM at the rounded list is ≈40.1%, not the 40% asked for.
    expect(baseGrossMarginPct(r.listPrice, 100, 34)).toBeCloseTo(40.11, 2);
  });

  it("rounds to the nearest dollar, up or down", () => {
    // 100 / 0.5 / 1 = 200 exactly; 101 / 0.5 = 202; 100.4/0.5 = 200.8 → 201; 100.2/0.5 = 200.4 → 200
    const up = listPriceForTargetGm(100.4, 50, 0);
    const down = listPriceForTargetGm(100.2, 50, 0);
    expect("listPrice" in up && up.listPrice).toBe(201);
    expect("listPrice" in down && down.listPrice).toBe(200);
  });

  it("says why when it can't work one out", () => {
    expect(listPriceForTargetGm(null, 40, 34)).toEqual({ problem: "Enter the cost before setting a margin." });
    expect(listPriceForTargetGm(0, 40, 34)).toEqual({ problem: "Enter the cost before setting a margin." });
    expect(listPriceForTargetGm(100, null, 34)).toEqual({ problem: "Enter a target GM." });
    expect(listPriceForTargetGm(100, 0, 34)).toHaveProperty("problem", expect.stringMatching(/above 0%/));
    expect(listPriceForTargetGm(100, 100, 34)).toHaveProperty("problem", expect.stringMatching(/below 100%/));
    expect(listPriceForTargetGm(100, 40, 100)).toHaveProperty("problem", expect.stringMatching(/distributor discount/));
  });
});

describe("priceFromInput", () => {
  it("works the list price back from a typed CUSTOMER (distributor) price, to the cent", () => {
    const r = priceFromInput({ cost: 500, distributorDiscountPct: 36, input: { kind: "customer", value: 1280 }, customerDiscountPct: null });
    expect(r.listPrice).toBe(2000);
    expect(r.distributorPrice).toBe(1280);
    // An uneven price keeps its cents rather than rounding the list to the dollar.
    const odd = priceFromInput({ cost: 500, distributorDiscountPct: 34, input: { kind: "customer", value: 1000 }, customerDiscountPct: null });
    expect(odd.listPrice).toBe(1515.15);
    expect(odd.distributorPrice).toBe(1000);
  });

  it("refuses a customer price of $0 or less", () => {
    const r = priceFromInput({ cost: 500, distributorDiscountPct: 34, input: { kind: "customer", value: 0 }, customerDiscountPct: null });
    expect(r.problem).toBe("Enter a customer price above $0.");
    expect(r.listPrice).toBeNull();
  });

  it("asks for an input when there is none", () => {
    const r = priceFromInput({ cost: 100, distributorDiscountPct: 34, input: null, customerDiscountPct: null });
    expect(r.problem).toBe("Enter a target GM or a list price.");
    expect(r.listPrice).toBeNull();
  });

  it("from a GM: whole-dollar list, the ACTUAL base GM, distributor price to the cent", () => {
    const r = priceFromInput({
      cost: 100,
      distributorDiscountPct: 34,
      input: { kind: "gm", value: 40 },
      customerDiscountPct: null,
    });
    expect(r.problem).toBeNull();
    expect(r.listPrice).toBe(253);
    expect(r.distributorPrice).toBe(166.98);
    expect(r.baseGM).toBeCloseTo(40.11, 2);
    expect(r.customerPrice).toBeNull();
    expect(r.customerGM).toBeNull();
  });

  it("takes a TYPED list price as typed, to the cent — never rounded to the dollar", () => {
    const r = priceFromInput({
      cost: 100,
      distributorDiscountPct: 34,
      input: { kind: "list", value: 252.49 },
      customerDiscountPct: null,
    });
    expect(r.listPrice).toBe(252.49);
  });

  it("rounds a typed list to the cent", () => {
    const r = priceFromInput({
      cost: 100,
      distributorDiscountPct: 34,
      input: { kind: "list", value: 252.495 },
      customerDiscountPct: null,
    });
    expect(r.listPrice).toBe(252.5);
  });

  it("works out the customer's price and GM from their discount", () => {
    const r = priceFromInput({
      cost: 100,
      distributorDiscountPct: 34,
      input: { kind: "list", value: 200 },
      customerDiscountPct: 25,
    });
    expect(r.customerPrice).toBe(150);
    expect(r.customerGM).toBeCloseTo((50 / 150) * 100, 10);
  });

  it("ignores an unusable customer discount rather than inventing a price", () => {
    const r = priceFromInput({
      cost: 100,
      distributorDiscountPct: 34,
      input: { kind: "list", value: 200 },
      customerDiscountPct: 100,
    });
    expect(r.customerPrice).toBeNull();
  });

  it("reports problems from a GM or a list input", () => {
    expect(
      priceFromInput({ cost: null, distributorDiscountPct: 34, input: { kind: "gm", value: 40 }, customerDiscountPct: null })
        .problem,
    ).toBe("Enter the cost before setting a margin.");
    expect(
      priceFromInput({ cost: 100, distributorDiscountPct: 34, input: { kind: "list", value: 0 }, customerDiscountPct: null })
        .problem,
    ).toBe("Enter a list price above $0.");
    expect(
      priceFromInput({ cost: 100, distributorDiscountPct: 120, input: { kind: "list", value: 50 }, customerDiscountPct: null })
        .problem,
    ).toMatch(/distributor discount/);
  });

  it("still prices a typed list with no cost — margin unknown, price known", () => {
    const r = priceFromInput({
      cost: null,
      distributorDiscountPct: 34,
      input: { kind: "list", value: 100 },
      customerDiscountPct: null,
    });
    expect(r.listPrice).toBe(100);
    expect(r.baseGM).toBeNull();
  });
});

describe("familyPrefix", () => {
  it("is the first six digits", () => {
    expect(familyPrefix("791950-08")).toBe("791950");
    expect(familyPrefix("  7919501")).toBe("791950");
  });

  it("is null when the number doesn't start with six digits", () => {
    expect(familyPrefix("79195-08")).toBeNull();
    expect(familyPrefix("A791950")).toBeNull();
    expect(familyPrefix("")).toBeNull();
  });
});

describe("buildComparablesPanel", () => {
  const subject = { altronicPartNumber: "791950-08", sapPartNumber: "1000-0000-08" };

  it("measures each part at ITS OWN MPG's discount", () => {
    const panel = buildComparablesPanel(
      [
        part({ altronicPartNumber: "A", sapPartNumber: "a", mpg: "M1", listPrice: 100, cost: 40 }),
        part({ altronicPartNumber: "B", sapPartNumber: "b", mpg: "M2", listPrice: 100, cost: 40 }),
      ],
      { M1: 20, M2: 50 },
      subject,
    );
    const [a, b] = panel.rows;
    expect(a.distributorDiscountPct).toBe(20);
    expect(a.distributorPrice).toBe(80);
    expect(a.baseGM).toBeCloseTo(50, 10);
    expect(b.distributorDiscountPct).toBe(50);
    expect(b.distributorPrice).toBe(50);
    expect(b.baseGM).toBeCloseTo(20, 10);
    expect(a.discountIsDefault).toBe(false);
  });

  it("uses (and flags) the 34% standard when SAP has no discount for the MPG", () => {
    const panel = buildComparablesPanel(
      [part({ altronicPartNumber: "A", sapPartNumber: "a", mpg: "NONE" })],
      { NONE: null },
      subject,
    );
    expect(panel.rows[0].distributorDiscountPct).toBe(STANDARD_DISTRIBUTOR_DISCOUNT_PCT);
    expect(panel.rows[0].discountIsDefault).toBe(true);
  });

  it("leaves out the part being priced (by either number, case-insensitive), no list price and no cost", () => {
    const panel = buildComparablesPanel(
      [
        part({ altronicPartNumber: "791950-08", sapPartNumber: "x" }),
        part({ altronicPartNumber: "z", sapPartNumber: " 1000-0000-08 " }),
        part({ altronicPartNumber: "n1", sapPartNumber: "n1", listPrice: null }),
        part({ altronicPartNumber: "n2", sapPartNumber: "n2", listPrice: 0 }),
        part({ altronicPartNumber: "n3", sapPartNumber: "n3", cost: null }),
        part({ altronicPartNumber: "ok", sapPartNumber: "ok", listPrice: 100, cost: 33 }),
      ],
      { M1: 34 },
      { altronicPartNumber: "791950-08", sapPartNumber: "1000-0000-08" },
    );
    expect(panel.rows.map((r) => r.excluded)).toEqual([
      "the part being priced",
      "the part being priced",
      "no list price",
      "no list price",
      "no cost",
      null,
    ]);
    expect(panel.counted).toBe(1);
    expect(panel.excluded).toBe(5);
    expect(panel.averageGM).toBeCloseTo(50, 10);
  });

  it("never matches a BLANK subject number against a blank part number", () => {
    const panel = buildComparablesPanel(
      [part({ altronicPartNumber: "A", sapPartNumber: "" })],
      { M1: 34 },
      { altronicPartNumber: "NEW", sapPartNumber: "" },
    );
    expect(panel.rows[0].excluded).toBeNull();
  });

  it("averages SIMPLY — each counted part weighs the same, whatever its price", () => {
    const panel = buildComparablesPanel(
      [
        part({ altronicPartNumber: "A", sapPartNumber: "a", listPrice: 10, cost: 3.3 }), // 50%
        part({ altronicPartNumber: "B", sapPartNumber: "b", listPrice: 10_000, cost: 5_940 }), // 10%
      ],
      { M1: 34 },
      subject,
    );
    expect(panel.averageGM).toBeCloseTo(30, 6);
    expect(panel.counted).toBe(2);
  });

  it("has no average when nothing is counted", () => {
    const panel = buildComparablesPanel([], {}, subject);
    expect(panel).toEqual({ rows: [], averageGM: null, counted: 0, excluded: 0 });
  });

  it("summarizePanel keeps only the key, average and count", () => {
    const panel = buildComparablesPanel(
      [part({ altronicPartNumber: "A", sapPartNumber: "a", listPrice: 100, cost: 33 })],
      { M1: 34 },
      subject,
    );
    expect(summarizePanel("M1", panel)).toEqual({ key: "M1", averageGM: panel.averageGM, counted: 1 });
  });
});

describe("lineUnitCost", () => {
  it("is the adjustment when there is one, else the uploaded cost", () => {
    expect(lineUnitCost(line({ uploadedCost: 10, adjustedCost: 12 }))).toBe(12);
    expect(lineUnitCost(line({ uploadedCost: 10, adjustedCost: null }))).toBe(10);
    expect(lineUnitCost(line({ uploadedCost: null, adjustedCost: 0 }))).toBe(0);
    expect(lineUnitCost(line({ uploadedCost: null, adjustedCost: null }))).toBeNull();
  });
});

describe("subAssemblyCost", () => {
  it("sums quantity × cost at uploaded and at used (adjusted) cost", () => {
    const c = subAssemblyCost(
      sub({
        lines: [
          line({ partNumber: "A", quantity: 2, uploadedCost: 10, adjustedCost: 15 }),
          line({ partNumber: "B", quantity: 3, uploadedCost: 1 }),
        ],
      }),
    );
    expect(c).toEqual({ uploaded: 23, used: 33, problems: [] });
  });

  it("is null — naming the line — when a line has no quantity", () => {
    const c = subAssemblyCost(sub({ lines: [line({ partNumber: "A", quantity: 0 }), line({ partNumber: "B" })] }));
    expect(c.used).toBeNull();
    expect(c.problems).toEqual(["Board: A has no quantity."]);
  });

  it("is null — naming the line — when a line has no cost; uploaded unknown too", () => {
    const c = subAssemblyCost(sub({ lines: [line({ partNumber: "", uploadedCost: null })] }));
    expect(c.used).toBeNull();
    expect(c.uploaded).toBeNull();
    expect(c.problems).toEqual(["Board: line 1 has no cost."]);
  });

  it("an adjustment covers a missing uploaded cost for USED, not for uploaded", () => {
    const c = subAssemblyCost(sub({ lines: [line({ uploadedCost: null, adjustedCost: 5, quantity: 2 })] }));
    expect(c.used).toBe(10);
    expect(c.uploaded).toBeNull();
    expect(c.problems).toEqual([]);
  });

  it("asks for the CSV when there are no lines", () => {
    const c = subAssemblyCost(sub({ lines: [] }));
    expect(c).toEqual({ uploaded: null, used: null, problems: ["Board has no components — upload its CSV or add them by hand."] });
  });
});

describe("worksheetCost", () => {
  it("multiplies each sub-assembly by its quantity per product, then adds overhead", () => {
    const w = worksheetCost(
      [
        sub({ id: 1, quantityPerProduct: 2, lines: [line({ quantity: 1, uploadedCost: 10, adjustedCost: 20 })] }),
        sub({ id: 2, name: "Case", quantityPerProduct: 1, lines: [line({ quantity: 4, uploadedCost: 5 })] }),
      ],
      10,
    );
    expect(w.problems).toEqual([]);
    expect(w.material).toEqual({ uploaded: 40, used: 60 });
    expect(w.unit.used).toBeCloseTo(66, 10);
    expect(w.unit.uploaded).toBeCloseTo(44, 10);
  });

  it("treats a blank overhead as 0", () => {
    const w = worksheetCost([sub()], null);
    expect(w.unit).toEqual({ uploaded: 10, used: 10 });
  });

  it("collects every problem and leaves the used cost unknown", () => {
    const w = worksheetCost(
      [sub({ quantityPerProduct: 0 }), sub({ id: 2, name: "Case", lines: [line({ uploadedCost: null })] })],
      -5,
    );
    expect(w.problems).toEqual([
      "Board needs a quantity per product.",
      "Case: P1 has no cost.",
      "Overhead can't be negative.",
    ]);
    expect(w.material.used).toBeNull();
    expect(w.unit.used).toBeNull();
  });

  it("asks for a sub-assembly when there are none", () => {
    const w = worksheetCost([], 10);
    expect(w.problems).toEqual(["Add a sub-assembly, then upload its CSV or add its components by hand."]);
    expect(w.material).toEqual({ uploaded: null, used: null });
    expect(w.unit).toEqual({ uploaded: null, used: null });
  });
});

describe("subAssemblyTotals", () => {
  it("orders by sortOrder then id, with each one's costs and line count", () => {
    const totals = subAssemblyTotals([
      sub({ id: 3, name: "C", sortOrder: 1 }),
      sub({ id: 2, name: "B", sortOrder: 0, lines: [line({ quantity: 2, uploadedCost: 5, adjustedCost: 6 })] }),
      sub({ id: 1, name: "A", sortOrder: 1, quantityPerProduct: 3, lines: [] }),
    ]);
    expect(totals.map((t) => t.name)).toEqual(["B", "A", "C"]);
    expect(totals[0]).toEqual({ name: "B", quantityPerProduct: 1, lineCount: 1, uploadedCost: 10, cost: 12 });
    expect(totals[1]).toEqual({ name: "A", quantityPerProduct: 3, lineCount: 0, uploadedCost: null, cost: null });
  });
});

describe("priceBreaksProblem", () => {
  it("accepts none, or rising whole quantities with 0–<100 discounts", () => {
    expect(priceBreaksProblem([])).toBeNull();
    expect(
      priceBreaksProblem([
        { minQty: 10, discountPct: 5 },
        { minQty: 50, discountPct: 10 },
      ]),
    ).toBeNull();
  });

  it("refuses too many, quantities under 2 or not whole, falling quantities and bad discounts", () => {
    const four = [2, 3, 4, 5].map((minQty) => ({ minQty, discountPct: 1 }));
    expect(priceBreaksProblem(four)).toBe(`Up to ${MAX_PRICE_BREAKS} quantity breaks.`);
    expect(priceBreaksProblem([{ minQty: 1, discountPct: 5 }])).toMatch(/2 or more/);
    expect(priceBreaksProblem([{ minQty: 2.5, discountPct: 5 }])).toMatch(/2 or more/);
    expect(
      priceBreaksProblem([
        { minQty: 10, discountPct: 5 },
        { minQty: 10, discountPct: 6 },
      ]),
    ).toBe("Break quantities must go up.");
    expect(priceBreaksProblem([{ minQty: 10, discountPct: 0 }])).toMatch(/above 0%/);
    expect(priceBreaksProblem([{ minQty: 10, discountPct: 100 }])).toMatch(/below 100%/);
  });
});

describe("priceBreaks", () => {
  it("prices each break to the whole dollar, sorted, with its falling base GM", () => {
    const out = priceBreaks(253, 100, 34, [
      { minQty: 50, discountPct: 10 },
      { minQty: 10, discountPct: 5 },
    ]);
    expect(out.map((b) => b.minQty)).toEqual([10, 50]);
    expect(out.map((b) => b.price)).toEqual([240, 228]); // 240.35 → 240, 227.7 → 228
    expect(out[0].baseGM).toBeCloseTo(baseGrossMarginPct(240, 100, 34)!, 10);
    const base = baseGrossMarginPct(253, 100, 34)!;
    expect(out[0].baseGM!).toBeLessThan(base);
    expect(out[1].baseGM!).toBeLessThan(out[0].baseGM!);
  });

  it("is empty with no list price, and GM is null with no cost", () => {
    expect(priceBreaks(null, 100, 34, [{ minQty: 10, discountPct: 5 }])).toEqual([]);
    expect(priceBreaks(100, null, 34, [{ minQty: 10, discountPct: 5 }])[0].baseGM).toBeNull();
  });
});

describe("tierRanges", () => {
  it("names the range each tier covers, the base tier included", () => {
    expect(tierRanges([])).toEqual(["1+"]);
    expect(
      tierRanges([
        { minQty: 50, discountPct: 10 },
        { minQty: 10, discountPct: 5 },
      ]),
    ).toEqual(["1–9", "10–49", "50+"]);
  });

  it("names a one-quantity range with a single number", () => {
    expect(tierRanges([{ minQty: 2, discountPct: 5 }])).toEqual(["1", "2+"]);
  });
});

describe("customerPriceBreaks", () => {
  it("applies the customer's discount to list and to each whole-dollar break, to the cent", () => {
    const r = customerPriceBreaks(253, [{ minQty: 10, discountPct: 5 }], 12.5);
    expect(r.unitPrice).toBe(221.38); // 253 × 0.875 = 221.375
    expect(r.breaks).toEqual([{ minQty: 10, price: 210 }]); // 240 × 0.875
  });

  it("uses list prices when there is no (or no usable) discount", () => {
    expect(customerPriceBreaks(100, [{ minQty: 5, discountPct: 10 }], null)).toEqual({
      unitPrice: 100,
      breaks: [{ minQty: 5, price: 90 }],
    });
    expect(customerPriceBreaks(100, [], 150).unitPrice).toBe(100);
  });
});

describe("per-row overhead (Ray, 2026-10-13)", () => {
  it("adds each row's own overhead before its quantity per product; blank is none", () => {
    const cost = worksheetCost([
      sub({ name: "A", lines: [line({ uploadedCost: 100 })], quantityPerProduct: 2, overheadPct: 10 }),
      sub({ id: 2, name: "B", lines: [line({ uploadedCost: 50 })], overheadPct: null }),
    ]);
    expect(cost.material.used).toBe(250);
    // 100 × 1.1 × 2 + 50 = 270
    expect(cost.unit.used).toBeCloseTo(270);
    expect(cost.unit.uploaded).toBeCloseTo(270);
  });

  it("still applies a legacy worksheet-wide overhead on top", () => {
    const cost = worksheetCost([sub({ lines: [line({ uploadedCost: 100 })], overheadPct: 10 })], 20);
    expect(cost.unit.used).toBeCloseTo(132);
  });

  it("refuses a negative row overhead, naming the row", () => {
    const cost = worksheetCost([sub({ name: "A", overheadPct: -5 })]);
    expect(cost.unit.used).toBeNull();
    expect(cost.problems).toContain("A: overhead can't be negative.");
  });

  it("overheadFactor treats blank and 0 as no overhead", () => {
    expect(overheadFactor(null)).toBe(1);
    expect(overheadFactor(0)).toBe(1);
    expect(overheadFactor(25)).toBe(1.25);
  });
});
