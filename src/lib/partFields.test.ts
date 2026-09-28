import { describe, expect, it } from "vitest";
import { MOCK_ALTRONIC_COMPONENTS, MOCK_ALTRONIC_PARTS } from "@/data/altronicPartsMockData";
import {
  COMPONENT_FIELDS,
  PART_FIELDS,
  columnsFromPatch,
  describeChanges,
  formValues,
  missingRequired,
  nextPartNumber,
  partNumberProblem,
  patchFromForm,
} from "./partFields";
import { ALTRONIC_COMPONENT_SELECT } from "@/api/altronicComponents";
import { ALTRONIC_PART_SELECT } from "@/api/altronicParts";

const part = MOCK_ALTRONIC_PARTS.find((p) => p.partNumber === "504017")!;

describe("the descriptors", () => {
  it("name only columns the read selects", () => {
    // A write to a column the read doesn't select would save and then read
    // back blank.
    const partCols = ALTRONIC_PART_SELECT.split(",");
    for (const s of PART_FIELDS) expect(partCols).toContain(s.column);
    const compCols = ALTRONIC_COMPONENT_SELECT.split(",");
    for (const s of COMPONENT_FIELDS) expect(compCols).toContain(s.column);
  });

  it("never let the part number, sign-off or legacy source be edited as a field", () => {
    for (const s of [...PART_FIELDS, ...COMPONENT_FIELDS]) {
      expect(["Title", "SignOffStatus", "LegacySource", "Category", "Communication"]).not.toContain(s.column);
    }
  });
});

describe("form round trip", () => {
  it("turns a record into strings and back without loss", () => {
    const values = formValues(PART_FIELDS, part);
    expect(values.dateAssigned).toBe("2003-07-22");
    expect(values.purchased).toBe("Purchased");
    const patch = patchFromForm(PART_FIELDS, values);
    expect(patch.dateAssigned?.toISOString()).toBe("2003-07-22T12:00:00.000Z");
    expect(patch.purchased).toBe("Purchased");
    expect(patch.prototypeOrProduction).toBeNull();
  });

  it("writes SharePoint shapes: midday-UTC dates, bare-string choices, null to clear, real booleans", () => {
    expect(
      columnsFromPatch(PART_FIELDS, {
        dateAssigned: new Date("2026-09-28T12:00:00Z"),
        purchased: "Not Purchased",
        prototypeOrProduction: null,
        notes: "x",
      }),
    ).toEqual({
      DateAssigned: "2026-09-28T12:00:00Z",
      Purchased: "Not Purchased",
      PrototypeOrProduction: null,
      Notes: "x",
    });
    expect(columnsFromPatch(COMPONENT_FIELDS, { hasDataSheet: true })).toEqual({ HasDataSheet: true });
    // Only what's in the patch.
    expect(columnsFromPatch(PART_FIELDS, {})).toEqual({});
  });

  it("describes what an edit changed, in words, and nothing it didn't", () => {
    const changes = describeChanges(PART_FIELDS, part, {
      manufacturer: "Panduit Corp",
      purchased: "Purchased",
      dateDrawing: new Date("2026-01-02T12:00:00Z"),
    });
    expect(changes).toEqual([
      { label: "Date Drawing", from: "", to: expect.stringContaining("2026") },
      { label: "Manufacturer", from: "Panduit", to: "Panduit Corp" },
    ]);
  });
});

describe("required fields", () => {
  it("follow the guide for a part: not Mfg Part #, Manufacturer, Date Drawing or Drawing Size", () => {
    const missing = missingRequired(PART_FIELDS, {});
    expect(missing).toEqual(["Description", "Date Assigned", "Assigned By", "Prototype or Production", "Purchased"]);
  });

  it("need every component field except Notes", () => {
    expect(missingRequired(COMPONENT_FIELDS, { description: "RESISTOR" })).toEqual([
      "Mfg Name",
      "Mfg Number",
      "Rating A",
      "Rating B",
      "Rating C",
      "Tolerance",
      "Temp Min",
      "Temp Max",
      "Footprint",
    ]);
  });

  it("don't ask for a rating the entry rules mark unused for that type", () => {
    // An electrolytic capacitor's Rating C is "none" in the guide's table.
    const missing = missingRequired(COMPONENT_FIELDS, { description: "CAPACITOR - ELECTROLYTIC" });
    expect(missing).toContain("Rating B");
    expect(missing).not.toContain("Rating C");
  });

  it("treat whitespace as blank", () => {
    expect(missingRequired(PART_FIELDS, { description: "  " })).toContain("Description");
  });
});

describe("part numbers", () => {
  it("suggest one past the highest plain number in the list", () => {
    expect(nextPartNumber("604", ["604596", "604612", "601999", "604613HT"])).toBe("604613");
  });

  it("start a new list at 001", () => {
    expect(nextPartNumber("444", ["604596"])).toBe("444001");
  });

  it("refuse to roll over a full list", () => {
    expect(nextPartNumber("602", ["602999"])).toBeNull();
  });

  it("reject a blank, a number without a list, a wrong list and a duplicate", () => {
    const existing = MOCK_ALTRONIC_PARTS.map((p) => p.partNumber);
    expect(partNumberProblem("", "604", existing)).toMatch(/Enter/);
    expect(partNumberProblem("AB1234", null, existing)).toMatch(/three-digit/);
    expect(partNumberProblem("605001", "604", existing)).toMatch(/must start with 604/);
    expect(partNumberProblem("604596", "604", existing)).toMatch(/already on the parts list/);
    expect(partNumberProblem("604700", "604", existing)).toBeNull();
  });

  it("catch a duplicate across both lists, whatever the case", () => {
    const existing = MOCK_ALTRONIC_COMPONENTS.map((c) => c.partNumber);
    expect(partNumberProblem("601427ht", null, existing)).toMatch(/already/);
  });
});
