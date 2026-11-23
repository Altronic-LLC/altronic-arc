import { beforeEach, describe, expect, it, vi } from "vitest";

// The discount and comparables lookups in REAL mode (Ray, 2026-11-23) — ARC's
// tables in Altronic_Business_IT (scripts/arc-pricing-tables.sql) through the
// Fabric GraphQL API. Request shapes were checked live; every value here is
// invented — the repo is public. None of this is visible from mock mode.

const fabricQuery = vi.hoisted(() => vi.fn());

vi.mock("./fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fabric")>();
  return { ...actual, fabricQuery };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, FABRIC_ENABLED: true };
});

import {
  DISTRIBUTOR_PRICE_GROUP,
  listFamilyParts,
  listMpgParts,
  SAP_DATA_CONNECTED,
  sapCustomerGroupDiscounts,
  sapMpgDistributorDiscounts,
} from "./pricingLookup";

// A BLOCK body — a returned mock would run as the test's cleanup.
beforeEach(() => {
  fabricQuery.mockReset();
});

describe("SAP data in real mode", () => {
  it("counts as connected, so no screen opens on typed entry", () => {
    expect(SAP_DATA_CONNECTED).toBe(true);
  });
});

describe("sapMpgDistributorDiscounts (real mode)", () => {
  it("reads the A0 price group's discount for every MPG in ONE request, through variables", async () => {
    fabricQuery.mockResolvedValue({
      tbl_arc_price_group_discounts: {
        items: [
          { MaterialPriceGroup: "QX", DiscountPct: 34 },
          { MaterialPriceGroup: "QY", DiscountPct: 20 },
        ],
      },
    });
    const out = await sapMpgDistributorDiscounts(["QX", "QY", "QZ"]);

    expect(fabricQuery).toHaveBeenCalledTimes(1);
    const [query, vars] = fabricQuery.mock.calls[0];
    expect(query).toContain("PriceGroup: { eq: $g }, MaterialPriceGroup: { in: $mpgs }");
    expect(vars).toEqual({ g: DISTRIBUTOR_PRICE_GROUP, mpgs: ["QX", "QY", "QZ"] });
    expect(DISTRIBUTOR_PRICE_GROUP).toBe("A0");
    // An MPG SAP has no A0 discount for is null — the 34% default applies downstream.
    expect(out).toEqual({ QX: 34, QY: 20, QZ: null });
  });

  it("asks nothing for no MPGs", async () => {
    expect(await sapMpgDistributorDiscounts(["", " "])).toEqual({ "": null, " ": null });
    expect(fabricQuery).not.toHaveBeenCalled();
  });
});

describe("sapCustomerGroupDiscounts (real mode)", () => {
  it("asks for the material AND the MPG discount of the customer's price group in one request", async () => {
    fabricQuery.mockResolvedValue({ m: { items: [{ DiscountPct: 27 }] }, p: { items: [{ DiscountPct: 34 }] } });
    const out = await sapCustomerGroupDiscounts({ customerGroup: "Q4", sapPartNumber: "9000-0001-00", mpg: "QX" });

    const [query, vars] = fabricQuery.mock.calls[0];
    expect(query).toContain("tbl_arc_price_group_material_discounts(first: 5, filter: { PriceGroup: { eq: $g }, Material: { eq: $sap } })");
    expect(query).toContain("tbl_arc_price_group_discounts(first: 5, filter: { PriceGroup: { eq: $g }, MaterialPriceGroup: { eq: $mpg } })");
    expect(vars).toEqual({ g: "Q4", sap: "9000-0001-00", mpg: "QX" });
    expect(out).toEqual({ materialPct: 27, mpgPct: 34 });
  });

  it("reads none as null, and leaves out a half it has nothing to ask with", async () => {
    fabricQuery.mockResolvedValue({ p: { items: [] } });
    const out = await sapCustomerGroupDiscounts({ customerGroup: "Q4", sapPartNumber: "", mpg: "QX" });
    expect(fabricQuery.mock.calls[0][0]).not.toContain("Material: { eq");
    expect(out).toEqual({ materialPct: null, mpgPct: null });
  });

  it("asks nothing with no customer group — the 34% default applies", async () => {
    expect(await sapCustomerGroupDiscounts({ customerGroup: " ", sapPartNumber: "9000-0001-00", mpg: "QX" })).toEqual({
      materialPct: null,
      mpgPct: null,
    });
    expect(fabricQuery).not.toHaveBeenCalled();
  });
});

describe("listMpgParts / listFamilyParts (real mode)", () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    Plant: "4222",
    Material: `9000-000${n}-00`,
    OldMaterialNumber: `70000${n}-1`,
    MaterialDescription: `DEMO PART ${n}`,
    MaterialPriceGroup: "QX",
    UnitCost: 10 * n,
    ListPrice: 30 * n,
    ...extra,
  });

  it("pages through ARC's materials table by MPG and maps each row, list price included", async () => {
    fabricQuery
      .mockResolvedValueOnce({ tbl_arc_material_list_prices: { items: [row(1)], endCursor: "c1", hasNextPage: true } })
      .mockResolvedValueOnce({ tbl_arc_material_list_prices: { items: [row(2, { ListPrice: null, UnitCost: 0 })], endCursor: null, hasNextPage: false } });
    const parts = await listMpgParts("QX");

    expect(fabricQuery).toHaveBeenCalledTimes(2);
    expect(fabricQuery.mock.calls[0][0]).toContain("filter: { MaterialPriceGroup: { eq: $v } }");
    expect(fabricQuery.mock.calls[0][1]).toEqual({ v: "QX", after: null });
    expect(fabricQuery.mock.calls[1][1]).toEqual({ v: "QX", after: "c1" });
    expect(parts).toEqual([
      { sapPartNumber: "9000-0001-00", altronicPartNumber: "700001-1", description: "DEMO PART 1", mpg: "QX", listPrice: 30, cost: 10 },
      // 0 and blank are "none" — the comparables panel says why it's left out.
      { sapPartNumber: "9000-0002-00", altronicPartNumber: "700002-1", description: "DEMO PART 2", mpg: "QX", listPrice: null, cost: null },
    ]);
  });

  it("reads a family by FamilyPrefix", async () => {
    fabricQuery.mockResolvedValue({ tbl_arc_material_list_prices: { items: [row(3)], hasNextPage: false } });
    await listFamilyParts("700003");
    expect(fabricQuery.mock.calls[0][0]).toContain("filter: { FamilyPrefix: { eq: $v } }");
    expect(fabricQuery.mock.calls[0][1]).toEqual({ v: "700003", after: null });
  });

  it("REFUSES a list that never ends rather than averaging part of it", async () => {
    fabricQuery.mockResolvedValue({ tbl_arc_material_list_prices: { items: [row(1)], endCursor: "again", hasNextPage: true } });
    await expect(listMpgParts("QX")).rejects.toThrow(/partial list/);
  });

  it("asks nothing for a blank key", async () => {
    expect(await listMpgParts(" ")).toEqual([]);
    expect(await listFamilyParts("")).toEqual([]);
    expect(fabricQuery).not.toHaveBeenCalled();
  });
});
