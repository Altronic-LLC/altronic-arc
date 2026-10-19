import { beforeEach, describe, expect, it, vi } from "vitest";

// The part lookup in REAL mode (Ray, 2026-10-17) — read from the Fabric cost
// view: an SAP number against Material, an Altronic (old) number against
// OldMaterialNumber, each ONE equality. Invisible from mock mode.

const fabricQuery = vi.hoisted(() => vi.fn());

vi.mock("./fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fabric")>();
  return { ...actual, fabricQuery };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, FABRIC_ENABLED: true };
});

import { lookupSapPart, SAP_PART_LOOKUP_CONNECTED, SAP_PART_LOOKUP_LIVE } from "./pricingLookup";

// A BLOCK body — a returned mock would run as the test's cleanup.
beforeEach(() => {
  fabricQuery.mockReset();
});

const rows = (...items: Record<string, unknown>[]) => ({ vw_cogs_material_apis: { items } });
const HARNESS = {
  Material: "9100-0007-15",
  OldMaterialNumber: "910007-15",
  MaterialDescription: "HARNESS, DEMO, 15 FT",
  MaterialPriceGroup: "HRN",
};

describe("lookupSapPart (real mode)", () => {
  it("is live", () => {
    expect(SAP_PART_LOOKUP_LIVE).toBe(true);
    expect(SAP_PART_LOOKUP_CONNECTED).toBe(true);
  });

  it("looks an SAP number up against Material — dashed — and fills the Altronic number in", async () => {
    fabricQuery.mockResolvedValue(rows({ ...HARNESS, Plant: "4230", UnitCost: 126.5 }, { ...HARNESS, Plant: "4222", UnitCost: 120 }));
    const part = await lookupSapPart({ sapPartNumber: "9100000715" });

    const [query, variables] = fabricQuery.mock.calls[0];
    expect(query).toContain("filter: { Material: { eq: $v } }");
    expect(query).toContain("items { Plant Material OldMaterialNumber MaterialDescription MaterialPriceGroup UnitCost }");
    expect(variables).toEqual({ v: "9100-0007-15" });
    // The first plant by number gives the cost; the view has no list price.
    expect(part).toEqual({
      sapPartNumber: "9100-0007-15",
      altronicPartNumber: "910007-15",
      description: "HARNESS, DEMO, 15 FT",
      mpg: "HRN",
      listPrice: null,
      cost: 120,
    });
  });

  it("looks an Altronic number up against OldMaterialNumber, upper-cased, and fills the SAP number in", async () => {
    fabricQuery.mockResolvedValue(rows({ ...HARNESS, OldMaterialNumber: "9100X-DEMO-06A", Plant: "4222", UnitCost: 38.20 }));
    const part = await lookupSapPart({ altronicPartNumber: " 9100x-demo-06a " });
    expect(fabricQuery.mock.calls[0][0]).toContain("filter: { OldMaterialNumber: { eq: $v } }");
    expect(fabricQuery.mock.calls[0][1]).toEqual({ v: "9100X-DEMO-06A" });
    expect(part?.sapPartNumber).toBe("9100-0007-15");
  });

  it("falls back to the Altronic number when SAP doesn't hold the SAP number typed", async () => {
    fabricQuery.mockResolvedValueOnce(rows()).mockResolvedValueOnce(rows({ ...HARNESS, Plant: "4222", UnitCost: 120 }));
    const part = await lookupSapPart({ sapPartNumber: "9999-0000-00", altronicPartNumber: "910007-15" });
    expect(fabricQuery).toHaveBeenCalledTimes(2);
    expect(fabricQuery.mock.calls[1][0]).toContain("OldMaterialNumber: { eq: $v }");
    expect(part?.sapPartNumber).toBe("9100-0007-15");
  });

  it("is null when SAP holds neither, and asks nothing for blank boxes", async () => {
    fabricQuery.mockResolvedValue(rows());
    expect(await lookupSapPart({ sapPartNumber: "9999000000" })).toBeNull();
    fabricQuery.mockClear();
    expect(await lookupSapPart({ sapPartNumber: " ", altronicPartNumber: "" })).toBeNull();
    expect(fabricQuery).not.toHaveBeenCalled();
  });
});
