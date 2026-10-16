import { describe, expect, it } from "vitest";
import { resolveCustomerDiscount, STANDARD_DISTRIBUTOR_DISCOUNT_PCT } from "./pricingMath";

// How SAP prices a customer (Ray, 2026-10-15): their customer group's discount
// on the MATERIAL, else on its material price group, else the standard 34% —
// and 34% with no customer at all.

describe("resolveCustomerDiscount", () => {
  it("takes the group's discount on the material over its MPG discount", () => {
    expect(resolveCustomerDiscount({ customerGroup: "OE", materialDiscountPct: 25, mpgDiscountPct: 15 })).toEqual({
      pct: 25,
      source: "Material",
    });
  });

  it("falls back to the group's MPG discount when there's none on the material", () => {
    expect(resolveCustomerDiscount({ customerGroup: "OE", materialDiscountPct: null, mpgDiscountPct: 15 })).toEqual({
      pct: 15,
      source: "MPG",
    });
  });

  it("keeps a real 0% discount — it is a discount SAP holds, not a missing one", () => {
    expect(resolveCustomerDiscount({ customerGroup: "IC", materialDiscountPct: 0, mpgDiscountPct: 40 })).toEqual({
      pct: 0,
      source: "Material",
    });
  });

  it("uses the standard 34% when SAP has neither for the group", () => {
    expect(resolveCustomerDiscount({ customerGroup: "IC", materialDiscountPct: null, mpgDiscountPct: null })).toEqual({
      pct: STANDARD_DISTRIBUTOR_DISCOUNT_PCT,
      source: "Default",
    });
  });

  it("uses the standard 34% with no customer, whatever discounts are passed", () => {
    expect(STANDARD_DISTRIBUTOR_DISCOUNT_PCT).toBe(34);
    expect(resolveCustomerDiscount({ customerGroup: "  ", materialDiscountPct: 25, mpgDiscountPct: 15 })).toEqual({
      pct: 34,
      source: "Default",
    });
  });
});
