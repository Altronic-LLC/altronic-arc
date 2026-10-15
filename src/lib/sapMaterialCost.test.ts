import { describe, expect, it } from "vitest";
import { SAP_MATERIAL_COST_FIELDS, sapMaterialLookupKey, sapMaterialPlants, toSapMaterialCost } from "./sapMaterialCost";

// The Calculator's SAP cost lookup — the pure half. Rows are shaped like the
// live view's (rpt.vw_cogs_material_api, read 2026-10-15).

const live = {
  Plant: "4222",
  Material: "1000-4869-00",
  MaterialDescription: "CAPACITOR, 1NF, 2000V, CERAMIC, 10%, 120",
  UnitCost: 0.0655,
};

describe("SAP_MATERIAL_COST_FIELDS", () => {
  it("asks for only what the Calculator shows — kept narrow for speed", () => {
    expect([...SAP_MATERIAL_COST_FIELDS]).toEqual(["Plant", "Material", "MaterialDescription", "UnitCost"]);
  });
});

describe("toSapMaterialCost", () => {
  it("maps a live row, taking UnitCost as the cost of one", () => {
    expect(toSapMaterialCost(live)).toEqual({
      plant: "4222",
      sapPartNumber: "1000-4869-00",
      description: "CAPACITOR, 1NF, 2000V, CERAMIC, 10%, 120",
      unitCost: 0.0655,
    });
  });

  it("copes with nulls", () => {
    expect(toSapMaterialCost({ ...live, MaterialDescription: null, Plant: null })).toMatchObject({ plant: "", description: "" });
  });

  it("reads a missing, zero or unreadable cost as NO cost — never prices from 0", () => {
    expect(toSapMaterialCost({ ...live, UnitCost: null }).unitCost).toBeNull();
    expect(toSapMaterialCost({ ...live, UnitCost: 0 }).unitCost).toBeNull();
    expect(toSapMaterialCost({ ...live, UnitCost: "abc" }).unitCost).toBeNull();
    // A decimal that arrives as a string still reads.
    expect(toSapMaterialCost({ ...live, UnitCost: "35.15" }).unitCost).toBe(35.15);
  });
});

describe("sapMaterialLookupKey", () => {
  it("is the dashed SAP number for 10 digits, dashed or not", () => {
    expect(sapMaterialLookupKey("1000486900")).toBe("1000-4869-00");
    expect(sapMaterialLookupKey(" 1000-4869-00 ")).toBe("1000-4869-00");
  });

  it("is null until a whole SAP number is typed — a half-typed one never reaches Fabric", () => {
    expect(sapMaterialLookupKey("1000-4869-0")).toBeNull();
    expect(sapMaterialLookupKey("711078")).toBeNull();
    expect(sapMaterialLookupKey("3549S-1AG-502A")).toBeNull();
    expect(sapMaterialLookupKey("")).toBeNull();
  });
});

describe("sapMaterialPlants", () => {
  const row = (over: Partial<typeof live>) => toSapMaterialCost({ ...live, ...over });

  it("keeps a row per plant, sorted by plant", () => {
    const rows = [row({ Plant: "4230", UnitCost: 0.07 }), row({ Plant: "4222" }), row({ Plant: "4222", UnitCost: 9 })];
    expect(sapMaterialPlants(rows).map((r) => [r.plant, r.unitCost])).toEqual([
      ["4222", 0.0655],
      ["4230", 0.07],
    ]);
  });

  it("is empty when nothing matched", () => {
    expect(sapMaterialPlants([])).toEqual([]);
  });
});
