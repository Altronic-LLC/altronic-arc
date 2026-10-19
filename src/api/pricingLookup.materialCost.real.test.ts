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
  Material: "9100-0002-00",
  MaterialDescription: "CAPACITOR, DEMO",
  UnitCost: cost,
});

describe("lookupSapMaterialCosts (real mode)", () => {
  it("asks ONE equality on Material for four columns — kept narrow for speed", async () => {
    fabricQuery.mockResolvedValue({ vw_cogs_material_apis: { items: [row("4230", 0.07), row("4222", 0.0611)] } });

    const out = await lookupSapMaterialCosts("9100000200");

    const [query, variables] = fabricQuery.mock.calls[0];
    expect(query).toContain("vw_cogs_material_apis(");
    expect(query).toContain("filter: { Material: { eq: $sap } }");
    expect(query).not.toContain("OldMaterialNumber");
    expect(query).not.toContain("or:");
    expect(query).toContain("items { Plant Material MaterialDescription UnitCost }");
    expect(variables).toEqual({ sap: "9100-0002-00" });
    expect(out.map((r) => [r.plant, r.unitCost, r.description])).toEqual([
      ["4222", 0.0611, "CAPACITOR, DEMO"],
      ["4230", 0.07, "CAPACITOR, DEMO"],
    ]);
  });

  it("never asks Fabric about a half-typed or non-SAP number", async () => {
    expect(await lookupSapMaterialCosts("1000-4869-0")).toEqual([]);
    expect(await lookupSapMaterialCosts("910002")).toEqual([]);
    expect(fabricQuery).not.toHaveBeenCalled();
  });

  it("is empty when SAP has nothing", async () => {
    fabricQuery.mockResolvedValue({ vw_cogs_material_apis: { items: null } });
    expect(await lookupSapMaterialCosts("9999000000")).toEqual([]);
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
