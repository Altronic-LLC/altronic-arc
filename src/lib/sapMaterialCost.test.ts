import { describe, expect, it } from "vitest";
import { matchesSapMaterialKeys, sapMaterialLookupKeys, sapMaterialPlants, toSapMaterialCost } from "./sapMaterialCost";

// The Calculator's SAP cost lookup — the pure half. Rows are shaped like the
// live view's (rpt.vw_cogs_material_api, read 2026-10-15).

const live = {
  Plant: "4222",
  Material: "1000-4869-00",
  OldMaterialNumber: "711078",
  MaterialDescription: "CAPACITOR, 1NF, 2000V, CERAMIC, 10%, 120",
  UnitCost: 0.0655,
  MaterialPriceGroup: "GA",
  PriceControl: "V",
  BaseUnitOfMeasure: "PC",
};

describe("toSapMaterialCost", () => {
  it("maps a live row, taking UnitCost as the cost of one", () => {
    expect(toSapMaterialCost(live)).toEqual({
      plant: "4222",
      sapPartNumber: "1000-4869-00",
      altronicPartNumber: "711078",
      description: "CAPACITOR, 1NF, 2000V, CERAMIC, 10%, 120",
      mpg: "GA",
      unitCost: 0.0655,
      priceControl: "V",
      unitOfMeasure: "PC",
    });
  });

  it("reads a blank material price group as none, and copes with nulls", () => {
    const r = toSapMaterialCost({ ...live, MaterialPriceGroup: "", OldMaterialNumber: null, MaterialDescription: null });
    expect(r.mpg).toBe("");
    expect(r.altronicPartNumber).toBe("");
    expect(r.description).toBe("");
  });

  it("reads a missing, zero or unreadable cost as NO cost — never prices from 0", () => {
    expect(toSapMaterialCost({ ...live, UnitCost: null }).unitCost).toBeNull();
    expect(toSapMaterialCost({ ...live, UnitCost: 0 }).unitCost).toBeNull();
    expect(toSapMaterialCost({ ...live, UnitCost: "abc" }).unitCost).toBeNull();
    // A decimal that arrives as a string still reads.
    expect(toSapMaterialCost({ ...live, UnitCost: "35.15" }).unitCost).toBe(35.15);
  });
});

describe("sapMaterialLookupKeys", () => {
  it("treats 10 digits (dashed or not) as an SAP number, and always tries the old number", () => {
    expect(sapMaterialLookupKeys("1000486900")).toEqual({ sap: "1000-4869-00", old: ["1000486900"] });
    expect(sapMaterialLookupKeys(" 1000-4869-00 ")).toEqual({ sap: "1000-4869-00", old: ["1000-4869-00"] });
  });

  it("never dashes an Altronic number as an SAP one", () => {
    expect(sapMaterialLookupKeys("593027-15")).toEqual({ sap: null, old: ["593027-15"] });
    expect(sapMaterialLookupKeys("711078")).toEqual({ sap: null, old: ["711078"] });
  });

  it("tries an old number as typed AND upper-cased — they carry letters", () => {
    expect(sapMaterialLookupKeys("3549s-1ag-502a").old).toEqual(["3549s-1ag-502a", "3549S-1AG-502A"]);
  });

  it("asks for nothing when nothing was typed", () => {
    expect(sapMaterialLookupKeys("   ")).toEqual({ sap: null, old: [] });
  });
});

describe("sapMaterialPlants", () => {
  const row = (over: Partial<typeof live>) => toSapMaterialCost({ ...live, ...over });

  it("keeps one material, one row per plant, sorted by plant", () => {
    const rows = [row({ Plant: "4230", UnitCost: 0.07 }), row({ Plant: "4222" }), row({ Plant: "4222" })];
    const keys = sapMaterialLookupKeys("1000486900");
    expect(sapMaterialPlants(rows, keys).map((r) => r.plant)).toEqual(["4222", "4230"]);
  });

  it("prefers the SAP-number match when the typed number also matches another part's old number", () => {
    const keys = sapMaterialLookupKeys("1000486900");
    const other = row({ Material: "2000-0000-00", OldMaterialNumber: "1000486900" });
    expect(sapMaterialPlants([other, row({})], keys).map((r) => r.sapPartNumber)).toEqual(["1000-4869-00"]);
  });

  it("is empty when nothing matched", () => {
    expect(sapMaterialPlants([], sapMaterialLookupKeys("711078"))).toEqual([]);
  });
});

describe("matchesSapMaterialKeys", () => {
  it("matches the SAP number or the old number, nothing else", () => {
    const r = toSapMaterialCost(live);
    expect(matchesSapMaterialKeys(r, sapMaterialLookupKeys("1000486900"))).toBe(true);
    expect(matchesSapMaterialKeys(r, sapMaterialLookupKeys("711078"))).toBe(true);
    expect(matchesSapMaterialKeys(r, sapMaterialLookupKeys("71107"))).toBe(false);
  });
});
