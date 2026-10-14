import { describe, expect, it } from "vitest";
import type { SubAssemblyLine } from "@/types/pricing";
import { importSubAssemblyCsv, mergeUpload, parseCsvRows, parseSubAssemblyLines } from "./subAssemblyCsv";

function line(over: Partial<SubAssemblyLine> = {}): SubAssemblyLine {
  return { partNumber: "P1", description: "", quantity: 1, uploadedCost: 10, adjustedCost: null, ...over };
}

describe("parseCsvRows", () => {
  it("splits commas and lines", () => {
    expect(parseCsvRows("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles quoted fields with commas, newlines and doubled-quote escapes", () => {
    expect(parseCsvRows('"a,1","say ""hi""","two\nlines"\n')).toEqual([["a,1", 'say "hi"', "two\nlines"]]);
  });

  it("treats CRLF as one line break, and drops a leading BOM", () => {
    expect(parseCsvRows("﻿Part,Qty\r\nX,2\r\n")).toEqual([
      ["Part", "Qty"],
      ["X", "2"],
    ]);
  });

  it("keeps a trailing empty field, and reads nothing as no rows", () => {
    expect(parseCsvRows("a,")).toEqual([["a", ""]]);
    expect(parseCsvRows("")).toEqual([]);
  });
});

describe("importSubAssemblyCsv", () => {
  it("matches headers by name, in any order, with spelling slack", () => {
    const csv = "Quantity,Current Cost ($),Desc,Part #\n2,\"$1,234.50\",Board,791950-08\n";
    const out = importSubAssemblyCsv(csv);
    expect(out.errors).toEqual([]);
    expect(out.skipped).toEqual([]);
    expect(out.lines).toEqual([
      { partNumber: "791950-08", description: "Board", quantity: 2, uploadedCost: 1234.5, adjustedCost: null },
    ]);
  });

  it("accepts the other aliases (Part No / Unit Cost / Qty / Description)", () => {
    const out = importSubAssemblyCsv("Part No,Description,Unit Cost,Qty\nA,Thing,5,1");
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].uploadedCost).toBe(5);
  });

  it("REFUSES a file missing a column, naming it", () => {
    const out = importSubAssemblyCsv("Part Number,Description,Qty\nA,x,1");
    expect(out.lines).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatch(/no "Current Cost" column/);
  });

  it("names every missing column", () => {
    const out = importSubAssemblyCsv("Part Number\nA");
    expect(out.errors[0]).toContain('"Description", "Current Cost", "Qty"');
  });

  it("allows a blank cost (a part not costed yet)", () => {
    const out = importSubAssemblyCsv("Part,Description,Cost,Qty\nA,x,,3");
    expect(out.lines[0]).toEqual({ partNumber: "A", description: "x", quantity: 3, uploadedCost: null, adjustedCost: null });
  });

  it("skips bad rows by spreadsheet row number, imports the rest, and ignores blank rows", () => {
    const csv = [
      "Part,Description,Cost,Qty",
      "A,ok,1,1",
      ",no part,1,1",
      "B,bad qty,1,two",
      "C,zero qty,1,0",
      "",
      "D,bad cost,abc,1",
      "E,negative cost,-1,1",
      "F,ok,2,2",
    ].join("\n");
    const out = importSubAssemblyCsv(csv);
    expect(out.errors).toEqual([]);
    expect(out.lines.map((l) => l.partNumber)).toEqual(["A", "F"]);
    expect(out.skipped).toEqual([
      "Row 3: no part number.",
      'Row 4 (B): quantity "two" isn\'t a number above 0.',
      'Row 5 (C): quantity "0" isn\'t a number above 0.',
      'Row 6 (D): cost "abc" isn\'t a number.',
      'Row 7 (E): cost "-1" isn\'t a number.',
    ]);
  });

  it("refuses an empty file, and one with no usable rows", () => {
    expect(importSubAssemblyCsv("")).toEqual({ lines: [], errors: ["The file is empty."], skipped: [] });
    expect(importSubAssemblyCsv(" , \n")).toEqual({ lines: [], errors: ["The file is empty."], skipped: [] });
    const none = importSubAssemblyCsv("Part,Description,Cost,Qty\n,x,1,1");
    expect(none.lines).toEqual([]);
    expect(none.errors).toEqual(["No usable rows in the file.", "Row 2: no part number."]);
  });
});

describe("mergeUpload", () => {
  it("keeps each part's adjustment, matched case-insensitively, and reports what changed", () => {
    const previous = [
      line({ partNumber: "abc-1", uploadedCost: 10, adjustedCost: 12 }),
      line({ partNumber: "B", uploadedCost: 5, adjustedCost: null }),
      line({ partNumber: "GONE", uploadedCost: 1, adjustedCost: 2 }),
    ];
    const next = [
      line({ partNumber: " ABC-1 ", uploadedCost: 11 }),
      line({ partNumber: "B", uploadedCost: 5 }),
      line({ partNumber: "NEW", uploadedCost: 3 }),
    ];
    const { lines, changes } = mergeUpload(previous, next);
    expect(lines.map((l) => [l.partNumber, l.uploadedCost, l.adjustedCost])).toEqual([
      [" ABC-1 ", 11, 12],
      ["B", 5, null],
      ["NEW", 3, null],
    ]);
    expect(changes).toEqual({
      added: ["NEW"],
      removed: ["GONE"],
      costChanged: [{ partNumber: " ABC-1 ", from: 10, to: 11 }],
      keptAdjustments: 1,
    });
  });

  it("an upload into an empty sub-assembly adds everything", () => {
    const { changes } = mergeUpload([], [line({ partNumber: "A" })]);
    expect(changes).toEqual({ added: ["A"], removed: [], costChanged: [], keptAdjustments: 0 });
  });
});

describe("parseSubAssemblyLines", () => {
  it("reads blank as empty, not corrupt", () => {
    for (const raw of [null, undefined, "", "  "]) {
      expect(parseSubAssemblyLines(raw)).toEqual({ lines: [], corrupt: false });
    }
  });

  it("reads junk, a non-array and a non-string as CORRUPT", () => {
    for (const raw of ["{nope", '{"a":1}', 5]) {
      expect(parseSubAssemblyLines(raw)).toEqual({ lines: [], corrupt: true });
    }
  });

  it("normalises each line, dropping non-objects", () => {
    const raw = JSON.stringify([
      { partNumber: "A", description: "x", quantity: 2, uploadedCost: 3, adjustedCost: null },
      null,
      { partNumber: 7, quantity: "2", uploadedCost: "x" },
    ]);
    expect(parseSubAssemblyLines(raw)).toEqual({
      lines: [
        { partNumber: "A", description: "x", quantity: 2, uploadedCost: 3, adjustedCost: null },
        { partNumber: "", description: "", quantity: 0, uploadedCost: null, adjustedCost: null },
      ],
      corrupt: false,
    });
  });
});
