import { describe, expect, it } from "vitest";
import type { GraphListItem } from "@/types/task";
import {
  buildNewProductFields,
  buildSubAssemblyFields,
  parseComparisonParts,
  parseRowPricing,
  toNewProductWorksheet,
  toSubAssembly,
} from "./pricingMapper";

// A row's own selling price (Pricing JSON on NP Sub-Assemblies) and the
// worksheet's SAP comparison list (ComparisonParts JSON) — Ray, 2026-10-14.

const item = (fields: Record<string, unknown>): GraphListItem => ({
  id: "7",
  createdDateTime: "2026-10-14T12:00:00Z",
  lastModifiedDateTime: "2026-10-14T12:00:00Z",
  fields,
});

describe("parseRowPricing", () => {
  it("is null for a blank column — the row isn't sold on its own", () => {
    expect(parseRowPricing("")).toEqual({ pricing: null, corrupt: false });
    expect(parseRowPricing(undefined)).toEqual({ pricing: null, corrupt: false });
  });

  it("reads a saved price, its discount override and its breaks", () => {
    const raw = JSON.stringify({ input: { kind: "list", value: 250 }, distributorDiscountPct: 30, priceBreaks: [{ minQty: 25, discountPct: 8 }] });
    expect(parseRowPricing(raw)).toEqual({
      pricing: { input: { kind: "list", value: 250 }, distributorDiscountPct: 30, priceBreaks: [{ minQty: 25, discountPct: 8 }] },
      corrupt: false,
    });
  });

  it("calls anything else CORRUPT, so the save refuses to write over it", () => {
    expect(parseRowPricing("{not json").corrupt).toBe(true);
    expect(parseRowPricing(JSON.stringify({ input: { kind: "margin", value: 1 } })).corrupt).toBe(true);
    expect(parseRowPricing(JSON.stringify({ input: { kind: "gm" } })).corrupt).toBe(true);
  });

  it("is read off the row", () => {
    const s = toSubAssembly(
      item({ Title: "Board", Pricing: JSON.stringify({ input: { kind: "gm", value: 45 }, distributorDiscountPct: null, priceBreaks: [] }) }),
    );
    expect(s.pricing).toEqual({ input: { kind: "gm", value: 45 }, distributorDiscountPct: null, priceBreaks: [] });
    expect(s.pricingCorrupt).toBe(false);
  });
});

describe("buildSubAssemblyFields — Pricing", () => {
  it("writes the price as JSON, and null as a blank column", () => {
    const pricing = { input: { kind: "gm" as const, value: 45 }, distributorDiscountPct: null, priceBreaks: [] };
    expect(JSON.parse(buildSubAssemblyFields({ pricing }).Pricing as string)).toEqual(pricing);
    expect(buildSubAssemblyFields({ pricing: null })).toEqual({ Pricing: "" });
    expect(buildSubAssemblyFields({ name: "x" })).not.toHaveProperty("Pricing");
  });
});

describe("ComparisonParts", () => {
  it("is read de-duplicated and tolerant — a reference list never refuses anything", () => {
    expect(parseComparisonParts(JSON.stringify(["A", " B ", "A", 3, ""]))).toEqual(["A", "B"]);
    expect(parseComparisonParts("junk")).toEqual([]);
    expect(toNewProductWorksheet(item({ ComparisonParts: JSON.stringify(["1003-0114-16"]) })).comparisonParts).toEqual(["1003-0114-16"]);
  });

  it("is written as JSON", () => {
    expect(buildNewProductFields({ comparisonParts: ["A", "B"] })).toEqual({ ComparisonParts: JSON.stringify(["A", "B"]) });
  });
});
