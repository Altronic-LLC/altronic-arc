import { describe, expect, it } from "vitest";
import type { GraphListItem } from "@/types/task";
import {
  COMPONENT_PREFIX_CATEGORY,
  altronicPartLabel,
  comparePartNumbers,
  isComponentPrefix,
  partBook,
  partPrefix,
  toAltronicComponent,
  toAltronicPart,
} from "./altronicPartMapper";

function item(fields: Record<string, unknown>, id = "7"): GraphListItem {
  return {
    id,
    createdDateTime: "2026-09-28T14:00:00Z",
    lastModifiedDateTime: "2026-09-28T15:00:00Z",
    fields: fields as GraphListItem["fields"],
  };
}

describe("toAltronicPart", () => {
  it("reads Title as the part number and every named column", () => {
    const p = toAltronicPart(
      item({
        Title: "101022",
        Description: "Switch - SPST/NO",
        DateAssigned: "2007-12-03T12:00:00Z",
        DrawingSize: "B",
        DateDrawing: "2007-12-04T12:00:00Z",
        Manufacturer: "Omron",
        MfgPartNumber: "A22S2M10",
        Notes: "line 1\nline 2",
        AssignedBy: "SL",
        PrototypeOrProduction: "Production",
        Purchased: "Purchased",
        SAPNumber: "1000-0001-00",
        ItemValue: "",
        SignOffStatus: "Pending SAP",
        LegacySource: "101#2",
        Attachments: true,
      }),
    );
    expect(p).toMatchObject({
      id: 7,
      partNumber: "101022",
      description: "Switch - SPST/NO",
      drawingSize: "B",
      manufacturer: "Omron",
      mfgPartNumber: "A22S2M10",
      notes: "line 1\nline 2",
      assignedBy: "SL",
      prototypeOrProduction: "Production",
      purchased: "Purchased",
      sapNumber: "1000-0001-00",
      itemValue: "",
      signOffStatus: "Pending SAP",
      legacySource: "101#2",
      hasAttachments: true,
    });
    expect(p.dateAssigned?.toISOString()).toBe("2007-12-03T12:00:00.000Z");
    expect(p.dateDrawing?.toISOString()).toBe("2007-12-04T12:00:00.000Z");
  });

  it("reads a SharePoint-UI date (local midnight, Eastern) as the day people see", () => {
    // 04:00Z is midnight EDT — the midday pivot keeps it on the 3rd.
    const p = toAltronicPart(item({ Title: "1", DateAssigned: "2007-12-03T04:00:00Z" }));
    expect(p.dateAssigned?.toISOString().slice(0, 10)).toBe("2007-12-03");
  });

  it("treats blank choices as null, not an empty string", () => {
    // A legacy row's blank sign-off must stay distinguishable from a value.
    const p = toAltronicPart(item({ Title: "1", SignOffStatus: "", Purchased: null }));
    expect(p.signOffStatus).toBeNull();
    expect(p.purchased).toBeNull();
    expect(p.prototypeOrProduction).toBeNull();
    expect(p.dateAssigned).toBeNull();
    expect(p.hasAttachments).toBe(false);
  });

  it("trims stray whitespace on the part number", () => {
    expect(toAltronicPart(item({ Title: " 101022 " })).partNumber).toBe("101022");
  });
});

describe("toAltronicComponent", () => {
  it("reads the component columns and the HasDataSheet boolean", () => {
    const c = toAltronicComponent(
      item({
        Title: "601110",
        Category: "Through Hole",
        Description: "RESISTOR",
        MfgName: "VISHAY",
        MfgNumber: "MBA02040C1003FRP00",
        RatingA: "100K",
        RatingB: "200V",
        RatingC: "1/4W",
        TempMin: "-55",
        TempMax: "155",
        Tolerance: "1%",
        Footprint: "AXIAL-0.4",
        Notes: "",
        HasDataSheet: true,
        SignOffStatus: "Pending Engineering Review",
        LegacySource: "Through Hole Parts#1065",
      }),
    );
    expect(c).toMatchObject({
      partNumber: "601110",
      category: "Through Hole",
      mfgName: "VISHAY",
      mfgNumber: "MBA02040C1003FRP00",
      ratingA: "100K",
      ratingB: "200V",
      ratingC: "1/4W",
      tempMin: "-55",
      tempMax: "155",
      tolerance: "1%",
      footprint: "AXIAL-0.4",
      hasDataSheet: true,
      signOffStatus: "Pending Engineering Review",
      legacySource: "Through Hole Parts#1065",
    });
  });

  it("reads a missing HasDataSheet as No", () => {
    expect(toAltronicComponent(item({ Title: "601110" })).hasDataSheet).toBe(false);
  });
});

describe("part-number rules", () => {
  it("takes the first three digits as the parts list, ignoring a suffix", () => {
    expect(partPrefix("601427HT")).toBe("601");
    expect(partPrefix("791950-08")).toBe("791");
    expect(partPrefix(" 101022")).toBe("101");
  });

  it("has no parts list for a number that doesn't start with three digits", () => {
    expect(partPrefix("")).toBeNull();
    expect(partPrefix("61")).toBeNull();
    expect(partPrefix("A01234")).toBeNull();
  });

  it("takes the first digit as the parts book", () => {
    expect(partBook("601110")).toBe(6);
    expect(partBook("x")).toBeNull();
  });

  it("knows exactly the six HOC lists, matching the load script", () => {
    expect(Object.keys(COMPONENT_PREFIX_CATEGORY).sort()).toEqual(["601", "611", "701", "711", "712", "722"]);
    expect(isComponentPrefix("722")).toBe(true);
    expect(isComponentPrefix("610")).toBe(false);
    // An inherited property must not read as a prefix.
    expect(isComponentPrefix("toString")).toBe(false);
  });

  it("orders part numbers numerically, a suffix right after its base", () => {
    const sorted = ["601428", "601427HT", "601099", "601427"].sort(comparePartNumbers);
    expect(sorted).toEqual(["601099", "601427", "601427HT", "601428"]);
  });

  it("labels a part without ever returning an empty string", () => {
    expect(altronicPartLabel({ partNumber: "101022", description: "Switch" })).toBe("101022 — Switch");
    expect(altronicPartLabel({ partNumber: "", description: "" })).toBe("(no part number)");
  });
});
