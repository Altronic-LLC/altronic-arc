import { describe, expect, it } from "vitest";
import { GM_LADDER_STEPS, calculate, gmLadder, resultsText } from "./priceCalculator";

describe("calculate", () => {
  it("prices from a target GM: cost ÷ (1 − GM), to the cent", () => {
    expect(calculate({ cogs: 12, mode: "gm", gm: 40, price: null })).toEqual({ price: 20, gm: 40, profit: 8, problem: null });
    const odd = calculate({ cogs: 10, mode: "gm", gm: 33, price: null });
    expect(odd.price).toBe(14.93);
    // The GM is what the ROUNDED price earns.
    expect(odd.gm).toBeCloseTo(33.02, 2);
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

describe("gmLadder", () => {
  it("steps the GM 10 points down and 20 up, in 5s, with the result in the middle", () => {
    const result = calculate({ cogs: 12, mode: "gm", gm: 40, price: null });
    const rows = gmLadder(12, 40, result);
    expect(rows.map((r) => r.step)).toEqual([...GM_LADDER_STEPS]);
    expect(rows.map((r) => r.price)).toEqual([17.14, 18.46, 20, 21.82, 24, 26.67, 30]);
    expect(rows.filter((r) => r.current).map((r) => r.price)).toEqual([20]);
  });

  it("centres on a typed price's GM and keeps that row exactly the price typed", () => {
    const result = calculate({ cogs: 15, mode: "price", gm: null, price: 24.99 });
    const rows = gmLadder(15, result.gm!, result);
    const current = rows.find((r) => r.current)!;
    expect(current.price).toBe(24.99);
    expect(rows[0].gm).toBeCloseTo(current.gm - 10, 0);
  });

  it("leaves out steps at or below 0% and at or above 100%", () => {
    const low = calculate({ cogs: 10, mode: "gm", gm: 5, price: null });
    expect(gmLadder(10, 5, low).map((r) => r.step)).toEqual([0, 5, 10, 15, 20]);
    const high = calculate({ cogs: 10, mode: "gm", gm: 90, price: null });
    expect(gmLadder(10, 90, high).map((r) => r.step)).toEqual([-10, -5, 0, 5]);
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
