import { describe, it, expect } from "vitest";
import { qcFormEmptyValues, type QcFormRecord } from "./qcFormEngine";
import { QC_GET1_FORM } from "./qcGet1Form";
import { QC_SERIES_X_FORM } from "./qcSeriesXForm";
import { GE_SHEET_CONTENT_BOTTOM, GE_SHEET_CONTENT_TOP } from "./qcGeLogSheet";
import type { SheetOp } from "./qcFormSheet";

// =============================================================================
// The GE log sheet, drawn for GET-1. Where each line and value lands, and how
// a check's answer reaches paper. The PDF itself is pinned in qcFormPdf.test.ts.
// =============================================================================

type TextOp = Extract<SheetOp, { type: "text" }>;

function record(values: Record<string, string>): QcFormRecord {
  return {
    id: 7,
    values: { ...qcFormEmptyValues(QC_GET1_FORM), ...values },
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };
}

const layout = (r: QcFormRecord | null) => QC_GET1_FORM.sheet.layout(r, "2026-10-26");
const ops = (r: QcFormRecord | null) => layout(r).flatMap((p) => p.ops);
const texts = (r: QcFormRecord | null) => ops(r).filter((o): o is TextOp => o.type === "text");
const textAt = (r: QcFormRecord | null, t: string) => texts(r).find((o) => o.text === t);

describe("the blank GET-1 sheet", () => {
  it("is one page with the paper's title, every check and every board", () => {
    expect(layout(null)).toHaveLength(1);
    const printed = texts(null).map((o) => o.text);
    expect(printed).toContain("GE Transportation Log Sheet");
    expect(printed).toContain("Quality Control Inspection");
    expect(printed).toContain("Verify Connector key-way orientation");
    expect(printed).toContain("672 255-1 WO#");
    expect(printed).toContain("Rev 3, 10-May-2016");
  });

  it("prints the 681 105 board as 105-3, as operators correct it", () => {
    const printed = texts(null).map((o) => o.text);
    expect(printed).toContain("681 105-3 WO#");
    expect(printed).not.toContain("681 105-2 WO#");
  });

  it("draws a tick box for the part number line and each of the fifteen checks", () => {
    expect(ops(null).filter((o) => o.type === "rect")).toHaveLength(16);
  });

  it("splits the serial with the paper's slash, and carries no entries or export stamp", () => {
    expect(textAt(null, "/")).toBeDefined();
    expect(texts(null).some((o) => o.filled)).toBe(false);
    expect(ops(null).some((o) => o.type === "check")).toBe(false);
  });

  it("runs down the page in the paper's order, inside the scan's content band", () => {
    const y = (t: string) => textAt(null, t)!.y;
    const order = [
      "Part Number (ECU)",
      "100% Inspection of Pins (Using Tool)",
      "Verify Ship Firmware Revision on PC",
      "Record Work Order numbers for following boards:  (2 WO#’s per board)",
      "672 255-1 WO#",
      "672 265-2 WO#",
      "QC Inspector",
      "Notes/Comments:",
      "GET-1",
    ].map(y);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const o of ops(null)) {
      const top = "y" in o ? o.y : o.y1;
      expect(top).toBeGreaterThanOrEqual(GE_SHEET_CONTENT_TOP);
      expect(top).toBeLessThanOrEqual(GE_SHEET_CONTENT_BOTTOM);
    }
  });

  it("puts each 681 board beside its 672 row", () => {
    expect(textAt(null, "681 100-1 WO#")!.y).toBe(textAt(null, "672 255-1 WO#")!.y);
    expect(textAt(null, "681 105-3 WO#")!.y).toBe(textAt(null, "672 265-2 WO#")!.y);
  });
});

describe("a filled GET-1 sheet", () => {
  const filled = record({
    serialNumber: "FM2601/0001T",
    partNumber: "17FM760D3",
    pinInspection: "Yes",
    usbSocket: "N/A",
    frameOrder: "No",
    shipFirmwareRevision: "4.2.1",
    wo681105: "602626",
    qcInspector: "JN",
    inspectionDate: "2026-01-12",
    notes: "Tested, SFI",
  });

  it("prints the serial whole, without the blank form's slash", () => {
    expect(textAt(filled, "FM2601/0001T")?.filled).toBe(true);
    expect(textAt(filled, "/")).toBeUndefined();
  });

  it("ticks a Yes in its box, and writes N/A or NO beside the box", () => {
    expect(ops(filled).filter((o) => o.type === "check")).toHaveLength(1);
    const pins = textAt(filled, "100% Inspection of Pins (Using Tool)")!;
    const tick = ops(filled).find((o) => o.type === "check")!;
    expect("y" in tick && tick.y).toBe(pins.y);
    expect(textAt(filled, "N/A")).toMatchObject({ filled: true, align: "right" });
    expect(textAt(filled, "NO")).toMatchObject({ filled: true, align: "right" });
  });

  it("writes the firmware revision, a board's work order, the inspector and the date", () => {
    expect(textAt(filled, "4.2.1")!.y).toBe(textAt(filled, "Verify Ship Firmware Revision on PC")!.y);
    expect(textAt(filled, "602626")!.y).toBe(textAt(filled, "681 105-3 WO#")!.y);
    expect(textAt(filled, "JN")?.filled).toBe(true);
    expect(textAt(filled, "01/12/2026")?.filled).toBe(true);
  });

  it("wraps the notes on the three note lines, and stamps the export", () => {
    const wrap = ops(filled).find((o) => o.type === "wrap");
    expect(wrap).toMatchObject({ text: "Tested, SFI", maxLines: 3, title: "Notes/Comments:" });
    expect(texts(filled).some((o) => o.text === "Exported from ARC on 10/26/2026 — log sheet #7")).toBe(true);
  });
});

