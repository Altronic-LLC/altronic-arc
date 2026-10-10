import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import type { QuotePdfAssembly, QuotePdfModel } from "@/types/quote";
import { ALTRONIC_WORDMARK_ASPECT, ALTRONIC_WORDMARK_BLACK_PNG } from "@/assets/brand/altronicWordmark";

// =============================================================================
// The CUSTOMER-FACING quote PDF (Insourcing Quotes, design §7).
//
// **The renderer accepts ONLY a `QuotePdfModel`** — a type with no field that
// could carry cost, margin, markup, target GM or component lines. Every value
// printed below is read from a NAMED field of that model; nothing iterates the
// model's keys, so a property smuggled onto the object at runtime is never
// printed either (pinned by a test).
//
// **Real text, not a screenshot.** Drawn with jsPDF + AutoTable in built-in
// Helvetica, so the text is selectable, searchable — and inspectable by the
// leak test, which only works because the text is real.
//
// **jspdf and jspdf-autotable are DYNAMICALLY imported** (only `import type`
// above), so neither lands in the main bundle for somebody reading a task list
// — the ExcelJS arrangement from the Open Orders tool.
//
// LAYOUT (Ray, 2026-10-09, from a reference image): every line in ONE open
// "QUOTED ITEMS" table — Part # (bold monospace, SAP / Cust. numbers in small
// grey beneath) | Description | Price (each quantity break stacked as
// "range pcs  $price", or one larger price when there are no breaks) | Qty |
// Subtotal. A right-aligned "Total" follows. "Prepared for" and "Prepared by"
// (whoever generated the PDF) sit side by side.
//
// Altronic branding: monochrome black/white, greys for structure, gold
// (#CBA052) only as a sparing accent hairline. The mark is the 12KB
// transparent PNG the Open Orders workbooks use.
// =============================================================================

type AutoTableFn = (doc: jsPDF, options: UserOptions) => void;

export interface QuotePdfOptions {
  /** PDF stream compression. Default true; tests pass false to read the text. */
  compress?: boolean;
  /**
   * TESTS ONLY — override the wordmark's base64 PNG. A logo that can't be
   * embedded must never stop the quote rendering, and this is how that path is
   * exercised. `null` skips the logo entirely.
   */
  logoBase64?: string | null;
}

// --- Layout constants (points; Letter is 612 x 792) --------------------------
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 50;
/** Space reserved at the bottom for the footer. */
const MARGIN_BOTTOM = 64;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const LOGO_W = 150;

const BLACK: [number, number, number] = [0, 0, 0];
const DARK_GREY: [number, number, number] = [64, 64, 64];
const MID_GREY: [number, number, number] = [115, 115, 115];
const LINE_GREY: [number, number, number] = [200, 200, 200];
const LIGHT_GREY: [number, number, number] = [240, 240, 240];
const GOLD: [number, number, number] = [0xcb, 0xa0, 0x52];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * yyyy-mm-dd → "October 9, 2026", read straight off the string — never via
 * `new Date("2026-10-09")`, which parses as UTC midnight and reads as the day
 * before in every US time zone. Anything unparseable is printed as given.
 */
export function formatQuoteDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso.trim();
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return iso.trim();
  return `${MONTHS[month - 1]} ${day}, ${m[1]}`;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** $1,234.56 */
export function formatQuotePrice(value: number): string {
  return USD.format(value);
}

/**
 * `${quoteNumber}.pdf`, with every character SharePoint refuses in a file name
 * (`" * : < > ? / \ |` and control characters) replaced by a dash, and the
 * leading/trailing spaces and dots it also refuses trimmed off.
 */
