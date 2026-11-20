import { describe, expect, it } from "vitest";
import { formatMoney, formatPct, formatUnitCost } from "./quoteMoney";

describe("formatMoney — derived values, exactly 2 decimals", () => {
  it("never shows more than 2 decimals", () => {
    expect(formatMoney(18.795)).toBe("$18.80");
    expect(formatMoney(28.9154)).toBe("$28.92");
    expect(formatMoney(57.195)).toBe("$57.20");
    // A SUM that floats just under the half cent still reads as the decimal.
    expect(formatMoney(38.4 + 6.265 * 3)).toBe("$57.20");
  });

  it("always shows 2 decimals", () => {
    expect(formatMoney(1245.6)).toBe("$1,245.60");
    expect(formatMoney(40)).toBe("$40.00");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("is a dash when unknown", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(NaN)).toBe("—");
  });
});

describe("formatUnitCost — a typed cost keeps real sub-cent precision", () => {
  it("shows up to 4 decimals only when entered", () => {
    expect(formatUnitCost(0.0123)).toBe("$0.0123");
    expect(formatUnitCost(1.255)).toBe("$1.255");
    expect(formatUnitCost(0.1)).toBe("$0.10");
    expect(formatUnitCost(32)).toBe("$32.00");
    expect(formatUnitCost(412.35)).toBe("$412.35");
  });

  it("stops at 4", () => {
    expect(formatUnitCost(0.012345)).toBe("$0.0123");
  });

  it("is a dash when unknown", () => {
    expect(formatUnitCost(null)).toBe("—");
  });
});

describe("formatPct", () => {
  it("one decimal", () => {
    expect(formatPct(38.456)).toBe("38.5%");
    expect(formatPct(null)).toBe("—");
  });
});
