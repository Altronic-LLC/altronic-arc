import { describe, it, expect } from "vitest";
import {
  buildTeradyneEmployeeTitle,
  buildTeradyneLogTitle,
  buildTeradyneRefMaps,
  compareTeradyneLogEntries,
  formatTeradyneDate,
  fromDateInputValue,
  parseSpDate,
  toDateInputValue,
  toLookupId,
  toNumberOrNull,
  toSpDateOnly,
  toTeradyneEmployee,
  toTeradyneLogEntry,
  toTeradyneProduct,
  toTeradyneRemark,
} from "./teradyneMapper";
import type { GraphListItem, TeradyneLogEntry } from "@/types/task";

function item(fields: Record<string, unknown>, id = "1"): GraphListItem {
  return {
    id,
    createdDateTime: "2026-02-17T14:02:00Z",
    lastModifiedDateTime: "2026-02-18T09:00:00Z",
    fields: fields as GraphListItem["fields"],
  };
}

describe("toNumberOrNull", () => {
  it("passes numbers through", () => {
    expect(toNumberOrNull(3)).toBe(3);
    expect(toNumberOrNull(0)).toBe(0);
  });

  it("coerces numeric strings (Graph returns lookup ids as strings)", () => {
    expect(toNumberOrNull("201")).toBe(201);
  });

  it("returns null for empty / missing / non-numeric values", () => {
    expect(toNumberOrNull("")).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
    expect(toNumberOrNull("abc")).toBeNull();
  });
});

describe("toLookupId", () => {
  it("accepts positive integers as strings or numbers", () => {
    expect(toLookupId("8")).toBe(8);
    expect(toLookupId(8)).toBe(8);
  });

  it("rejects zero, negatives, and fractions — none are valid SP item ids", () => {
    expect(toLookupId(0)).toBeNull();
    expect(toLookupId(-4)).toBeNull();
    expect(toLookupId("2.5")).toBeNull();
  });
});

describe("date-only handling", () => {
  it("writes midday UTC, matching how every existing row is stored", () => {
    expect(toSpDateOnly(new Date("2026-02-17T00:00:00Z"))).toBe("2026-02-17T12:00:00Z");
  });

  it("returns null for a missing or invalid date", () => {
    expect(toSpDateOnly(null)).toBeNull();
    expect(toSpDateOnly(new Date("nope"))).toBeNull();
  });

  it("round-trips through the date input format without shifting the day", () => {
    const parsed = parseSpDate("2026-02-17T12:00:00Z");
    expect(toDateInputValue(parsed)).toBe("2026-02-17");
    expect(toSpDateOnly(fromDateInputValue("2026-02-17"))).toBe("2026-02-17T12:00:00Z");
  });

  it("rejects malformed date-input values", () => {
    expect(fromDateInputValue("")).toBeNull();
    expect(fromDateInputValue("17/02/2026")).toBeNull();
  });

  it("parses garbage as null rather than an Invalid Date", () => {
    expect(parseSpDate("not a date")).toBeNull();
    expect(parseSpDate(undefined)).toBeNull();
    expect(parseSpDate(42)).toBeNull();
  });

  it("formats in UTC so a stored day never renders as the day before", () => {
    // A US-timezone browser would show the 16th if this were formatted locally.
    expect(formatTeradyneDate(parseSpDate("2026-02-17T12:00:00Z"))).toMatch(/17/);
    expect(formatTeradyneDate(null)).toBe("—");
  });

  it("renders an empty date input for no date", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue(new Date("nope"))).toBe("");
  });
});

describe("buildTeradyneLogTitle", () => {
  it("joins product and defective parts the way the existing rows read", () => {
    expect(buildTeradyneLogTitle("Moris Power Supply", "U1")).toBe("Moris Power Supply - U1");
  });

  it("trims stray whitespace from either half", () => {
    expect(buildTeradyneLogTitle("  TEM Power Board ", " CH2 601413 ")).toBe(
      "TEM Power Board - CH2 601413",
    );
  });

  it("falls back to whichever half exists", () => {
    expect(buildTeradyneLogTitle("SAVES", "")).toBe("SAVES");
    expect(buildTeradyneLogTitle(null, "C14")).toBe("C14");
  });

  it("never returns an empty label", () => {
    expect(buildTeradyneLogTitle(null, undefined)).toBe("(untitled entry)");
  });
});

describe("buildTeradyneEmployeeTitle", () => {
  it("joins first and last name", () => {
    expect(buildTeradyneEmployeeTitle("Dave", "Anderson")).toBe("Dave Anderson");
  });

  it("copes with one name missing without leaving a stray space", () => {
    expect(buildTeradyneEmployeeTitle("Dave", "")).toBe("Dave");
    expect(buildTeradyneEmployeeTitle("", "Anderson")).toBe("Anderson");
    expect(buildTeradyneEmployeeTitle(null, undefined)).toBe("");
  });
});