export function quotePdfFileName(model: Pick<QuotePdfModel, "quoteNumber">): string {
  const cleaned = model.quoteNumber
    // eslint-disable-next-line no-control-regex
    .replace(/["*:<>?/\\|\u0000-\u001f]/g, "-")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return `${cleaned || "quote"}.pdf`;
}

/**
 * Build the jsPDF document for a quote. Dynamically imports jspdf and
 * jspdf-autotable. Exported so tests can read the uncompressed output.
 */
export async function buildQuotePdfDocument(
  model: QuotePdfModel,
  opts: QuotePdfOptions = {},
): Promise<jsPDF> {
  const [{ jsPDF: JsPdf }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = (autoTableModule.autoTable ?? autoTableModule.default) as AutoTableFn;
  const doc = new JsPdf({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
    compress: opts.compress ?? true,
  });
  renderQuotePdf(doc, autoTable, model, opts);
  return doc;
}

/** Generate the customer quote PDF as a Blob (application/pdf). */
export async function generateQuotePdf(
  model: QuotePdfModel,
  opts: QuotePdfOptions = {},
): Promise<Blob> {
  const doc = await buildQuotePdfDocument(model, opts);
  return doc.output("blob");
}

/**
 * Draw the whole quote onto `doc`. The lower-level seam: takes the jsPDF
 * instance and the AutoTable function rather than importing them.
 */
export function renderQuotePdf(
  doc: jsPDF,
  autoTable: AutoTableFn,
  model: QuotePdfModel,
  opts: QuotePdfOptions = {},
): void {
  doc.setProperties({ title: `Quotation ${model.quoteNumber}`, creator: "Altronic ARC" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...BLACK);

  let y = drawHeader(doc, model, opts);
  y = drawCustomer(doc, model, y);

  if (model.budgetary) y = drawBudgetary(doc, model.budgetary, y);

  const assemblies = [...model.assemblies].sort((a, b) => a.lineNo - b.lineNo);
  if (assemblies.length > 0) {
    y = drawItems(doc, autoTable, assemblies, y);
    y = drawQuoteTotal(doc, model.quoteTotal, y);
  }

  if (model.quoteNotes.trim()) y = drawNotes(doc, model.quoteNotes, y);

  drawFooters(doc, model.quoteNumber);
}

// --- Pieces ------------------------------------------------------------------

/** Start a new page if `needed` points won't fit below `y`. Returns the y to draw at. */
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE_H - MARGIN_BOTTOM) return y;
  doc.addPage();
  return MARGIN_TOP;
}

function lineHeight(fontSize: number): number {
  return fontSize * 1.25;
}

function drawHeader(doc: jsPDF, model: QuotePdfModel, opts: QuotePdfOptions): number {
  const top = MARGIN_TOP;
  const logo = opts.logoBase64 === undefined ? ALTRONIC_WORDMARK_BLACK_PNG : opts.logoBase64;
  if (logo) {
    // A logo that won't embed must never stop the quote rendering.
    try {
      doc.addImage(
        `data:image/png;base64,${logo}`,
        "PNG",
        MARGIN_X,
        top,
        LOGO_W,
        LOGO_W / ALTRONIC_WORDMARK_ASPECT,
      );
    } catch {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(...BLACK);
      doc.text("ALTRONIC", MARGIN_X, top + 16);
    }
  }

  const right = PAGE_W - MARGIN_X;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...BLACK);
  doc.text("QUOTATION", right, top + 16, { align: "right" });

  doc.setFontSize(11);
  doc.text(model.quoteNumber, right, top + 34, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...DARK_GREY);
  doc.text(`Revision ${model.rev}`, right, top + 47, { align: "right" });
  doc.text(`Issued ${formatQuoteDate(model.issueDate)}`, right, top + 59, { align: "right" });
  doc.text(`Valid until ${formatQuoteDate(model.expiryDate)}`, right, top + 71, { align: "right" });

  // The one gold accent: a hairline under the header band.
  const ruleY = top + 84;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.75);
  doc.line(MARGIN_X, ruleY, PAGE_W - MARGIN_X, ruleY);
  doc.setTextColor(...BLACK);
  return ruleY + 22;
}

