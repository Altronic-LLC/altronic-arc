import { beforeEach, describe, expect, it, vi } from "vitest";

// The Calculator's SAP cost lookup in REAL mode — the GraphQL it sends to
// Fabric, and how a refusal reads. Invisible from mock mode, which never
// builds a query at all.

const fabricQuery = vi.hoisted(() => vi.fn());

vi.mock("./fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fabric")>();
  return { ...actual, fabricQuery };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, FABRIC_ENABLED: true };
});

import { FabricAuthError, FabricRequestError } from "./fabric";
import { describeSapCostFailure, isRetryableSapCostFailure, lookupSapMaterialCosts } from "./pricingLookup";

// A BLOCK body — a returned mock would run as the test's cleanup.
beforeEach(() => {
  fabricQuery.mockReset();
});

const row = (plant: string, cost: number) => ({
  Plant: plant,
  Material: "1000-4869-00",
  OldMaterialNumber: "711078",
  MaterialDescription: "CAPACITOR, 1NF",
  UnitCost: cost,
  MaterialPriceGroup: "GA",
  PriceControl: "V",
  BaseUnitOfMeasure: "PC",
});

describe("lookupSapMaterialCosts (real mode)", () => {
  it("asks the view by SAP number OR old number, through variables, and maps each plant", async () => {
    fabricQuery.mockResolvedValue({ vw_cogs_material_apis: { items: [row("4230", 0.07), row("4222", 0.0655)] } });

    const out = await lookupSapMaterialCosts("1000486900");

    const [query, variables] = fabricQuery.mock.calls[0];
    expect(query).toContain("vw_cogs_material_apis(");
    expect(query).toContain("filter: { or: [{ Material: { eq: $sap } }, { OldMaterialNumber: { eq: $old0 } }] }");
    expect(query).toContain("$sap: String!, $old0: String!");
    expect(query).toContain("items { Plant Material OldMaterialNumber MaterialDescription UnitCost");
    expect(variables).toEqual({ sap: "1000-4869-00", old0: "1000486900" });
    expect(out.map((r) => [r.plant, r.unitCost])).toEqual([
      ["4222", 0.0655],
      ["4230", 0.07],
    ]);
  });

  it("asks an Altronic number against the old number only, as typed and upper-cased", async () => {
    fabricQuery.mockResolvedValue({ vw_cogs_material_apis: { items: [] } });
    await lookupSapMaterialCosts("3549s-1ag-502a");
    const [query, variables] = fabricQuery.mock.calls[0];
    expect(query).not.toContain("Material: { eq");
    expect(variables).toEqual({ old0: "3549s-1ag-502a", old1: "3549S-1AG-502A" });
  });

  it("never puts the typed text into the query itself", async () => {
    fabricQuery.mockResolvedValue({ vw_cogs_material_apis: { items: [] } });
    await lookupSapMaterialCosts('71"} ) { x');
    expect(fabricQuery.mock.calls[0][0]).not.toContain('71"}');
  });

  it("is empty when SAP has nothing, and asks nothing for a blank box", async () => {
    fabricQuery.mockResolvedValue({ vw_cogs_material_apis: { items: null } });
    expect(await lookupSapMaterialCosts("711078")).toEqual([]);
    fabricQuery.mockClear();
    expect(await lookupSapMaterialCosts("  ")).toEqual([]);
    expect(fabricQuery).not.toHaveBeenCalled();
  });
});

describe("describeSapCostFailure / isRetryableSapCostFailure", () => {
  it("names a missing Fabric grant on the sign-in, and doesn't retry it", () => {
    const err = new FabricAuthError("silent failed", "needs-consent");
    expect(describeSapCostFailure(err)).toMatch(/hasn't been given Fabric access/);
    expect(isRetryableSapCostFailure(err)).toBe(false);
  });

  it("names a refused query (no read permission on the API) as access, and doesn't retry it", () => {
    const err = new FabricRequestError("no", "http", { status: 403 });
    expect(describeSapCostFailure(err)).toBe("Your account can't read SAP costs — type the cost, or ask an admin for access.");
    expect(isRetryableSapCostFailure(err)).toBe(false);
  });

  it("retries only a network blip or a server error, and says SAP couldn't be reached", () => {
    expect(isRetryableSapCostFailure(new FabricRequestError("x", "transport"))).toBe(true);
    expect(isRetryableSapCostFailure(new FabricRequestError("x", "http", { status: 503 }))).toBe(true);
    expect(isRetryableSapCostFailure(new FabricRequestError("x", "graphql"))).toBe(false);
    expect(describeSapCostFailure(new FabricRequestError("x", "transport"))).toBe(
      "Couldn't reach SAP just now — type the cost, or try again.",
    );
  });
});
