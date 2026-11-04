import { describe, it, expect } from "vitest";
import type { Ecn, GraphListItem } from "@/types/task";
import {
  buildEcnCreateFields,
  compareEcns,
  ecnFieldPatch,
  ecnLabel,
  ecnStockNeedsSerialNumbers,
  isEcnOnHold,
  isEcnSerialNumbersMissing,
  isEcnWaitingForSerialNumbers,
  parseCreatedBy,
  parseEcnLogNo,
  projectPatch,
  toEcn,
} from "./ecnMapper";
import { ECN_SELECT } from "./ecnFields";

// Column names and stored shapes come from the live list —
// scripts/ecn-new-schema.json, captured 2026-08-19.

function item(fields: Record<string, unknown>, extra: Partial<GraphListItem> = {}): GraphListItem {
  return { id: "1", fields, ...extra } as unknown as GraphListItem;
}

function ecn(logNo: string, id = 1, values: Record<string, string> = {}): Ecn {
  return {
    id,
    title: "x",
    logNo,
    parentProject: null,
    submittedBy: null,
    comments: [],
    hasAttachments: false,
    values,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };
}

describe("toEcn", () => {
  it("decodes the field_N columns into named values", () => {
    const e = toEcn(
      item({
        Title: "PCB ASSEMBLY, WCD-20",
        field_2: "260059R1",
        field_4: "791970",
        field_7: "Engineering - Do NOT modify stock",
        field_12: "Complete",
      }),
    );
    expect(e.title).toBe("PCB ASSEMBLY, WCD-20");
    expect(e.logNo).toBe("260059R1");
    expect(e.values.finalAssemblyPartNumbers).toBe("791970");
    expect(e.values.inHouseStock).toBe("Engineering - Do NOT modify stock");
    expect(e.values.signOffStatus).toBe("Complete");
  });

  // field_8 / field_9 are real booleans. They live in `values` as "Yes" / ""
  // so the record stays one shape.
  it("carries the boolean columns as Yes / empty", () => {
    const on = toEcn(item({ field_8: true, field_9: false }));
    expect(on.values.fieldReturnsImpacted).toBe("Yes");
    expect(on.values.drawingsComplete).toBe("");
  });

  it("treats a missing boolean as not set rather than Yes", () => {
    expect(toEcn(item({})).values.fieldReturnsImpacted).toBe("");
  });

  it("keeps the rich-text wrapper the long fields are stored in", () => {
    const html = '<div class="ExternalClassABC">Change R14<br></div>';
    expect(toEcn(item({ field_5: html })).values.detailedDescription).toBe(html);
  });

  // ProjectReference is a SINGLE lookup, added to the list 2026-08-19. Graph
  // hands it back as an id with no title attached.
  it("reads the project as a title-less lookup", () => {
    const e = toEcn(item({ ProjectReferenceLookupId: "7" }));
    expect(e.parentProject).toEqual({ lookupId: 7, title: "" });
  });

  it("has no project when the column is empty", () => {
    expect(toEcn(item({})).parentProject).toBeNull();
    expect(toEcn(item({ ProjectReferenceLookupId: "" })).parentProject).toBeNull();
    expect(toEcn(item({ ProjectReferenceLookupId: 0 })).parentProject).toBeNull();
  });

  it("reads the submitter off Graph's createdBy, not a column", () => {
    const e = toEcn(
      item(
        {},
        { createdBy: { user: { displayName: "Sarah Shaffer", email: "sarah@altronic-llc.com" } } },
      ),
    );
    expect(e.submittedBy).toEqual({
      displayName: "Sarah Shaffer",
      email: "sarah@altronic-llc.com",
    });
  });

  it("copes with an item Graph sent no creator for", () => {
    expect(toEcn(item({})).submittedBy).toBeNull();
    expect(parseCreatedBy(item({}, { createdBy: { user: {} } }))).toBeNull();
  });

  it("selects the descriptor columns and the named ones", () => {
    for (const column of ["Title", "field_2", "field_5", "field_10", "Communication"]) {
      expect(ECN_SELECT).toContain(column);
    }
    // field_1 and field_11 don't exist on the list — asking for them 400s.
    expect(ECN_SELECT).not.toContain("field_1,");
    expect(ECN_SELECT).not.toContain("field_11");
  });
});

