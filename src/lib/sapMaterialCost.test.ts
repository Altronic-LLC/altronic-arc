import { describe, expect, it } from "vitest";
import { SAP_MATERIAL_COST_FIELDS, sapMaterialLookupKey, sapMaterialPlants, toSapMaterialCost, toSapPart, sapCustomerSearchTerms } from "./sapMaterialCost";

// The Calculator's SAP cost lookup — the pure half. Rows are shaped like the
// live view's (rpt.vw_cogs_material_api, read 2026-10-15).

const live = {
  Plant: "4222",
  Material: "9100-0002-00",
  MaterialDescription: "CAPACITOR, DEMO CERAMIC",
  UnitCost: 0.0611,
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
      sapPartNumber: "9100-0002-00",
      description: "CAPACITOR, DEMO CERAMIC",
      unitCost: 0.0611,
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
    expect(toSapMaterialCost({ ...live, UnitCost: "33.10" }).unitCost).toBe(33.10);
  });
});

describe("sapMaterialLookupKey", () => {
  it("is the dashed SAP number for 10 digits, dashed or not", () => {
    expect(sapMaterialLookupKey("9100000200")).toBe("9100-0002-00");
    expect(sapMaterialLookupKey(" 9100-0002-00 ")).toBe("9100-0002-00");
  });

  it("is null until a whole SAP number is typed — a half-typed one never reaches Fabric", () => {
    expect(sapMaterialLookupKey("1000-4869-0")).toBeNull();
    expect(sapMaterialLookupKey("910002")).toBeNull();
    expect(sapMaterialLookupKey("9100X-DEMO-06A")).toBeNull();
    expect(sapMaterialLookupKey("")).toBeNull();
  });
});

describe("sapMaterialPlants", () => {
  const row = (over: Partial<typeof live>) => toSapMaterialCost({ ...live, ...over });

  it("keeps a row per plant, sorted by plant", () => {
    const rows = [row({ Plant: "4230", UnitCost: 0.07 }), row({ Plant: "4222" }), row({ Plant: "4222", UnitCost: 9 })];
    expect(sapMaterialPlants(rows).map((r) => [r.plant, r.unitCost])).toEqual([
      ["4222", 0.0611],
      ["4230", 0.07],
    ]);
  });

  it("is empty when nothing matched", () => {
    expect(sapMaterialPlants([])).toEqual([]);
  });
});

describe("toSapPart", () => {
  it("is one part from its plant rows — the first plant's cost, no list price", () => {
    expect(
      toSapPart([
        { Plant: "4230", Material: "2001-0310-15", OldMaterialNumber: "593027-15", MaterialDescription: "HARNESS", MaterialPriceGroup: "HRN", UnitCost: 126.5 },
        { Plant: "4222", Material: "2001-0310-15", OldMaterialNumber: "593027-15", MaterialDescription: "HARNESS", MaterialPriceGroup: "HRN", UnitCost: 120 },
      ]),
    ).toEqual({ sapPartNumber: "2001-0310-15", altronicPartNumber: "593027-15", description: "HARNESS", mpg: "HRN", listPrice: null, cost: 120 });
  });

  it("is null with no rows, and reads a zero cost as none", () => {
    expect(toSapPart([])).toBeNull();
    expect(toSapPart([{ Plant: "4222", Material: "1", UnitCost: 0 }])?.cost).toBeNull();
  });
});

describe("sapCustomerSearchTerms", () => {
  it("tries the text as typed, Title Case and UPPER CASE, without repeats", () => {
    expect(sapCustomerSearchTerms("blue river")).toEqual(["blue river", "Blue River", "BLUE RIVER"]);
    expect(sapCustomerSearchTerms("R&D demo")).toEqual(["R&D demo", "R&D Demo", "R&D DEMO"]);
    expect(sapCustomerSearchTerms("900101")).toEqual(["900101"]);
  });

  it("asks nothing under 2 characters", () => {
    expect(sapCustomerSearchTerms(" e ")).toEqual([]);
  });
});