/**
 * "Prepared for" (the customer) and "Prepared by" (whoever generated the PDF,
 * so the customer knows who to contact) side by side, across the width. Each
 * column omits its blank lines; "Prepared by" is omitted entirely when null.
 */
function drawCustomer(doc: jsPDF, model: QuotePdfModel, y: number): number {
  const forLines: { text: string; bold?: boolean }[] = [];
  if (model.customerName.trim()) forLines.push({ text: model.customerName.trim(), bold: true });
  if (model.customerNumber.trim()) forLines.push({ text: `Customer no. ${model.customerNumber.trim()}` });
  if (model.contactName.trim()) forLines.push({ text: `Attn: ${model.contactName.trim()}` });
  if (model.contactEmail.trim()) forLines.push({ text: model.contactEmail.trim() });

  const byLines: { text: string; bold?: boolean }[] = [];
  if (model.preparedBy) {
    if (model.preparedBy.name.trim()) byLines.push({ text: model.preparedBy.name.trim(), bold: true });
    if (model.preparedBy.email.trim()) byLines.push({ text: model.preparedBy.email.trim() });
  }

  const colW = CONTENT_W / 2;
  const column = (x: number, heading: string, lines: { text: string; bold?: boolean }[]): number => {
    let cy = y;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MID_GREY);
    doc.text(heading, x, cy);
    cy += 14;
    doc.setTextColor(...BLACK);
    for (const line of lines) {
      const size = line.bold ? 12 : 10;
      doc.setFont("helvetica", line.bold ? "bold" : "normal");
      doc.setFontSize(size);
      for (const part of doc.splitTextToSize(line.text, colW - 12) as string[]) {
        doc.text(part, x, cy);
        cy += lineHeight(size);
      }
    }
    return cy;
  };

  const leftEnd = column(MARGIN_X, "PREPARED FOR", forLines);
  const rightEnd = byLines.length > 0 ? column(MARGIN_X + colW, "PREPARED BY", byLines) : y;
  return Math.max(leftEnd, rightEnd) + 14;
}

function drawBudgetary(
  doc: jsPDF,
  budgetary: { title: string; text: string },
  y: number,
): number {
  const pad = 10;
  doc.setFontSize(9);
  const bodyLines = doc.splitTextToSize(budgetary.text.trim(), CONTENT_W - pad * 2) as string[];
  const titleH = lineHeight(10);
  const bodyH = bodyLines.length * lineHeight(9);
  const boxH = pad * 2 + titleH + (bodyLines.length ? 4 + bodyH : 0);
  y = ensureSpace(doc, y, boxH);

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(1);
  doc.setFillColor(...LIGHT_GREY);
  doc.rect(MARGIN_X, y, CONTENT_W, boxH, "FD");

  let ty = y + pad + 9;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  doc.text(budgetary.title.trim().toUpperCase(), MARGIN_X + pad, ty);
  ty += titleH + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...DARK_GREY);
  for (const line of bodyLines) {
    doc.text(line, MARGIN_X + pad, ty);
    ty += lineHeight(9);
  }
  doc.setTextColor(...BLACK);
  return y + boxH + 20;
}

// --- Quoted items table --------------------------------------------------------
//
//   QUOTED ITEMS
//   ┌ PART #        DESCRIPTION            PRICE                  QTY   SUBTOTAL ┐  ← light grey band
//   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← black rule
//     1026-6521-00  HUB V4 NO SAT          1 – 249 pcs  $1,178.00    12  $14,136.00
//     SAP 1003-…                           ─────────────────────
//     Cust. WTS-…                          250 – 499 pcs $1,119.10
//   ─────────────────────────────────────────────────────────────────────────────  ← hairline
//
// No vertical lines and no boxed cells. The Part # and Price cells hold
// several runs in DIFFERENT fonts/colours, which AutoTable can't do inside one
// cell — so their text is blanked in didParseCell (with minCellHeight reserving
// the room) and drawn by hand in didDrawCell. The range label lives in a
// FIXED-width sub-column, wrapping if it must, so it can never run into the
// price beside it.