describe("buildEcnCreateFields", () => {
  it("writes Title and the typed Log#", () => {
    const fields = buildEcnCreateFields({
      title: "  De-4000  ",
      logNo: " 260063 ",
      projectLookupId: null,
      values: {},
    });
    expect(fields.Title).toBe("De-4000");
    expect(fields.field_2).toBe("260063");
  });

  it("omits blank text columns but always sends the booleans", () => {
    const fields = buildEcnCreateFields({
      title: "x",
      logNo: "260063",
      projectLookupId: null,
      values: { finalAssemblyPartNumbers: "", fieldReturnsImpacted: "Yes" },
    });
    // Unticked is a real answer to "Field Returns Impacted" — leaving the
    // column null makes the SharePoint views read it as blank, not No.
    expect(fields).not.toHaveProperty("field_4");
    expect(fields.field_8).toBe(true);
    expect(fields.field_9).toBe(false);
  });

  it("promotes a plain-text description to paragraphs", () => {
    const fields = buildEcnCreateFields({
      title: "x",
      logNo: "260063",
      projectLookupId: null,
      values: { detailedDescription: "First line\n\nSecond line" },
    });
    expect(String(fields.field_5)).toContain("<p>");
  });
});

describe("the project lookup on write", () => {
  // A single-value lookup takes a bare integer. The Collection(Edm.Int32)
  // shape that multi-value person and lookup columns need is a 400 here.
  it("writes a bare integer", () => {
    expect(projectPatch(7)).toEqual({ ProjectReferenceLookupId: 7 });
  });

  it("clears with null rather than omitting the column", () => {
    // Omitting it would leave a wrong project in place on an edit.
    expect(projectPatch(null)).toEqual({ ProjectReferenceLookupId: null });
  });

  it("goes onto a create when one was picked", () => {
    const fields = buildEcnCreateFields({
      title: "x",
      logNo: "260063",
      projectLookupId: 4,
      values: {},
    });
    expect(fields.ProjectReferenceLookupId).toBe(4);
  });
});

describe("ecnFieldPatch", () => {
  it("patches one column by its real name", () => {
    expect(ecnFieldPatch("inHouseStock", " Operations - Stock modified ")).toEqual({
      field_7: "Operations - Stock modified",
    });
  });

  it("turns a boolean field back into a boolean", () => {
    expect(ecnFieldPatch("drawingsComplete", "Yes")).toEqual({ field_9: true });
    expect(ecnFieldPatch("drawingsComplete", "")).toEqual({ field_9: false });
  });

  it("refuses a key that isn't a field", () => {
    expect(() => ecnFieldPatch("nope", "x")).toThrow(/Unknown ECN field/);
  });
});

describe("parseEcnLogNo", () => {
  it("splits YY#### and its revision suffix", () => {
    expect(parseEcnLogNo("260059")).toEqual({ year: 26, sequence: 59, revision: 0 });
    expect(parseEcnLogNo("250107R4")).toEqual({ year: 25, sequence: 107, revision: 4 });
  });

  it("returns null for anything that isn't one", () => {
    expect(parseEcnLogNo("")).toBeNull();
    expect(parseEcnLogNo("ECN-2026-1")).toBeNull();
  });
});

describe("compareEcns", () => {
  // Every migrated row shares one Created timestamp, so the Log# is the only
  // thing that actually orders this list.
  it("sorts newest number first, revisions above their base notice", () => {
    const list = [ecn("250107", 1), ecn("260059", 2), ecn("260059R1", 3), ecn("260062", 4)];
    expect([...list].sort(compareEcns).map((e) => e.logNo)).toEqual([
      "260062",
      "260059R1",
      "260059",
      "250107",
    ]);
  });

  it("puts an unparseable number last rather than dropping it", () => {
    const list = [ecn("", 1), ecn("260001", 2)];
    expect([...list].sort(compareEcns).map((e) => e.id)).toEqual([2, 1]);
  });
});

describe("ecnLabel", () => {
  it("reads as the number and the part", () => {
    expect(ecnLabel(ecn("260059", 7))).toBe("ECN 260059 — x");
  });

  it("falls back when there's no number", () => {
    const bare = { ...ecn("", 7), title: "" };
    expect(ecnLabel(bare)).toBe("ECN #7");
  });
});

describe("isEcnOnHold", () => {
  it("is true only for a Yes", () => {
    expect(isEcnOnHold(ecn("1", 1, { onHold: "Yes" }))).toBe(true);
    expect(isEcnOnHold(ecn("1", 1, { onHold: "yes" }))).toBe(true);
    expect(isEcnOnHold(ecn("1", 1, { onHold: "No" }))).toBe(false);
    expect(isEcnOnHold(ecn("1", 1, {}))).toBe(false);
  });
});

