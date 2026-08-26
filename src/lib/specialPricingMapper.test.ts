import { describe, it, expect } from "vitest";
import {
  buildSpecialPricingFields,
  compareSpecialPricingEntries,
  toSpecialPricingEntry,
} from "./specialPricingMapper";
import type { GraphListItem, SpecialPricingEntry } from "@/types/task";

function item(fields: Record<string, unknown>): GraphListItem {
  return { id: "1", fields } as unknown as GraphListItem;
}

describe("toSpecialPricingEntry", () => {
  it("reads the Customer lookup and pricing fields", () => {
    const entry = toSpecialPricingEntry(
      item({ Title: "1000-0327-00", CustomerLookupId: "1", AIPartNumber: "1000-0327-00" }),
    );
    expect(entry.customerId).toBe(1);
    expect(entry.title).toBe("1000-0327-00");
    expect(entry.aiPartNumber).toBe("1000-0327-00");
  });
});

describe("buildSpecialPricingFields", () => {
  it("only includes keys present on the partial input", () => {
    expect(buildSpecialPricingFields({ pricingNotes: "note" })).toEqual({
      PricingNotes: "note",
    });
  });
});

describe("compareSpecialPricingEntries", () => {
  it("sorts alphabetically by title", () => {
    const a: SpecialPricingEntry = { id: 1, title: "Zeta", customerId: 1, pricingNotes: "", aiPartNumber: "" };
    const b: SpecialPricingEntry = { ...a, id: 2, title: "Andy" };
    expect([a, b].sort(compareSpecialPricingEntries)).toEqual([b, a]);
  });
});