const COL_PART = CONTENT_W * 0.22;
const COL_DESC = CONTENT_W * 0.36;
const COL_PRICE = CONTENT_W * 0.24;
const COL_QTY = CONTENT_W * 0.06;
const COL_SUB = CONTENT_W - COL_PART - COL_DESC - COL_PRICE - COL_QTY;

const CELL_PAD_X = 5;
const CELL_PAD_TOP = 9;
const CELL_PAD_BOTTOM = 9;
const BODY_SIZE = 9;
const PART_SIZE = 9.5;
const META_SIZE = 7.5;
const META_STEP = 10;
const LABEL_SIZE = 7.5;
/** The range label's own sub-column; the price is right-aligned past it. */
const LABEL_W = 60;
const TIER_STEP = 15;
const LABEL_LINE_STEP = 9;
const SINGLE_PRICE_SIZE = 11;
const HEAD_SIZE = 7;
const HEAD_CHAR_SPACE = 0.9;
const FAINT_GREY: [number, number, number] = [225, 225, 225];

/** First-line baseline in a body cell — matches AutoTable's own text placement. */
const firstBaseline = (cellY: number) => cellY + CELL_PAD_TOP + BODY_SIZE * (2 - 1.15);

/** Letter-spaced small caps, at x (left edge) — used for the caption and the header. */
function spacedCaps(doc: jsPDF, text: string, x: number, y: number, size: number, align: "left" | "right" = "left") {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);
  doc.setTextColor(...MID_GREY);
  const width = doc.getTextWidth(text) + HEAD_CHAR_SPACE * Math.max(text.length - 1, 0);
  doc.text(text, align === "right" ? x - width : x, y, { charSpace: HEAD_CHAR_SPACE });
  doc.setTextColor(...BLACK);
}

interface PartCell {
  partLines: string[];
  metaLines: string[];
}

interface TierLayout {
  labelLines: string[];
  price: string;
}

function partCell(doc: jsPDF, a: QuotePdfAssembly): PartCell {
  const innerW = COL_PART - CELL_PAD_X * 2;
  doc.setFont("courier", "bold");
  doc.setFontSize(PART_SIZE);
  const partLines = doc.splitTextToSize(a.altronicPartNumber.trim(), innerW) as string[];
  const meta: string[] = [];
  if (a.sapPartNumber.trim()) meta.push(`SAP ${a.sapPartNumber.trim()}`);
  if (a.customerPartNumber.trim()) meta.push(`Cust. ${a.customerPartNumber.trim()}`);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(META_SIZE);
  const metaLines = meta.flatMap((m) => doc.splitTextToSize(m, innerW) as string[]);
  return { partLines, metaLines };
}

function partCellHeight(c: PartCell): number {
  return (
    CELL_PAD_TOP +
    PART_SIZE * 1.15 +
    (c.partLines.length - 1) * lineHeight(PART_SIZE) +
    (c.metaLines.length ? 3 + c.metaLines.length * META_STEP : 0) +
    CELL_PAD_BOTTOM
  );
}

function tierLayouts(doc: jsPDF, a: QuotePdfAssembly): TierLayout[] {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(LABEL_SIZE);
  return a.tiers.map((t) => ({
    labelLines: doc.splitTextToSize(`${t.rangeLabel} pcs`, LABEL_W - 6) as string[],
    price: formatQuotePrice(t.unitPrice),
  }));
}

function priceCellHeight(a: QuotePdfAssembly, tiers: TierLayout[]): number {
  if (a.tiers.length <= 1) return CELL_PAD_TOP + SINGLE_PRICE_SIZE * 1.15 + CELL_PAD_BOTTOM;
  const extra = tiers.reduce((s, t) => s + (t.labelLines.length - 1) * LABEL_LINE_STEP, 0);
  return CELL_PAD_TOP + BODY_SIZE * 1.15 + (tiers.length - 1) * TIER_STEP + extra + CELL_PAD_BOTTOM;
}

