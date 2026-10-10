import { describe, expect, it } from "vitest";
import { MOCK_ALTRONIC_COMPONENTS, MOCK_ALTRONIC_PARTS } from "@/data/altronicPartsMockData";
import {
  COMPONENT_FIELDS,
  PART_FIELDS,
  columnsFromPatch,
  describeChanges,
  formValues,
  linkedListChain,
  listNames,
  missingRequired,
  nextLinkedPartNumber,
  nextPartNumber,
  opensNewList,
  partNumberProblem,
  patchFromForm,
} from "./partFields";

describe("linked HCO lists (Tim, 2026-10-09)", () => {
  /** Every number up to <prefix>999 taken. */
  const full = (prefix: string) => [`${prefix}999`];

  it("chains each linked list to the ones after it, and nothing else", () => {
    expect(linkedListChain("701")).toEqual(["701", "711", "712"]);
    expect(linkedListChain("711")).toEqual(["711", "712"]);
    expect(linkedListChain("712")).toEqual(["712"]);
    expect(linkedListChain("601")).toEqual(["601", "611"]);
    expect(linkedListChain("722")).toEqual(["722"]);
    expect(linkedListChain("604")).toEqual(["604"]);
  });

  it("stays on the list asked for while it has room", () => {
    expect(nextLinkedPartNumber("701", ["701010", "711020"])).toEqual({
      partNumber: "701011",
      prefix: "701",
      skipped: [],
      chain: ["701", "711", "712"],
    });
  });

  it("overflows past every full list to the next one with room", () => {
    const r = nextLinkedPartNumber("701", [...full("701"), ...full("711"), "712101"]);
    expect(r).toMatchObject({ partNumber: "712102", prefix: "712", skipped: ["701", "711"] });
    expect(nextLinkedPartNumber("601", [...full("601")])).toMatchObject({ partNumber: "611001", skipped: ["601"] });
  });

  it("reuses a deleted number before overflowing", () => {
    expect(nextLinkedPartNumber("701", [...full("701")], ["701500"])).toMatchObject({ partNumber: "701500" });
  });

  it("says when every linked list is full", () => {
    expect(nextLinkedPartNumber("601", [...full("601"), ...full("611")])).toEqual({
      partNumber: null,
      prefix: "601",
      skipped: ["601", "611"],
      chain: ["601", "611"],
    });
  });

  it("never rolls a Part List list over into another", () => {
    expect(nextLinkedPartNumber("602", full("602"))).toMatchObject({ partNumber: null, chain: ["602"] });
  });

  it("accepts a number on a linked list after the one the form was opened on", () => {
    expect(partNumberProblem("712102", "701", [])).toBeNull();
    expect(partNumberProblem("611001", "601", [])).toBeNull();
    // Not one BEFORE it, and not another category.
    expect(partNumberProblem("701001", "711", [])).toBe("A part in list 711 must start with 711 or 712.");
    expect(partNumberProblem("601001", "701", [])).toBe("A part in list 701 must start with 701, 711 or 712.");
    expect(partNumberProblem("605001", "604", [])).toBe("A part in list 604 must start with 604.");
  });

  it("names lists the way a sentence does", () => {
    expect(listNames(["701"])).toBe("701");
    expect(listNames(["701", "711"])).toBe("701 and 711");
    expect(listNames(["701", "711", "712"])).toBe("701, 711 and 712");
  });
});
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

describe("opensNewList — would this part start its list?", () => {
  const numbers = ["410001", "410002", "604612", "503064"];

  it("is true only for a three-digit list with no number on it", () => {
    expect(opensNewList("411", numbers)).toBe(true);
    expect(opensNewList("410", numbers)).toBe(false);
  });

  it("counts a list whose only numbers are deleted as existing", () => {
    // allNumbers includes deleted rows — a list emptied by deletes still exists.
    expect(opensNewList("503", numbers)).toBe(false);
  });

  it("never treats an HCO list, or an unfinished number, as new", () => {
    expect(opensNewList("722", [])).toBe(false);
    expect(opensNewList("41", numbers)).toBe(false);
    expect(opensNewList("", numbers)).toBe(false);
  });
});
