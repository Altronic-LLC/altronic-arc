import { describe, expect, it } from "vitest";
import { comparePricingNumbers, nextPricingNumber, parsePricingNumber } from "./pricingNumber";

describe("parsePricingNumber", () => {
  it("reads a well-formed number, case-insensitively, trimmed", () => {
    expect(parsePricingNumber("PR-2026-0042")).toEqual({ prefix: "PR", year: 2026, seq: 42 });
    expect(parsePricingNumber(" np-2025-12345 ")).toEqual({ prefix: "NP", year: 2025, seq: 12345 });
  });

  it("refuses anything else", () => {
    expect(parsePricingNumber("PR-2026-42")).toBeNull();
    expect(parsePricingNumber("SQ-2026-0001")).toBeNull();
    expect(parsePricingNumber("PR-2026-0042-R1")).toBeNull();
    expect(parsePricingNumber("")).toBeNull();
  });
});

describe("nextPricingNumber", () => {
  it("starts at 0001", () => {
    expect(nextPricingNumber("PR", 2026, [])).toBe("PR-2026-0001");
  });

  it("is the HIGHEST that year + 1, never the count + 1", () => {
    // Two titles, but 0007 is taken — count + 1 would hand out 0003.
    expect(nextPricingNumber("PR", 2026, ["PR-2026-0002", "PR-2026-0007"])).toBe("PR-2026-0008");
  });

  it("restarts each year", () => {
    expect(nextPricingNumber("PR", 2027, ["PR-2026-0099"])).toBe("PR-2027-0001");
  });

  it("keeps the two prefixes apart, and ignores junk titles", () => {
    expect(nextPricingNumber("NP", 2026, ["PR-2026-0050", "NP-2026-0003", "junk", ""])).toBe("NP-2026-0004");
    expect(nextPricingNumber("PR", 2026, ["np-2026-0050"])).toBe("PR-2026-0001");
  });

  it("grows past four digits", () => {
    expect(nextPricingNumber("PR", 2026, ["PR-2026-9999"])).toBe("PR-2026-10000");
  });
});

describe("comparePricingNumbers", () => {
  it("sorts newest first by year then sequence, unparseable last", () => {
    const sorted = ["PR-2025-0009", "junk-a", "PR-2026-0002", "junk-b", "PR-2026-0010"].sort(comparePricingNumbers);
    expect(sorted).toEqual(["PR-2026-0010", "PR-2026-0002", "PR-2025-0009", "junk-b", "junk-a"]);
  });

  it("compares numerically, not as text", () => {
    expect(comparePricingNumbers("PR-2026-0100", "PR-2026-10000")).toBeGreaterThan(0);
  });
});