/** All quote lines as ONE open table, under a "QUOTED ITEMS" caption. */
function drawItems(
  doc: jsPDF,
  autoTable: AutoTableFn,
  assemblies: QuotePdfAssembly[],
  y: number,
): number {
  // Keep the caption with the header and at least a modest first row.
  y = ensureSpace(doc, y, 12 + 26 + 50);
  spacedCaps(doc, "QUOTED ITEMS", MARGIN_X, y + 6, HEAD_SIZE);
  y += 14;

  const parts = assemblies.map((a) => partCell(doc, a));
  const tiers = assemblies.map((a) => tierLayouts(doc, a));
  const headLabels = ["PART #", "DESCRIPTION", "PRICE", "QTY", "SUBTOTAL"];
  const rightAligned = new Set([3, 4]);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
    tableWidth: CONTENT_W,
    theme: "plain",
    rowPageBreak: "avoid",
    showHead: "everyPage",
    head: [headLabels],
    body: assemblies.map((a) => [
      "",
      a.description.trim().replace(/\s+/g, " "),
      "",
      String(a.quotedQty),
      formatQuotePrice(a.lineTotal),
    ]),
    styles: {
      font: "helvetica",
      fontSize: BODY_SIZE,
      textColor: BLACK,
      lineColor: LINE_GREY,
      lineWidth: { top: 0, right: 0, bottom: 0.5, left: 0 },
      cellPadding: { top: CELL_PAD_TOP, bottom: CELL_PAD_BOTTOM, left: CELL_PAD_X, right: CELL_PAD_X },
      valign: "top",
    },
    headStyles: {
      fillColor: LIGHT_GREY,
      textColor: MID_GREY,
      fontStyle: "bold",
      fontSize: HEAD_SIZE,
      lineColor: BLACK,
      lineWidth: { top: 0, right: 0, bottom: 1, left: 0 },
      cellPadding: { top: 9, bottom: 9, left: CELL_PAD_X, right: CELL_PAD_X },
    },
    columnStyles: {
      0: { cellWidth: COL_PART },
      // Extra right padding so a description that just fits doesn't butt up
      // against the range labels beside it.
      1: {
        cellWidth: COL_DESC,
        textColor: DARK_GREY,
        cellPadding: { top: CELL_PAD_TOP, bottom: CELL_PAD_BOTTOM, left: CELL_PAD_X, right: 10 },
      },
      2: { cellWidth: COL_PRICE },
      3: { cellWidth: COL_QTY, halign: "right" },
      4: { cellWidth: COL_SUB, halign: "right", fontStyle: "bold" },
    },
    didParseCell: (data) => {
      const col = data.column.index;
      if (data.section === "head") {
        // Drawn by hand (letter-spaced) in didDrawCell; keep one line of height.
        data.cell.text = [""];
        return;
      }
      if (data.section !== "body") return;
      const i = data.row.index;
      if (col === 0) {
        data.cell.text = [""];
        data.cell.styles.minCellHeight = partCellHeight(parts[i]);
      } else if (col === 2) {
        data.cell.text = [""];
        data.cell.styles.minCellHeight = priceCellHeight(assemblies[i], tiers[i]);
      }
    },
    didDrawCell: (data) => {
      const col = data.column.index;
      const cell = data.cell;
      if (data.section === "head") {
        const by = cell.y + cell.height / 2 + HEAD_SIZE * 0.35;
        if (rightAligned.has(col)) {
          spacedCaps(doc, headLabels[col], cell.x + cell.width - CELL_PAD_X, by, HEAD_SIZE, "right");
        } else {
          spacedCaps(doc, headLabels[col], cell.x + CELL_PAD_X, by, HEAD_SIZE);
        }
        return;
      }
      if (data.section !== "body") return;
      const i = data.row.index;
      const x = cell.x + CELL_PAD_X;
      const base = firstBaseline(cell.y);
      if (col === 0) {
        const p = parts[i];
        let ty = base;
        doc.setFont("courier", "bold");
        doc.setFontSize(PART_SIZE);
        doc.setTextColor(...BLACK);
        for (const line of p.partLines) {
          doc.text(line, x, ty);
          ty += lineHeight(PART_SIZE);
        }
        ty = ty - lineHeight(PART_SIZE) + 3 + META_STEP;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(META_SIZE);
        doc.setTextColor(...MID_GREY);
        for (const line of p.metaLines) {
          doc.text(line, x, ty);
          ty += META_STEP;
        }
        doc.setTextColor(...BLACK);
      } else if (col === 2) {
        const a = assemblies[i];
        const right = cell.x + cell.width - CELL_PAD_X;
        if (a.tiers.length <= 1) {
          const price = tiers[i][0]?.price ?? formatQuotePrice(a.quotedUnitPrice);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(SINGLE_PRICE_SIZE);
          doc.setTextColor(...BLACK);
          doc.text(price, x, base + 1);
          return;
        }
        let ty = base;
        tiers[i].forEach((t, k) => {
          if (k > 0) {
            // A faint hairline between tiers, across the price column only.
            doc.setDrawColor(...FAINT_GREY);
            doc.setLineWidth(0.4);
            const ly = ty - TIER_STEP + 4.5;
            doc.line(x, ly, right, ly);
          }
          doc.setFont("helvetica", "normal");
          doc.setFontSize(LABEL_SIZE);
          doc.setTextColor(...MID_GREY);
          let ly = ty;
          for (const line of t.labelLines) {
            doc.text(line, x, ly);
            ly += LABEL_LINE_STEP;
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(BODY_SIZE);
          doc.setTextColor(...BLACK);
          doc.text(t.price, right - doc.getTextWidth(t.price), ty);
          ty += TIER_STEP + (t.labelLines.length - 1) * LABEL_LINE_STEP;
        });
        doc.setTextColor(...BLACK);
      }
    },
  });
  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;
  return finalY + 26;
}