// =============================================================================
// The same paper for QCFRM-035 (Series X): a two-line title, its own boards,
// the printed "No populated VD board." line, and its own spacing.
// =============================================================================

const sx = (r: QcFormRecord | null) => QC_SERIES_X_FORM.sheet.layout(r, "2026-10-28").flatMap((p) => p.ops);
const sxTexts = (r: QcFormRecord | null) => sx(r).filter((o): o is TextOp => o.type === "text");
const sxAt = (r: QcFormRecord | null, t: string) => sxTexts(r).find((o) => o.text === t);
const sxRecord = (values: Record<string, string>): QcFormRecord => ({
  id: 9,
  values: { ...qcFormEmptyValues(QC_SERIES_X_FORM), ...values },
  createdAt: new Date(0),
  modifiedAt: new Date(0),
});

describe("the blank Series X sheet", () => {
  it("prints the title on two lines, then the subtitle, then the Part Number line", () => {
    const first = sxAt(null, "Series X Controller GE Transportation")!;
    const second = sxAt(null, "Log Sheet")!;
    const subtitle = sxAt(null, "Quality Control Inspection")!;
    const part = sxAt(null, "Part Number (ECU)")!;
    expect(first.y).toBeLessThan(second.y);
    expect(second.y).toBeLessThan(subtitle.y);
    expect(subtitle.y).toBeLessThan(part.y);
  });

  it("prints its own boards, 105-3 for the 681 105, and the VD line with no blank", () => {
    const printed = sxTexts(null).map((o) => o.text);
    expect(printed).toEqual(expect.arrayContaining(["672 007-1 WO#", "672 005-1 WO#", "681 138-1 WO#", "681 105-3 WO#"]));
    expect(printed).not.toContain("681 105-2 WO#");
    expect(printed).not.toContain("672 256-1 WO#");
    const vd = sxAt(null, "No populated VD board.")!;
    expect(vd.y).toBe(sxAt(null, "672 005-1 WO#")!.y);
    const lines = sx(null).filter((o) => o.type === "line" && "y1" in o && o.y1 === vd.y + 2 && o.x1 > vd.x);
    expect(lines).toHaveLength(0);
  });

  it("puts each 681 board beside its 672 row", () => {
    expect(sxAt(null, "681 100-1 WO#")!.y).toBe(sxAt(null, "672 255-1 WO#")!.y);
    expect(sxAt(null, "681 105-3 WO#")!.y).toBe(sxAt(null, "672 265-2 WO#")!.y);
  });

  it("draws the Part Number box and fifteen check boxes, inside the content band, with its footer", () => {
    expect(sx(null).filter((o) => o.type === "rect")).toHaveLength(16);
    expect(sxAt(null, "QCFRM 035 Rev 0")).toBeDefined();
    for (const o of sx(null)) {
      const top = "y" in o ? o.y : o.y1;
      expect(top).toBeGreaterThanOrEqual(GE_SHEET_CONTENT_TOP);
      expect(top).toBeLessThanOrEqual(GE_SHEET_CONTENT_BOTTOM);
    }
    // The notes' last ruled line sits clear of the footer.
    const notesLines = sx(null).filter((o) => o.type === "line" && "y1" in o && o.y1 > sxAt(null, "Notes/Comments:")!.y - 1);
    expect(Math.max(...notesLines.map((o) => ("y1" in o ? o.y1 : 0)))).toBeLessThan(sxAt(null, "QCFRM 035 Rev 0")!.y);
  });
});

describe("a filled Series X sheet", () => {
  it("writes each board's work order on its row, and leaves the VD line alone", () => {
    const filled = sxRecord({ serialNumber: "FM2510/0024T", wo681138: "1738702", wo681104: "1711961" });
    expect(sxAt(filled, "1738702")!.y).toBe(sxAt(filled, "681 138-1 WO#")!.y);
    expect(sxAt(filled, "1711961")!.y).toBe(sxAt(filled, "681 104-1 WO#")!.y);
    expect(sxAt(filled, "FM2510/0024T")?.filled).toBe(true);
  });
});
