import type { jsPDF } from "jspdf";
import type { QcCpu95Record } from "@/types/task";
import { QC_CPU95_BLANK_VARIANTS, qcCpu95SheetLayout, SHEET_WIDTH, type SheetFont, type SheetOp } from "./qcCpu95Sheet";

// =============================================================================
// QCFRM-012 (CPU-95) → a PDF of the paper sheet. Draws the layout model from
// `qcCpu95Sheet.ts` with jsPDF, which is DYNAMICALLY imported so it stays out
// of the main bundle (the quote PDF's arrangement).
//
// Real, selectable text in the built-in fonts: Times for the form's own print
// (close to the paper's serif), Helvetica in dark blue for the values ARC
// fills in, so a reader can tell the record's entries from the printed form.
// =============================================================================

const SCALE = 612 / SHEET_WIDTH; // scan pixels → Letter points (8.5in = 612pt)
const PAGE_W = 612;
const PAGE_H = 792;
const INK: [number, number, number] = [20, 20, 20];
const ENTRY: [number, number, number] = [25, 55, 140];

export interface QcCpu95PdfOptions {
  /** `yyyy-mm-dd`; printed on a filled export. */
  exportedOn: string;
  /** A blank form for one unit (`QC_CPU95_BLANK_VARIANTS` id); omitted = every variant. */
  blankVariantId?: string | null;
  /** Tests turn this off to read the text back out of the PDF. */
  compress?: boolean;
}

/**
 * "QCFRM-012 CPU-95 blank.pdf" (or "… CPU-95C blank.pdf" for one unit), or
 * "QCFRM-012 CPU-95 25564.pdf" for a filled sheet.
 */
export function qcCpu95PdfFileName(record: QcCpu95Record | null, blankVariantId?: string | null): string {
  if (!record) {
    const variant = QC_CPU95_BLANK_VARIANTS.find((v) => v.id === blankVariantId);
    return variant ? `QCFRM-012 ${variant.fileTag} blank.pdf` : "QCFRM-012 CPU-95 blank.pdf";
  }
  const serial = (record.values.serialNumber ?? "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return `QCFRM-012 CPU-95 ${serial || `sheet ${record.id}`}.pdf`;
}

// The built-in fonts only encode WinAnsi. A typed value can hold anything,
// and an unencodable character prints as garbage — so map the one Greek
// letter this form uses (μ → the micro sign) and replace the rest.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function toWinAnsi(text: string): string {
  return Array.from(text.replace(/μ/g, "µ"))
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 9) return " ";
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) return ch;
      return "?";
    })
    .join("");
}

// Horizontal positions keep the scan's scale. VERTICAL positions stretch the
// scan's content band (title to export stamp) over the page between the
// margins: the paper leaves a fifth of the page empty at the bottom (Tim,
// 2026-10-20: "way too much padding"), and the room goes to the gaps between
// lines, which is where people write. Only positions move — text keeps its
// size, so nothing is distorted.
const CONTENT_TOP_PX = 66;
const CONTENT_BOTTOM_PX = 1034;
const MARGIN_TOP_PT = 32;
const MARGIN_BOTTOM_PT = 28;
const Y_SCALE = (PAGE_H - MARGIN_TOP_PT - MARGIN_BOTTOM_PT) / (CONTENT_BOTTOM_PX - CONTENT_TOP_PX);

const P = (px: number) => px * SCALE;
/** A y position on the scan → points on the page. */
const Y = (px: number) => MARGIN_TOP_PT + (px - CONTENT_TOP_PX) * Y_SCALE;

function setFont(doc: jsPDF, font: SheetFont, size: number, filled: boolean) {
  doc.setFont(filled ? "helvetica" : "times", font);
  doc.setFontSize(size);
  doc.setTextColor(...(filled ? ENTRY : INK));
}

interface Overflow {
  title: string;
  text: string;
}