/** The quote's Total, right-aligned at the right margin, above the notes. */
function drawQuoteTotal(doc: jsPDF, total: number, y: number): number {
  y = ensureSpace(doc, y, lineHeight(12) + 8);
  const right = PAGE_W - MARGIN_X;
  // A single hairline above — no box.
  doc.setDrawColor(...LINE_GREY);
  doc.setLineWidth(0.5);
  doc.line(right - 200, y - 10, right, y - 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BLACK);
  const amount = formatQuotePrice(total);
  doc.text(amount, right, y + 4, { align: "right" });
  doc.text("Total", right - doc.getTextWidth(amount) - 18, y + 4, { align: "right" });
  return y + lineHeight(12) + 16;
}

function drawNotes(doc: jsPDF, notes: string, y: number): number {
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(notes.trim(), CONTENT_W) as string[];
  y = ensureSpace(doc, y, lineHeight(10) + 4 + Math.min(lines.length, 3) * lineHeight(9));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  doc.text("Notes", MARGIN_X, y);
  doc.setDrawColor(...LINE_GREY);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y + 4, PAGE_W - MARGIN_X, y + 4);
  y += lineHeight(10) + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...DARK_GREY);
  for (const line of lines) {
    y = ensureSpace(doc, y, lineHeight(9));
    doc.text(line, MARGIN_X, y);
    y += lineHeight(9);
  }
  doc.setTextColor(...BLACK);
  return y + 10;
}

function drawFooters(doc: jsPDF, quoteNumber: string): void {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    const fy = PAGE_H - 36;
    doc.setDrawColor(...LINE_GREY);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_X, fy - 12, PAGE_W - MARGIN_X, fy - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MID_GREY);
    doc.text(quoteNumber, MARGIN_X, fy);
    doc.text(`Page ${page} of ${total}`, PAGE_W - MARGIN_X, fy, { align: "right" });
  }
  doc.setTextColor(...BLACK);
}