// BusinessIT#61. Every spelling below is one the live list holds (2026-11-04).
describe("isEcnSerialNumbersMissing", () => {
  const serials = (value: string | undefined) =>
    isEcnSerialNumbersMissing(ecn("1", 1, value === undefined ? {} : { serialNumbers: value }));

  it("is waiting when the field is blank, missing, or only empty rich text", () => {
    expect(serials(undefined)).toBe(true);
    expect(serials("")).toBe(true);
    expect(serials('<div class="ExternalClass1"><br></div>')).toBe(true);
    expect(serials("<p>&#160;</p>")).toBe(true);
  });

  it("is waiting while the field only asks for serial numbers, however it's spelled", () => {
    expect(serials('<div class="ExternalClassA">Please provide serial numbers</div>')).toBe(true);
    expect(serials("PLEASE INCLUDE SERIAL NUMBER.")).toBe(true);
    expect(serials("Please provide starting serial number.")).toBe(true);
    expect(serials("PLEASE PROVIDE SERIAL NUMBERS STARTING WITH SERIAL NO. 507")).toBe(true);
    expect(serials("Please provide serial numbers for the ground strap and for the masking.")).toBe(true);
    expect(serials("enter serial numbers")).toBe(true);
  });

  it("counts a request that was answered in the same field as recorded", () => {
    expect(
      serials("Please provide serial numbers starting with 3250. Response: please see ECN 160055R1"),
    ).toBe(false);
    expect(serials("Please include serial number.DE-300+ s/n 1000 &amp; 1100<br>691171-1-s/n 4419")).toBe(false);
    // One line, but the s/n is written in after the request.
    expect(serials("Please include serial number. s/n 4419")).toBe(false);
  });

  it("counts real serial numbers, and anything that isn't a request, as recorded", () => {
    expect(serials("S/N 628")).toBe(false);
    expect(serials("SERIAL NUMBER 2797")).toBe(false);
    expect(serials("N/A")).toBe(false);
    expect(serials("Not a serialized product")).toBe(false);
    expect(serials("See R1")).toBe(false);
    expect(serials("Next shipped serial number from today&#39;s date is the next serial number")).toBe(false);
  });
});

// Tim, 2026-11-04: only an ECN that modifies stock needs serial numbers logged.
describe("ecnStockNeedsSerialNumbers", () => {
  const stock = (value: string | undefined) =>
    ecnStockNeedsSerialNumbers(ecn("1", 1, value === undefined ? {} : { inHouseStock: value }));

  it("is true for the dispositions that modify stock", () => {
    expect(stock("Engineering - Modify stock (see pg 2 of ECN)")).toBe(true);
    expect(stock("Operations - Stock modified")).toBe(true);
  });

  it("is false for a blank disposition and for Do NOT modify, however it is typed", () => {
    expect(stock(undefined)).toBe(false);
    expect(stock("")).toBe(false);
    expect(stock("   ")).toBe(false);
    expect(stock("Engineering - Do NOT modify stock")).toBe(false);
    expect(stock("engineering - do not modify stock")).toBe(false);
    expect(stock("Don't modify stock")).toBe(false);
  });
});

describe("isEcnWaitingForSerialNumbers", () => {
  const waiting = (values: Record<string, string>) => isEcnWaitingForSerialNumbers(ecn("1", 1, values));
  const MODIFY = "Engineering - Modify stock (see pg 2 of ECN)";

  it("is waiting when the stock is modified and no serial numbers are recorded", () => {
    expect(waiting({ inHouseStock: MODIFY })).toBe(true);
    expect(waiting({ inHouseStock: MODIFY, serialNumbers: "Please provide serial numbers" })).toBe(true);
  });

  it("is not waiting once serial numbers are recorded", () => {
    expect(waiting({ inHouseStock: MODIFY, serialNumbers: "S/N 628" })).toBe(false);
  });

  it("is not waiting when the ECN doesn't modify stock, even with nothing recorded", () => {
    expect(waiting({})).toBe(false);
    expect(waiting({ inHouseStock: "Engineering - Do NOT modify stock" })).toBe(false);
    expect(
      waiting({ inHouseStock: "Engineering - Do NOT modify stock", serialNumbers: "Please provide serial numbers" }),
    ).toBe(false);
  });
});