describe("reference-list mappers", () => {
  it("maps an employee, deriving the title when the column is blank", () => {
    const withTitle = toTeradyneEmployee(
      item({ Title: "Dave Anderson", First_Name: "Dave", Last_Name: "Anderson", ClockNum: 312, Work_Center: "COAT", IDEmp: 2 }, "2"),
    );
    expect(withTitle).toMatchObject({
      lookupId: 2,
      title: "Dave Anderson",
      clockNum: 312,
      workCenter: "COAT",
      idEmp: 2,
    });

    const noTitle = toTeradyneEmployee(item({ First_Name: "Sandy", Last_Name: "Bindas" }, "5"));
    expect(noTitle.title).toBe("Sandy Bindas");
    expect(noTitle.clockNum).toBeNull();
  });

  it("maps a product", () => {
    expect(toTeradyneProduct(item({ Title: "EX-4000 DA", TestOnStation: "Spea", IDProd: 208 }, "208"))).toEqual({
      lookupId: 208,
      title: "EX-4000 DA",
      testOnStation: "Spea",
      idProd: 208,
    });
  });

  it("maps a remark, including the IDRem 0 row that exists in the real data", () => {
    expect(toTeradyneRemark(item({ Title: "------", IDRem: 0 }, "3"))).toEqual({
      lookupId: 3,
      title: "------",
      idRem: 0,
    });
  });
});

describe("toTeradyneLogEntry", () => {
  const maps = buildTeradyneRefMaps(
    [{ lookupId: 201, title: "Moris Power Supply", testOnStation: "Spea", idProd: 201 }],
    [
      { lookupId: 8, title: "Melissa Fuentes", firstName: "Melissa", lastName: "Fuentes", clockNum: 88, workCenter: "PCB", idEmp: 9 },
    ],
    [{ lookupId: 4, title: "Wrong board", idRem: 4 }],
  );

  it("resolves lookup ids to titles (Graph only gives us the ids)", () => {
    const entry = toTeradyneLogEntry(
      item(
        {
          Title: "Moris Power Supply - U1",
          EnterDate: "2026-02-17T12:00:00Z",
          ProductLookupId: "201",
          Employee1LookupId: "8",
          RemarkLookupId: "4",
          Employee1Clock: 88,
          DefectiveParts: "U1",
          NumberOfBoards: 1,
          FailuresPerBoard: 1,
        },
        "4799",
      ),
      maps,
    );

    expect(entry.id).toBe(4799);
    expect(entry.product).toEqual({ lookupId: 201, title: "Moris Power Supply" });
    expect(entry.employee1).toEqual({ lookupId: 8, title: "Melissa Fuentes" });
    expect(entry.remark).toEqual({ lookupId: 4, title: "Wrong board" });
    expect(entry.employee2).toBeNull();
    expect(entry.employee1Clock).toBe(88);
    expect(entry.boardsTested).toBeNull();
    expect(entry.title).toBe("Moris Power Supply - U1");
  });

  it("labels a dangling lookup instead of silently reading as 'nothing selected'", () => {
    const entry = toTeradyneLogEntry(item({ ProductLookupId: "999" }), maps);
    expect(entry.product).toEqual({ lookupId: 999, title: "(missing #999)" });
  });

  it("derives the title for a row stored without one", () => {
    const entry = toTeradyneLogEntry(item({ ProductLookupId: "201", DefectiveParts: "R4" }), maps);
    expect(entry.title).toBe("Moris Power Supply - R4");
  });

  it("reads the Altronic part number out of the OldSAPNumber column", () => {
    const entry = toTeradyneLogEntry(
      item({ SAPNumber: "601999", OldSAPNumber: "672337-1" }),
      maps,
    );
    expect(entry.altronicPartNumber).toBe("672337-1");
    expect(entry.sapNumber).toBe("601999");
  });

  it("defaults absent text columns to empty strings, not undefined", () => {
    const entry = toTeradyneLogEntry(item({}), maps);
    expect(entry.sapNumber).toBe("");
    expect(entry.altronicPartNumber).toBe("");
    expect(entry.operatorNotes).toBe("");
    expect(entry.defectiveParts).toBe("");
    expect(entry.enterDate).toBeNull();
  });
});

describe("compareTeradyneLogEntries", () => {
  const mk = (id: number, date: string | null): TeradyneLogEntry =>
    ({ id, enterDate: date ? new Date(date) : null }) as TeradyneLogEntry;

  it("sorts newest date first", () => {
    const sorted = [mk(1, "2026-01-01T12:00:00Z"), mk(2, "2026-03-01T12:00:00Z")].sort(
      compareTeradyneLogEntries,
    );
    expect(sorted.map((e) => e.id)).toEqual([2, 1]);
  });

  it("breaks same-day ties by id, newest first", () => {
    const sorted = [mk(10, "2026-02-17T12:00:00Z"), mk(11, "2026-02-17T12:00:00Z")].sort(
      compareTeradyneLogEntries,
    );
    expect(sorted.map((e) => e.id)).toEqual([11, 10]);
  });

  it("pushes undated rows to the bottom, whichever side they start on", () => {
    const sorted = [mk(1, null), mk(2, "2026-02-01T12:00:00Z"), mk(3, null)].sort(
      compareTeradyneLogEntries,
    );
    expect(sorted[0].id).toBe(2);
    expect(sorted.slice(1).map((e) => e.id)).toEqual([3, 1]);
  });
});
