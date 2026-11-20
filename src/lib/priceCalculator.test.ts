import { describe, expect, it } from "vitest";
import { calculate, gmLadder, resultsText } from "./priceCalculator";

describe("calculate", () => {
  it("prices from a target GM: cost ÷ (1 − GM), to the cent", () => {
    expect(calculate({ cogs: 12, mode: "gm", gm: 40, price: null })).toEqual({ price: 20, gm: 40, profit: 8, problem: null });
    const odd = calculate({ cogs: 10, mode: "gm", gm: 33, price: null });
    expect(odd.price).toBe(14.93);
    // The GM is what the ROUNDED price earns.
    expect(odd.gm).toBeCloseTo(33.02, 2);
  });

  it("rounds UP to the cent, so a cheap part never earns less than the GM asked for", () => {
    // A cheap demo part: $0.2493 at 60% is $0.62325. To the nearest cent that was
    // $0.62 — only 59.8%. Rounded up it is $0.63, 60.4%.
    const r = calculate({ cogs: 0.2493, mode: "gm", gm: 60, price: null });
    expect(r.price).toBe(0.63);
    expect(r.gm).toBeGreaterThanOrEqual(60);
    expect(r.gm).toBeCloseTo(60.4, 1);
  });

  it("doesn't bump an exact price up a cent for float noise", () => {
    // $2.10 at 30% is exactly $3.00, but in floats 300.00000000000006 cents —
    // a bare Math.ceil reads that as $3.01. Likewise $0.07 → $0.10, not $0.11.
    expect(calculate({ cogs: 2.1, mode: "gm", gm: 30, price: null }).price).toBe(3);
    expect(calculate({ cogs: 0.07, mode: "gm", gm: 30, price: null }).price).toBe(0.1);
  });

  it("works the GM out of a price typed by hand", () => {
    const r = calculate({ cogs: 15, mode: "price", gm: null, price: 25 });
    expect(r.price).toBe(25);
    expect(r.gm).toBeCloseTo(40);
    expect(r.profit).toBe(10);
  });

  it("allows a price below cost — a negative GM is an answer, not an error", () => {
    expect(calculate({ cogs: 30, mode: "price", gm: null, price: 25 }).gm).toBeCloseTo(-20);
  });

  it("says what's missing or wrong rather than pricing at 0", () => {
    expect(calculate({ cogs: null, mode: "gm", gm: 40, price: null }).problem).toBe("Enter the cost (COGS).");
    expect(calculate({ cogs: -1, mode: "gm", gm: 40, price: null }).problem).toBe("The cost can't be negative.");
    expect(calculate({ cogs: 0, mode: "gm", gm: 40, price: null }).problem).toMatch(/above \$0/);
    expect(calculate({ cogs: 12, mode: "gm", gm: null, price: null }).problem).toBe("Enter the GM you want.");
    expect(calculate({ cogs: 12, mode: "gm", gm: 100, price: null }).problem).toMatch(/below 100%/);
    expect(calculate({ cogs: 12, mode: "price", gm: null, price: 0 }).problem).toBe("Enter a price above $0.");
  });
});

describe("gmLadder — round GM steps", () => {
  it("steps in round 5s, 10 points below to 20 above, with the result as its row", () => {
    const result = calculate({ cogs: 12, mode: "gm", gm: 40, price: null });
    const rows = gmLadder(12, 40, result);
    expect(rows.map((r) => Math.round(r.gm))).toEqual([30, 35, 40, 45, 50, 55, 60]);
    expect(rows.map((r) => r.price)).toEqual([17.15, 18.47, 20, 21.82, 24, 26.67, 30]);
    expect(rows.filter((r) => r.current).map((r) => r.price)).toEqual([20]);
  });

  it("rounds an odd GM to the nearest 5 and slots the result in between", () => {
    const result = calculate({ cogs: 12, mode: "gm", gm: 37, price: null });
    const rows = gmLadder(12, 37, result);
    expect(rows.filter((r) => !r.current).map((r) => r.gm)).toEqual([25, 30, 35, 40, 45, 50, 55]);
    const at = rows.findIndex((r) => r.current);
    expect(rows[at - 1].gm).toBe(35);
    expect(rows[at + 1].gm).toBe(40);
    expect(rows[at].price).toBe(result.price);
  });

  it("keeps a typed price exactly as typed, matching a round row when its GM is one", () => {
    const round = calculate({ cogs: 15, mode: "price", gm: null, price: 25 }); // 40.0%
    const rows = gmLadder(15, round.gm!, round);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.current)!.price).toBe(25);

    const odd = calculate({ cogs: 15, mode: "price", gm: null, price: 24.99 }); // 39.98%
    const oddRows = gmLadder(15, odd.gm!, odd);
    expect(oddRows.find((r) => r.current)!.price).toBe(24.99);
    expect(oddRows.filter((r) => !r.current).every((r) => r.gm % 5 === 0)).toBe(true);
  });

  it("leaves out steps at or below 0% and at or above 100%", () => {
    const low = calculate({ cogs: 10, mode: "gm", gm: 5, price: null });
    expect(gmLadder(10, 5, low).map((r) => Math.round(r.gm))).toEqual([5, 10, 15, 20, 25]);
    const high = calculate({ cogs: 10, mode: "gm", gm: 90, price: null });
    expect(gmLadder(10, 90, high).map((r) => Math.round(r.gm))).toEqual([80, 85, 90, 95]);
  });

  it("is empty when there's no price, or no cost to price from", () => {
    expect(gmLadder(12, 40, { price: null, gm: null, profit: null, problem: "x" })).toEqual([]);
    expect(gmLadder(0, 40, { price: 5, gm: 100, profit: 5, problem: null })).toEqual([]);
  });
});

describe("resultsText", () => {
  it("is plain text with tab-separated columns, marking the result's row", () => {
    const result = calculate({ cogs: 12, mode: "gm", gm: 40, price: null });
    const text = resultsText({ description: "  Spare coil  ", cogs: 12, mode: "gm", result, ladder: gmLadder(12, 40, result) });
    const lines = text.split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "Price calculator — Spare coil",
      "COGS: $12.00",
      "Target GM: 40.0%",
      "Customer price: $20.00 (GM 40.0%, profit $8.00)",
    ]);
    expect(lines).toContain("GM\tCustomer price\tProfit");
    expect(lines).toContain("40.0% (this price)\t$20.00\t$8.00");
    expect(lines).toContain("60.0%\t$30.00\t$18.00");
  });

  it("names a typed price as the input, and drops the dash with no description", () => {
    const result = calculate({ cogs: 15, mode: "price", gm: null, price: 25 });
    const text = resultsText({ description: "", cogs: 15, mode: "price", result, ladder: [] });
    expect(text.split("\n")[0]).toBe("Price calculator");
    expect(text).toContain("Price entered: $25.00");
    expect(text).not.toContain("\t");
  });
});
