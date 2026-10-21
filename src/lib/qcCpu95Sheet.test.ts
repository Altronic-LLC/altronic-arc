import { describe, expect, it } from "vitest";
import type { QcCpu95Record } from "@/types/task";
import { qcCpu95EmptyValues } from "./qcCpu95Fields";
import {
  POST_TEST_INSPECTION_POINTS,
  QC_CPU95_BLANK_VARIANTS,
  qcCpu95DefectLabels,
  qcCpu95LogEntries,
  qcCpu95SheetLayout,
  qcCpu95VariantLines,
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

describe("a blank sheet for one unit", () => {
  const forUnit = (id: string) => qcCpu95SheetLayout(null, "2026-10-20", id);
  const letterRows = (pages: ReturnType<typeof qcCpu95SheetLayout>) =>
    pages[0].ops.filter((o) => o.type === "line" && o.x1 === 495).length;

  it("offers every unit type", () => {
    expect(QC_CPU95_BLANK_VARIANTS.map((v) => v.id)).toEqual(["16", "8", "18", "20", "highVolt", "791956", "95c", "evs"]);
  });

  it("prints only the unit's firing rows and grid column, headed by its cylinder count", () => {
    expect(letterRows(forUnit("8"))).toBe(8);
    expect(letterRows(forUnit("16"))).toBe(16);
    expect(letterRows(forUnit("18"))).toBe(18);
    expect(letterRows(forUnit("20"))).toBe(20);
    const eight = printed(forUnit("8"));
    expect(eight).toContain("8");
    expect(eight).not.toContain("AL");
    expect(printed(forUnit("20"))).toContain("AL");
    expect(printed(forUnit("20"))).not.toContain("16");
  });

  it("writes nothing in, but marks the lines the unit doesn't use N/A, in print", () => {
    const c95 = forUnit("95c");
    expect(c95[0].ops.some((o) => o.type === "text" && o.filled)).toBe(false);
    // The 11 base checks a 95C hasn't got: their tick blanks read N/A.
    expect(printed(c95).filter((t) => t === "N/A").length).toBeGreaterThanOrEqual(10);
    expect(printed(forUnit("16")).filter((t) => t === "N/A")).toEqual([]);
  });

  it("gives a 95C and an EVS a tick line for each check of their own", () => {
    const c95 = printed(forUnit("95c"));
    expect(c95).toEqual(expect.arrayContaining(["CPU-95C:", "Display Ready", "Mag Cal", "110 RPM timing", "APPLICATION"]));
    const evs = printed(forUnit("evs"));
    expect(evs).toEqual(expect.arrayContaining(["CPU-95 EVS:", "Six energy levels", "CAVG"]));
  });

  it("prints the 791956-16 lines only on a 791956-16 sheet", () => {
    const line = "On 791956-16 verify CAN communication.";
    expect(printed(forUnit("791956"))).toContain(line);
    expect(printed(forUnit("16"))).not.toContain(line);
    expect(printed(qcCpu95SheetLayout(null, "2026-10-20"))).toContain(line);
  });

  it("names the unit in the footer, and prints a single part number in the header", () => {
    expect(printed(forUnit("95c"))).toEqual(expect.arrayContaining(["For CPU-95C (791955-16)", "791955-16"]));
    expect(printed(forUnit("20"))).not.toContain("791950-20");
    expect(printed(forUnit("20"))).toContain("For 791950-20 / 791962-20, 20 cylinder");
  });

  it("prints the unit's standard TEST spec, in black, and none where there's no standard", () => {
    const specColumn = (pages: ReturnType<typeof qcCpu95SheetLayout>) =>
      pages[0].ops
        .filter((o): o is TextOp => o.type === "text" && o.x === 510)
        .sort((a, b) => a.y - b.y)
        .map((o) => (o.filled ? "filled" : o.text));
    expect(specColumn(forUnit("95c"))).toEqual(
      ["0", "60", "90", "150", "180", "240", "270", "330", "0", "60", "90", "150", "180", "240", "270", "330"],
    );
    expect(specColumn(forUnit("8"))).toEqual(["0", "90", "180", "270", "0", "90", "180", "270"]);
    expect(specColumn(forUnit("highVolt"))).toHaveLength(18);
    expect(specColumn(forUnit("20"))).toEqual([]);
    expect(specColumn(forUnit("evs"))).toEqual([]);
    expect(specColumn(qcCpu95SheetLayout(null, "2026-10-20"))).toEqual([]);
  });

  it("is the every-variant sheet for an unknown id", () => {
    expect(forUnit("nope")).toEqual(qcCpu95SheetLayout(null, "2026-10-20"));
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

  it("puts a 791962/52-18 unit's readings in the 20V/24V blanks, against the 140 V spec", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791962-18", startup20vE1: "141", startup24vE1: "143", finalE1_20v: "142" }),
      "2026-10-20",
    );
    expect(filledAt(pages, 297)).toEqual(["141", "143"]);
    expect(filledAt(pages, 453)).toEqual(["142"]);
    // A sheet for one unit prints its own spec on the left, start-up and final
    // alike, and drops the "791962-18 and 791952-18 Units only" column; only
    // the every-variant blank keeps that column.
    const at140 = (p: typeof pages) => printed(p).filter((t) => t === "Peak volt E1 140 V (+10/-0)").length;
    expect(at140(pages)).toBe(2);
    expect(printed(pages)).not.toContain("791952-18 Units only");
    const standard = qcCpu95SheetLayout(record({ altronicPartNumber: "791950-16", finalE1_20v: "131" }), "2026-10-20");
    expect(at140(standard)).toBe(0);
    expect(at140(qcCpu95SheetLayout(null, "2026-10-20"))).toBe(1);
  });

  it("fills the firing rows in slot order on the unit's grid", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-18", firingSpec07: "135", firingActual07: "135.5" }),
      "2026-10-20",
    );
    // Slot 7 is the 18-cyl grid's G, row 6.
    expect(filledAt(pages, 375 + 6 * 13)).toEqual(["135", "135.5"]);
  });

  it("writes spec and actual in the TEST columns and leaves SHIP blank", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-16", firingSpec01: "0", firingActual01: "0.5" }),
      "2026-10-20",
    );
    const row = filledTexts(pages).filter((o) => o.y === 375);
    // TEST spec blank is x 495–525, TEST actual 733–765; SHIP is 531–565 / 772–810.
    expect(row.map((o) => [o.text, o.x])).toEqual([
      ["0", 510],
      ["0.5", 749],
    ]);
  });

  it("fills all 20 rows for a 20-cyl unit", () => {
    const pages = qcCpu95SheetLayout(record({ altronicPartNumber: "791950-20", firingSpec20: "351" }), "2026-10-20");
    expect(filledAt(pages, 375 + 19 * 13)).toEqual(["351"]);
  });

  it("prints only the first 8 rows on an 8-cylinder 791950-08", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-08", firingSpec08: "315", firingSpec09: "9" }),
      "2026-10-20",
    );
    expect(filledAt(pages, 375 + 7 * 13)).toEqual(["315"]);
    expect(filledAt(pages, 375 + 8 * 13)).toEqual([]);
  });

  it("draws the at-spec line down the actual column, and prints no actuals, when all are at spec", () => {
    const at = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-08", firingActualsAtSpec: "Yes", firingSpec01: "0", firingActual01: "7" }),
      "2026-10-20",
    );
    const line = at[0].ops.find((o) => o.type === "line" && o.x1 === 749 && o.x2 === 749);
    expect(line).toMatchObject({ y1: 367, y2: 375 + 7 * 13 });
    expect(filledAt(at, 375)).toEqual(["0"]);

    const off = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-08", firingActualsAtSpec: "No", firingSpec01: "0", firingActual01: "7" }),
      "2026-10-20",
    );
    expect(off[0].ops.some((o) => o.type === "line" && o.x1 === 749 && o.x2 === 749)).toBe(false);
    expect(filledAt(off, 375)).toEqual(["0", "7"]);
  });

  it("ticks a Yes check and writes No and N/A in words", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-16", finalMultiFire: "Yes", finalTriacLeakage: "N/A", finalDiodeLeakage: "No" }),
      "2026-10-20",
    );
    expect(pages[0].ops.filter((o) => o.type === "check")).toHaveLength(1);
    expect(filledTexts(pages).map((o) => o.text)).toEqual(expect.arrayContaining(["N/A", "NO"]));
  });

  it("fills Memory No., or Application on a CPU-95C", () => {
    const base = qcCpu95SheetLayout(record({ altronicPartNumber: "791950-16", memoryNumber: "T4P180" }), "2026-10-20");
    expect(printed(base)).toContain("MEMORY NO.");
    expect(filledAt(base, 120)).toContain("T4P180");

    const c95 = qcCpu95SheetLayout(record({ altronicPartNumber: "791955-16", application: "3516", memoryNumber: "X" }), "2026-10-20");
    expect(printed(c95)).toContain("APPLICATION");
    expect(filledAt(c95, 120)).toContain("3516");
    expect(filledTexts(c95).map((o) => o.text)).not.toContain("X");
  });

  it("prints the CPU-95C checks the sheet has no line for above Comments", () => {
    const r = record({ altronicPartNumber: "791955-16", application: "3516", startupDisplayReady: "Yes", finalMagCal: "N/A", physicalDamage: "Yes" });
    // Application prints in the header, not here.
    expect(qcCpu95VariantLines(r)).toEqual(["Display Ready: Yes", "Mag Cal: N/A"]);
    const pages = qcCpu95SheetLayout(r, "2026-10-20");
    expect(printed(pages)).toContain("CPU-95C:");
    expect(pages[0].ops.find((o) => o.type === "wrap" && o.title === "CPU-95C checks")).toMatchObject({ text: "Display Ready: Yes; Mag Cal: N/A", maxLines: 1 });
    expect(pages[0].ops.find((o) => o.type === "wrap" && o.title === "Defects / NCM")).toMatchObject({ text: "Physical Damage" });
  });

  it("gives the CPU-95C checks two lines when there are no defects", () => {
    const pages = qcCpu95SheetLayout(record({ altronicPartNumber: "791955-16", startupDisplayReady: "Yes" }), "2026-10-20");
    expect(pages[0].ops.find((o) => o.type === "wrap" && o.title === "CPU-95C checks")).toMatchObject({ maxLines: 2 });
  });

  it("prints an EVS unit's E1 currents and six-level check, and labels its counts CAVG", () => {
    const r = record({ altronicPartNumber: "791963-16A", startupE1SupplyCurrent: "1.4", finalSixEnergyLevels: "Yes" });
    expect(qcCpu95VariantLines(r)).toEqual(["E1 current (start-up): 1.4", "Six energy levels: Yes"]);
    const pages = qcCpu95SheetLayout(r, "2026-10-20");
    expect(printed(pages)).toContain("CAVG");
    expect(printed(pages)).toContain("CPU-95 EVS:");
    expect(qcCpu95VariantLines(record({ altronicPartNumber: "791950-16", startupE1SupplyCurrent: "1.4" }))).toEqual([]);
  });

  it("marks the Post Test Inspection: Yes and No in their columns, N/A in words", () => {
    const pages = qcCpu95SheetLayout(
      record({ altronicPartNumber: "791950-16", inspLabelMatches: "Yes", inspGasket: "No", inspClean: "N/A" }),
      "2026-10-20",
    );
    const checks = pages[1].ops.filter((o) => o.type === "check");
    expect(checks.map((o) => (o as { x: number }).x)).toEqual([117, 176]);
    expect(filledTexts(pages, 1).map((o) => o.text)).toContain("N/A");
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

  it("carries the Post Test Inspection page for every unit", () => {
    for (const pn of ["791950-08", "791962-18", "791955-16", ""]) {
      const pages = qcCpu95SheetLayout(record({ altronicPartNumber: pn }), "2026-10-20");
      expect(pages).toHaveLength(2);
      expect(printed(pages, 1)).toContain("Post Test Inspection per QWI-342 and 791950 Print");
    }
  });

  it("ticks a 791956-16 check only on a 791956-16 sheet", () => {
    const values = { final791956CanComm: "Yes" };
    const checks = (pn: string) =>
      qcCpu95SheetLayout(record({ ...values, altronicPartNumber: pn }), "2026-10-20")[0].ops.filter(
        (o) => o.type === "check",
      ).length;
    expect(checks("791956-16")).toBe(1);
    expect(checks("791962-18")).toBe(0);
  });

  it("names the unit on the inspection page, which ARC otherwise leaves blank", () => {
    const pages = qcCpu95SheetLayout(record({ serialNumber: "25564", altronicPartNumber: "791950-16" }), "2026-10-20");
    expect(filledTexts(pages, 1).map((o) => o.text)).toEqual([
      "SERIAL NUMBER: 25564      ALTRONIC PART NO.: 791950-16",
    ]);
  });
});

