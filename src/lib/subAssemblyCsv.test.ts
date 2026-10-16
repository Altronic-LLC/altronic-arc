import { describe, expect, it } from "vitest";
import type { SubAssemblyLine } from "@/types/pricing";
import { importSubAssemblyCsv, lineKey, mergeUpload, parseCsvRows, parseSubAssemblyLines } from "./subAssemblyCsv";

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
      { partNumber: "791950-08", sapPartNumber: "", description: "Board", quantity: 2, uploadedCost: 1234.5, adjustedCost: null, source: "csv" },
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
    expect(out.lines[0]).toEqual({ partNumber: "A", sapPartNumber: "", description: "x", quantity: 3, uploadedCost: null, adjustedCost: null, source: "csv" });
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
      // Named trimmed — the label a person reads.
      costChanged: [{ partNumber: "ABC-1", from: 10, to: 11 }],
      keptAdjustments: 1,
      keptManual: 0,
    });
  });

  it("an upload into an empty sub-assembly adds everything", () => {
    const { changes } = mergeUpload([], [line({ partNumber: "A" })]);
    expect(changes).toEqual({ added: ["A"], removed: [], costChanged: [], keptAdjustments: 0, keptManual: 0 });
  });
});

describe("mergeUpload — components added by hand", () => {
  it("keeps a hand-added component the file doesn't carry, after the file's lines, and counts it", () => {
    const previous = [
      line({ partNumber: "CSV-1", uploadedCost: 10 }),
      line({ partNumber: "HAND-1", uploadedCost: 4, adjustedCost: 3, source: "manual" }),
    ];
    const { lines, changes } = mergeUpload(previous, [line({ partNumber: "CSV-1", uploadedCost: 10, source: "csv" })]);
    expect(lines.map((l) => [l.partNumber, l.source, l.adjustedCost])).toEqual([
      ["CSV-1", "csv", null],
      ["HAND-1", "manual", 3],
    ]);
    expect(changes.keptManual).toBe(1);
    // A hand-added line is not the file's to remove.
    expect(changes.removed).toEqual([]);
  });

  it("lets the file take over a hand-added part number it now carries, adjustment and all", () => {
    const previous = [line({ partNumber: "P9", uploadedCost: 4, adjustedCost: 3, source: "manual" })];
    const { lines, changes } = mergeUpload(previous, [line({ partNumber: "p9", uploadedCost: 5, source: "csv" })]);
    expect(lines).toEqual([expect.objectContaining({ partNumber: "p9", source: "csv", uploadedCost: 5, adjustedCost: 3 })]);
    expect(changes.keptManual).toBe(0);
  });
});

describe("parseSubAssemblyLines — source", () => {
  it("reads a manual line as manual, and a line saved before sources existed as csv", () => {
    const raw = JSON.stringify([
      { partNumber: "A", description: "", quantity: 1, uploadedCost: 1, adjustedCost: null, source: "manual" },
      { partNumber: "B", description: "", quantity: 1, uploadedCost: 1, adjustedCost: null },
    ]);
    expect(parseSubAssemblyLines(raw).lines.map((l) => l.source)).toEqual(["manual", "csv"]);
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
        { partNumber: "A", sapPartNumber: "", description: "x", quantity: 2, uploadedCost: 3, adjustedCost: null, source: "csv" },
        { partNumber: "", sapPartNumber: "", description: "", quantity: 0, uploadedCost: null, adjustedCost: null, source: "csv" },
      ],
      corrupt: false,
    });
  });
});

describe("SAP part numbers on components (Ray, 2026-10-13)", () => {
  it("reads an SAP Part Number column beside the Altronic one", () => {
    const out = importSubAssemblyCsv("Part Number,SAP Part Number,Description,Current Cost,Qty\nA1,1003-0001-00,X,2,1\n");
    expect(out.lines[0]).toEqual(expect.objectContaining({ partNumber: "A1", sapPartNumber: "1003-0001-00" }));
  });

  it("imports a file with ONLY an SAP number column", () => {
    const out = importSubAssemblyCsv("SAP #,Description,Cost,Qty\n1003-0001-00,X,2,1\n");
    expect(out.errors).toEqual([]);
    expect(out.lines[0]).toEqual(expect.objectContaining({ partNumber: "", sapPartNumber: "1003-0001-00" }));
  });

  it("refuses a file with neither number column, naming both", () => {
    const out = importSubAssemblyCsv("Description,Current Cost,Qty\nX,2,1\n");
    expect(out.errors[0]).toContain('"Part Number" or "SAP Part Number"');
  });

  it("a row is kept if it has either number, skipped if it has neither", () => {
    const out = importSubAssemblyCsv("Part Number,SAP Part Number,Description,Current Cost,Qty\n,9999,X,2,1\n,,Y,2,1\n");
    expect(out.lines.map((l) => l.sapPartNumber)).toEqual(["9999"]);
    expect(out.skipped).toEqual(["Row 3: no part number."]);
  });

  it("a re-upload matches a component with no Altronic number by its SAP number", () => {
    const previous = [{ partNumber: "", sapPartNumber: "9999", description: "", quantity: 1, uploadedCost: 5, adjustedCost: 4, source: "csv" as const }];
    const { lines } = mergeUpload(previous, [
      { partNumber: "", sapPartNumber: "9999", description: "", quantity: 1, uploadedCost: 6, adjustedCost: null, source: "csv" },
    ]);
    expect(lines[0].adjustedCost).toBe(4);
    expect(lineKey(previous[0])).toBe("sap:9999");
  });
});