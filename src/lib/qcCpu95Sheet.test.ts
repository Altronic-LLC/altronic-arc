import { describe, expect, it } from "vitest";
import type { QcCpu95Record } from "@/types/task";
import { qcCpu95EmptyValues } from "./qcCpu95Fields";
import {
  POST_TEST_INSPECTION_POINTS,
  qcCpu95DefectLabels,
  qcCpu95IncludesInspectionPage,
  qcCpu95LogEntries,
  qcCpu95SheetLayout,
  sheetDate,
  type SheetOp,
} from "./qcCpu95Sheet";

// =============================================================================
// The QCFRM-012 paper sheet as a layout model. What's worth pinning is WHICH
// values reach paper: only what the record's Altmode shows, in the blank its
// paper column means — never a stale value on a field the edit form hides.
// =============================================================================

function record(values: Record<string, string>, id = 7): QcCpu95Record {
  return { id, values: { ...qcCpu95EmptyValues(), ...values }, createdAt: new Date(0), modifiedAt: new Date(0) };
}

type TextOp = Extract<SheetOp, { type: "text" }>;

function filledTexts(pages: ReturnType<typeof qcCpu95SheetLayout>, page = 0): TextOp[] {
  return pages[page].ops.filter((o): o is TextOp => o.type === "text" && !!o.filled);
}

function filledAt(pages: ReturnType<typeof qcCpu95SheetLayout>, y: number): string[] {
  return filledTexts(pages)
    .filter((o) => o.y === y)
    .sort((a, b) => a.x - b.x)
    .map((o) => o.text);
}

function printed(pages: ReturnType<typeof qcCpu95SheetLayout>, page = 0): string[] {
  return pages[page].ops.filter((o): o is TextOp => o.type === "text" && !o.filled).map((o) => o.text);
}

describe("the blank sheet", () => {
  const pages = qcCpu95SheetLayout(null, "2026-10-20");

  it("is the test sheet plus the Post Test Inspection page", () => {
    expect(pages).toHaveLength(2);
    expect(printed(pages)).toContain("CPU-95 IGNITION SYSTEM - IGNITION MODULE");
    expect(printed(pages)).toContain("FORM QCFRM-012  REV 2");
    expect(printed(pages, 1)).toContain("Post Test Inspection per QWI-342 and 791950 Print");
    for (const point of POST_TEST_INSPECTION_POINTS) expect(printed(pages, 1)).toContain(point);
  });

  it("writes nothing in — no values, no ticks, no export stamp", () => {
    for (const page of pages) {
      expect(page.ops.some((o) => o.type === "check" || o.type === "wrap")).toBe(false);
      expect(page.ops.some((o) => o.type === "text" && o.filled)).toBe(false);
    }
  });

  it("prints every cylinder column of the firing grid, 20 rows", () => {
    const text = printed(pages);
    expect(text).toEqual(expect.arrayContaining(["16", "18", "20", "G", "H", "AL", "NR"]));
    const specBlanks = pages[0].ops.filter((o) => o.type === "line" && o.x1 === 495);
    expect(specBlanks).toHaveLength(20);
  });
});