describe("the ON/OFF log entry", () => {
  it("is the oven ON and OFF the operator recorded", () => {
    const r = record({ ovenOn: "2026-10-14T07:05", ovenOff: "2026-10-15T13:40", finalTestDate: "2026-10-16" });
    expect(qcCpu95LogEntries(r)).toEqual({
      on: { date: "10/14/2026", time: "7:05 AM" },
      off: { date: "10/15/2026", time: "1:40 PM" },
    });
    const pages = qcCpu95SheetLayout(r, "2026-10-20");
    expect(filledAt(pages, 284)).toEqual(["10/14/2026", "7:05 AM"]);
    expect(filledAt(pages, 297)).toEqual(["10/15/2026", "1:40 PM"]);
    // The second ON/OFF pair is for a re-run in the oven: printed, left blank.
    expect(filledAt(pages, 310)).toEqual([]);
    expect(filledAt(pages, 323)).toEqual([]);
    expect(printed(pages).filter((t) => t === "ON:" || t === "OFF:")).toEqual(["ON:", "OFF:", "ON:", "OFF:"]);
  });

  it("prints nothing it wasn't told — not the created or sign-off date", () => {
    expect(qcCpu95LogEntries(record({ finalTestDate: "2026-10-16" }))).toEqual({ on: null, off: null });
    expect(qcCpu95LogEntries(record({ ovenOn: "2026-10-14T12:00" }))).toEqual({
      on: { date: "10/14/2026", time: "12:00 PM" },
      off: null,
    });
    expect(qcCpu95LogEntries(null)).toEqual({ on: null, off: null });
  });
});

describe("sheetDate", () => {
  it("reads yyyy-mm-dd as MM/DD/YYYY and leaves anything else alone", () => {
    expect(sheetDate("2026-01-05")).toBe("01/05/2026");
    expect(sheetDate(" 5/1/26 ")).toBe("5/1/26");
  });
});
