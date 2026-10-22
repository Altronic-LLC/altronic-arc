import { describe, expect, it } from "vitest";
import type { SapPart } from "@/types/pricing";
import { applySapPart, clearSapFill, lineFromLookup, lookupArgsFor, samePart, sapLookupArgs, type PartFields } from "./sapPartFill";

const PART: SapPart = {
  altronicPartNumber: "910007-15",
  sapPartNumber: "9100-0007-15",
  description: "HARNESS, DEMO",
  mpg: "HRN",
  listPrice: 200,
  cost: 66,
};
const blank: PartFields = { altronic: "", sap: "", description: "", cost: null };

describe("applySapPart", () => {
  it("fills blank boxes and brings SAP's cost in as the base", () => {
    const r = applySapPart({ ...blank, sap: "9100-0007-15" }, {}, PART);
    expect(r.fields).toEqual({ altronic: "910007-15", sap: "9100-0007-15", description: "HARNESS, DEMO", cost: 66 });
    expect(r.costFromSap).toBe(true);
    // The typed SAP # was already SAP's value and wasn't blank, so it isn't remembered as SAP's.
    expect(r.fill).toEqual({ altronic: "910007-15", description: "HARNESS, DEMO", cost: 66 });
  });

  it("never writes over a typed description, but the cost is always SAP's", () => {
    const r = applySapPart({ ...blank, sap: "9100-0007-15", description: "Mine", cost: 10 }, {}, PART);
    expect(r.fields.description).toBe("Mine");
    expect(r.fields.cost).toBe(66);
  });

  it("replaces what SAP filled for the last part when the next one is found", () => {
    const first = applySapPart({ ...blank, sap: "9100-0007-15" }, {}, PART);
    const next: SapPart = { ...PART, altronicPartNumber: "910007-25", sapPartNumber: "9100-0007-25", description: "HARNESS, 25", cost: null };
    const r = applySapPart({ ...first.fields, sap: "9100-0007-25" }, first.fill, next);
    expect(r.fields).toEqual({ altronic: "910007-25", sap: "9100-0007-25", description: "HARNESS, 25", cost: null });
    expect(r.costFromSap).toBe(false);
  });
});

describe("sapLookupArgs", () => {
  it("looks up only TYPED numbers — never one SAP filled in", () => {
    const filled = applySapPart({ ...blank, sap: "9100-0007-15" }, {}, PART);
    expect(sapLookupArgs({ ...filled.fields, sap: "9999-0000-00" }, filled.fill)).toEqual({
      altronicPartNumber: "",
      sapPartNumber: "9999-0000-00",
    });
  });
});

describe("clearSapFill", () => {
  it("takes back what SAP filled, and leaves what was typed", () => {
    const filled = applySapPart({ ...blank, sap: "9100-0007-15" }, {}, PART);
    const r = clearSapFill({ ...filled.fields, sap: "9999-0000-00" }, filled.fill);
    expect(r.fields).toEqual({ altronic: "", sap: "9999-0000-00", description: "", cost: null });
    expect(r.fill).toEqual({});
  });
});

describe("pasting several", () => {
  it("a 10-digit number is an SAP #, anything else an Altronic #", () => {
    expect(lookupArgsFor("9100000715")).toEqual({ altronicPartNumber: "", sapPartNumber: "9100-0007-15" });
    expect(lookupArgsFor(" 910007-15 ")).toEqual({ altronicPartNumber: "910007-15", sapPartNumber: "" });
  });

  it("a found part is an SAP line; one not found keeps its number as a manual line", () => {
    expect(lineFromLookup("9100000715", PART)).toMatchObject({
      partNumber: "910007-15",
      sapPartNumber: "9100-0007-15",
      description: "HARNESS, DEMO",
      quantity: 1,
      uploadedCost: 66,
      source: "sap",
    });
    expect(lineFromLookup("NOPE-1", null)).toMatchObject({ partNumber: "NOPE-1", sapPartNumber: "", uploadedCost: null, source: "manual" });
    expect(lineFromLookup("9100000715", { ...PART, cost: null }).source).toBe("manual");
  });

  it("samePart matches on either number, case-insensitively, and never on blanks", () => {
    expect(samePart({ partNumber: "abc" }, { partNumber: "ABC" })).toBe(true);
    expect(samePart({ partNumber: "", sapPartNumber: "9100-0007-15" }, { partNumber: "x", sapPartNumber: "9100-0007-15" })).toBe(true);
    expect(samePart({ partNumber: "", sapPartNumber: "" }, { partNumber: "", sapPartNumber: "" })).toBe(false);
  });
});
