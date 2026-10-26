import { describe, expect, it } from "vitest";
import {
  MCN_ITEM_FIELDS,
  MCN_SELECT,
  parsePeopleLines,
  parseScopeLines,
  readAnswer,
  serializePeopleLines,
  serializeScopeLines,
} from "./mcnFields";

describe("the item descriptors", () => {
  it("cover the form's four Requires… and six Incorporate into lines", () => {
    expect(MCN_ITEM_FIELDS.filter((f) => f.group === "requires")).toHaveLength(4);
    expect(MCN_ITEM_FIELDS.filter((f) => f.group === "incorporate")).toHaveLength(6);
  });

  it("give Notify Customer no reference — the form has none", () => {
    expect(MCN_ITEM_FIELDS.find((f) => f.key === "notifyCustomer")?.referenceColumn).toBeUndefined();
  });

  it("have unique columns, every one of them in the $select", () => {
    const columns = MCN_ITEM_FIELDS.flatMap((f) => [f.answerColumn, f.referenceColumn].filter(Boolean)) as string[];
    expect(new Set(columns).size).toBe(columns.length);
    const selected = MCN_SELECT.split(",");
    for (const c of columns) expect(selected).toContain(c);
  });

  it("select BOTH halves of every single-person and lookup column", () => {
    const selected = MCN_SELECT.split(",");
    for (const c of ["OriginatedBy", "AssignedEngineer", "ApprovedBy", "OperationsTaskRef"]) {
      expect(selected).toContain(c);
      expect(selected).toContain(`${c}LookupId`);
    }
  });
});

describe("readAnswer", () => {
  it("reads Yes / No loosely, and anything else as unanswered — never as No", () => {
    expect(readAnswer("yes")).toBe("Yes");
    expect(readAnswer(" No ")).toBe("No");
    expect(readAnswer("")).toBe("");
    expect(readAnswer(null)).toBe("");
    expect(readAnswer("Maybe")).toBe("");
  });
});

describe("scope lines", () => {
  it("round-trip, dropping blank lines", () => {
    const stored = serializeScopeLines([
      { departmentId: 3, department: "MACH SHOP", process: " Machining ", equipment: "All CNC machines" },
      { departmentId: null, department: "", process: "", equipment: "" },
    ]);
    expect(parseScopeLines(stored)).toEqual({
      lines: [{ departmentId: 3, department: "MACH SHOP", process: "Machining", equipment: "All CNC machines" }],
      corrupt: false,
    });
  });

  it("store nothing for no lines", () => {
    expect(serializeScopeLines([])).toBe("");
    expect(parseScopeLines("")).toEqual({ lines: [], corrupt: false });
  });

  it("report a value that isn't the expected JSON as corrupt, never as empty", () => {
    expect(parseScopeLines("PCB / wave solder").corrupt).toBe(true);
    expect(parseScopeLines('{"a":1}').corrupt).toBe(true);
  });
});

describe("a list of people as lines", () => {
  it("keeps a 'Last, First' name whole — lines, not commas", () => {
    const stored = serializePeopleLines([
      { displayName: "Example, Morgan", email: "morgan.example@example.com" },
      { displayName: "Riley Sample", email: "Riley.Sample@example.com" },
    ]);
    expect(parsePeopleLines(stored)).toEqual([
      { displayName: "Example, Morgan", email: "morgan.example@example.com" },
      { displayName: "Riley Sample", email: "Riley.Sample@example.com" },
    ]);
  });

  it("drops people with no address and duplicates by address", () => {
    const stored = serializePeopleLines([
      { displayName: "No Mail" },
      { displayName: "A", email: "a@example.com" },
      { displayName: "A again", email: "A@example.com" },
    ]);
    expect(parsePeopleLines(stored)).toEqual([{ displayName: "A", email: "a@example.com" }]);
  });

  it("reads a bare address, and skips a line that isn't one", () => {
    expect(parsePeopleLines("x@example.com\nnot an address")).toEqual([
      { displayName: "x@example.com", email: "x@example.com" },
    ]);
  });
});