function drawOp(doc: jsPDF, op: SheetOp, overflow: Overflow[], continuationPage: () => number): void {
  switch (op.type) {
    case "line":
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.5);
      doc.line(P(op.x1), Y(op.y1), P(op.x2), Y(op.y2));
      return;
    case "rect":
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.8);
      if (op.fill) {
        doc.setFillColor(217, 217, 217);
        doc.rect(P(op.x), Y(op.y), P(op.w), op.h * Y_SCALE, "F");
      } else {
        doc.rect(P(op.x), Y(op.y), P(op.w), op.h * Y_SCALE);
      }
      return;
    case "check":
      doc.setDrawColor(...ENTRY);
      doc.setLineWidth(0.9);
      doc.line(P(op.x - 5), Y(op.y - 4), P(op.x - 1.5), Y(op.y));
      doc.line(P(op.x - 1.5), Y(op.y), P(op.x + 6), Y(op.y - 9));
      return;
    case "text": {
      const size = op.size ?? 8;
      setFont(doc, op.font ?? "normal", size, !!op.filled);
      const t = toWinAnsi(op.text);
      doc.text(t, P(op.x), Y(op.y), { align: op.align ?? "left" });
      if (op.underline) {
        const w = doc.getTextWidth(t);
        const x = op.align === "center" ? P(op.x) - w / 2 : op.align === "right" ? P(op.x) - w : P(op.x);
        doc.setDrawColor(...INK);
        doc.setLineWidth(0.5);
        doc.line(x, Y(op.y) + 1.2, x + w, Y(op.y) + 1.2);
      }
      return;
    }
    case "wrap": {
      setFont(doc, "normal", 8, true);
      const t = toWinAnsi(op.text);
      const lines = doc.splitTextToSize(t, P(op.width)) as string[];
      let shown = lines;
      if (lines.length > op.maxLines) {
        overflow.push({ title: op.title, text: t });
        shown = [...lines.slice(0, op.maxLines - 1), `(continued on page ${continuationPage()})`];
      }
      shown.forEach((line, i) => doc.text(line, P(op.x), Y(op.y + i * op.lineHeight)));
      return;
    }
  }
}

/** Anything that didn't fit on the sheet, in full, on as many pages as it takes. */
function drawContinuation(doc: jsPDF, overflow: Overflow[], heading: string) {
  doc.addPage();
  let y = 60;
  setFont(doc, "bold", 11, false);
  doc.text(toWinAnsi(heading), 54, y);
  y += 24;
  for (const block of overflow) {
    setFont(doc, "bold", 9, false);
    doc.text(toWinAnsi(block.title), 54, y);
    y += 14;
    setFont(doc, "normal", 9, true);
    for (const line of doc.splitTextToSize(block.text, PAGE_W - 108) as string[]) {
      if (y > PAGE_H - 54) {
        doc.addPage();
        y = 60;
      }
      doc.text(line, 54, y);
      y += 12;
    }
    y += 12;
  }
}

/** Build the jsPDF document. Exported so tests can read the uncompressed output. */
export async function buildQcCpu95PdfDocument(
  record: QcCpu95Record | null,
  opts: QcCpu95PdfOptions,
): Promise<jsPDF> {
  const { jsPDF: JsPdf } = await import("jspdf");
  const doc = new JsPdf({ orientation: "portrait", unit: "pt", format: "letter", compress: opts.compress ?? true });
  renderQcCpu95Pdf(doc, record, opts);
  return doc;
}

/** Draw the sheet onto `doc` — the seam that takes the jsPDF instance rather than importing it. */
export function renderQcCpu95Pdf(doc: jsPDF, record: QcCpu95Record | null, opts: QcCpu95PdfOptions): void {
  const serial = (record?.values.serialNumber ?? "").trim();
  doc.setProperties({
    title: record ? `QCFRM-012 CPU-95 test sheet ${serial}`.trim() : "QCFRM-012 CPU-95 test sheet (blank)",
    creator: "Altronic ARC",
  });

  const pages = qcCpu95SheetLayout(record, opts.exportedOn, opts.blankVariantId);
  const overflow: Overflow[] = [];
  // Continuation goes after every sheet page.
  const continuationPage = () => pages.length + 1;

  pages.forEach((page, i) => {
    if (i > 0) doc.addPage();
    for (const op of page.ops) drawOp(doc, op, overflow, continuationPage);
  });

  if (overflow.length > 0) {
    drawContinuation(doc, overflow, `Test sheet ${serial || `#${record?.id ?? ""}`} — continued`);
  }
}

/** The PDF as a Blob (application/pdf). */
export async function generateQcCpu95Pdf(record: QcCpu95Record | null, opts: QcCpu95PdfOptions): Promise<Blob> {
  const doc = await buildQcCpu95PdfDocument(record, opts);
  return doc.output("blob");
}