describe("a filled sheet", () => {
  it("writes the header in, with dates as MM/DD/YYYY", () => {
    const pages = qcCpu95SheetLayout(
      record({ serialNumber: "25564", altronicPartNumber: "791950-16", customer: "Example Co", dateTested: "2026-10-14" }),
      "2026-10-20",
    );
    const texts = filledTexts(pages).map((o) => o.text);
    expect(texts).toEqual(expect.arrayContaining(["25564", "791950-16", "Example Co", "10/14/2026"]));
    expect(texts).toContain("Exported from ARC on 10/20/2026 — test sheet #7");
  });

  it("ticks exactly the checklist items marked Yes", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-16", finalMultiFire: "Yes", finalTriacLeakage: "Yes", finalGndSD: "" }),
      "2026-10-20",
    );
    expect(pages[0].ops.filter((o) => o.type === "check")).toHaveLength(2);
  });

  it("puts the standard readings in the 20V and 24V blanks", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-16", startup20vE1: "132", startup24vE1: "135" }),
      "2026-10-20",
    );
    expect(filledAt(pages, 297)).toEqual(["132", "135"]);
  });

  it("puts a 791962/52-18 unit's readings in the same blanks, never a stale standard value", () => {
    const pages = qcCpu95SheetLayout(
      record({
        altronicPartNumber: "791962-18",
        startup20vE1: "999",
        startup20vE1Alt: "141",
        startup24vE1Alt: "143",
        finalE1_20v: "998",
        finalE1Alt_20v: "142",
      }),
      "2026-10-20",
    );
    expect(filledAt(pages, 297)).toEqual(["141", "143"]);
    expect(filledAt(pages, 453)).toEqual(["142"]);
    const texts = filledTexts(pages).map((o) => o.text);
    expect(texts).not.toContain("999");
    expect(texts).not.toContain("998");
    // The final tests then print the spec those readings were taken against.
    expect(printed(pages)).toContain("Peak volt E1 140 V (+10/-0)");
  });

  it("fills the firing grid of the unit's cylinder count, row by row", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-18", firingSpec18G: "135", firingActual18G: "135.5", firingSpec16G: "1" }),
      "2026-10-20",
    );
    // G is the 7th 18-cyl letter → row 6.
    expect(filledAt(pages, 375 + 6 * 13)).toEqual(["135", "135.5"]);
  });

  it("writes spec and actual in the TEST columns and leaves SHIP blank", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-16", firingSpec16A: "0", firingActual16A: "0.5" }),
      "2026-10-20",
    );
    const row = filledTexts(pages).filter((o) => o.y === 375);
    // TEST spec blank is x 495–525, TEST actual 733–765; SHIP is 531–565 / 772–810.
    expect(row.map((o) => [o.text, o.x])).toEqual([
      ["0", 510],
      ["0.5", 749],
    ]);
  });

  it("fills the 20-cyl grid for a 20-cyl unit and ignores the 16-cyl values", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-20", firingSpec20NR: "351", firingSpec16A: "5" }),
      "2026-10-20",
    );
    expect(filledAt(pages, 375 + 19 * 13)).toEqual(["351"]);
    expect(filledAt(pages, 375)).toEqual([]);
  });

  it("prints only rows A–L on an 8-cylinder 791950-08", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-08", firingSpec16L: "315", firingSpec16M: "9" }),
      "2026-10-20",
    );
    expect(filledAt(pages, 375 + 7 * 13)).toEqual(["315"]);
    expect(filledAt(pages, 375 + 8 * 13)).toEqual([]);
  });

  it("lists defects only when one is flagged", () => {
    const clean = qcCpu95SheetLayout(record({ altronicPartNumber: "791950-16" }), "2026-10-20");
    expect(printed(clean)).not.toContain("DEFECTS / NCM:");

    const flagged = record({ physicalDamage: "Yes", ncmVendor: "Yes" });
    expect(qcCpu95DefectLabels(flagged)).toEqual(["Physical Damage", "NCM Vendor"]);
    const pages = qcCpu95SheetLayout(flagged, "2026-10-20");
    const wrap = pages[0].ops.find((o) => o.type === "wrap" && o.title === "Defects / NCM");
    expect(wrap).toMatchObject({ text: "Physical Damage, NCM Vendor" });
  });

  it("hands the comments to the renderer to wrap, with a continuation title", () => {
    const pages = qcCpu95SheetLayout(record({ comments: "  Re-tested.  " }), "2026-10-20");
    expect(pages[0].ops.find((o) => o.type === "wrap")).toMatchObject({ text: "Re-tested.", title: "Comments" });
  });

  it("carries the Post Test Inspection page only for a 791950 part number", () => {
    expect(qcCpu95SheetLayout(record({ altronicPartNumber: "791950-08" }), "2026-10-20")).toHaveLength(2);
    expect(qcCpu95SheetLayout(record({ altronicPartNumber: " 791950-16-SS " }), "2026-10-20")).toHaveLength(2);
    expect(qcCpu95SheetLayout(record({ altronicPartNumber: "791962-18" }), "2026-10-20")).toHaveLength(1);
    expect(qcCpu95SheetLayout(record({ altronicPartNumber: "" }), "2026-10-20")).toHaveLength(1);
    expect(qcCpu95IncludesInspectionPage(null)).toBe(true);
  });

  it("names the unit on the inspection page, which ARC otherwise leaves blank", () => {
    const pages = qcCpu95SheetLayout(record({ serialNumber: "25564", altronicPartNumber: "791950-16" }), "2026-10-20");
    expect(filledTexts(pages, 1).map((o) => o.text)).toEqual([
      "SERIAL NUMBER: 25564      ALTRONIC PART NO.: 791950-16",
    ]);
  });
});

describe("the ON/OFF log entry", () => {
  it("is ON when the sheet was created and OFF when it was signed off", () => {
    const r = {
      ...record({ finalTestDate: "2026-10-15", finalInspectionDate: "2026-10-16" }),
      createdAt: new Date(2026, 9, 14, 7, 5),
    };
    expect(qcCpu95LogEntries(r)).toEqual({
      on: { date: "10/14/2026", time: "7:05 AM" },
      off: { date: "10/15/2026", time: "" },
    });
    const pages = qcCpu95SheetLayout(r, "2026-10-20");
    expect(filledAt(pages, 284)).toEqual(["10/14/2026", "7:05 AM"]);
    expect(filledAt(pages, 297)).toEqual(["10/15/2026"]);
    // The second ON/OFF pair stays blank.
    expect(filledAt(pages, 310)).toEqual([]);
    expect(filledAt(pages, 323)).toEqual([]);
  });

  it("falls back to the Final Inspection Date, and prints nothing it doesn't know", () => {
    expect(qcCpu95LogEntries(record({ finalInspectionDate: "2026-10-16" }))).toEqual({
      on: null, // createdAt is the mapper's epoch fallback
      off: { date: "10/16/2026", time: "" },
    });
    expect(qcCpu95LogEntries(record({}))).toEqual({ on: null, off: null });
    expect(qcCpu95LogEntries(null)).toEqual({ on: null, off: null });
  });
});

describe("sheetDate", () => {
  it("reads yyyy-mm-dd as MM/DD/YYYY and leaves anything else alone", () => {
    expect(sheetDate("2026-01-05")).toBe("01/05/2026");
    expect(sheetDate(" 5/1/26 ")).toBe("5/1/26");
  });
});
