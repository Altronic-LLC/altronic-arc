import type ExcelJS from "exceljs";
import type {
  OpenOrderCustomerAccount,
  OpenOrderCustomerReport,
  OpenOrderLine,
  OpenOrderMetrics,
} from "@/types/task";
import { RAW_LAYOUT, type RawLayoutColumn } from "./openOrdersFields";
import {
  ALTRONIC_WORDMARK_ASPECT,
  ALTRONIC_WORDMARK_BLACK_PNG,
} from "@/assets/brand/altronicWordmark";
import {
  agingBucketFor,
  byPromiseDate,
  customerReport,
  formatByCurrency,
  metricsFor,
  runDateStamp,
} from "./openOrders";

// =============================================================================
// Open Orders — the workbooks.
//
// **ALTRONIC branding, not Cooper.** Both brand systems exist in this org and
// these files carry the Altronic identity: monochromatic black and white with
// greys for structure, and gold (#CBA052 — the ignition spark) as an accent
// used sparingly. An earlier version of this file was Cooper Red throughout;
// that was the wrong brand and is gone.
//
// **The layout mirrors the raw extract, column for column, in its order**
// (Ray, 2026-08-24: "do not rearrange columns … Leave the colmns in same order
// as raw but brand it according to altronic"). `RAW_LAYOUT` in
// openOrdersFields.ts is that order and the only place it is defined. People
// reconcile these sheets against the raw export side by side; a helpfully
// improved column order turns that into a hunt.
//
// **Every workbook is ONE sheet** (Ray, 2026-08-24: "i do not need all of those
// tabs either just the consolidated raw file", then "all should be single
// sheet"). The master's Dashboard / By Customer / Aging / Repairs / Coverage
// tabs and the customer file's Summary tab were all built and then removed on
// request.
//
// The one difference between the two: a customer's sheet still SPLITS the
// repair orders into a second table below the standard ones ("one difference on
// the customer single sheet split by repair still"). The master is one
// undivided table.
//
// Two styling rules carried from the notification emails, both still true here:
//   - The wordmark is TEXT, not an image. An embedded logo bloats every one of
//     seventy workbooks and shows as a broken placeholder wherever images are
//     blocked.
//   - Fonts are the brand's OFFICE alternatives — Segoe UI Semibold for
//     headings, Arial for body. Excel has no font-fallback list, so naming
//     Manrope on a machine that hasn't got it renders as whatever Excel
//     substitutes, which is worse than using the sanctioned alternative.
//
// These files go to CUSTOMERS, carrying the full raw column set, Comments
// included. The only thing withheld is another customer's rows.
// =============================================================================

// Altronic palette. Monochrome first; gold is a spark, never a theme.
const BLACK = "FF000000";
const WHITE = "FFFFFFFF";
const LIGHT_GREY = "FFE2E2E2";
const MEDIUM_GREY = "FFA5A5A5";
const DARK_GREY = "FF595959";
const GOLD = "FFCBA052";
/**
 * Row banding — the brand's Light Grey against white, alternating.
 *
 * Rows used to be washed gold when the line was PAST DUE, which meant the
 * shading carried meaning and the table looked patchy rather than banded (Ray,
 * 2026-08-24: "why are some lines highlighted yellow or gold and some not? I
 * would rather them be alternate color light grey and white like a table").
 * Shading is now purely structural — every other row, nothing else — which is
 * also what the brand guide asks Light Grey to do.
 */
const BAND = LIGHT_GREY;

const HEAD_FONT = "Segoe UI Semibold";
const BODY_FONT = "Arial";

const MONEY = "#,##0.00";
const QTY = "#,##0";
const DATE = "yyyy-mm-dd";

/** Columns where a column total means something. */
const SUMMABLE = ["Open quantity", "Open Order Value", "Order Quantity", "Net Value"];

function numFmtFor(col: RawLayoutColumn): string | undefined {
  if (col.format === "money") return MONEY;
  if (col.format === "qty") return QTY;
  if (col.format === "date") return DATE;
  return undefined;
}

function valueFor(line: OpenOrderLine, col: RawLayoutColumn): string | number | Date | null {
  const raw = line[col.field];
  if (raw instanceof Date) return raw;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return raw || null;
  return null;
}

/**
 * Comments is the one column that isn't just its field.
 *
 * 147 of the 166 comments in the live extract are DATES — a revised expected
 * ship date typed into the column — so the cell carries whichever of the two
 * the line has. See the note on `commentDate` in types/task.ts.
 */
function commentValue(line: OpenOrderLine): string | Date | null {
  return line.commentDate ?? (line.comments || null);
}

export interface WorkbookContext {
  runDate: Date;
  /** Named in the footer line — who ran it. */
  generatedBy?: string;
}

/** The master: the whole extract on one sheet, in the raw layout, branded. */
export async function buildMasterWorkbook(
  excel: typeof ExcelJS,
  lines: OpenOrderLine[],
  accounts: OpenOrderCustomerAccount[],
  ctx: WorkbookContext,
): Promise<ExcelJS.Workbook> {
  void accounts; // The master is the consolidated extract; the list doesn't shape it.
  const wb = newWorkbook(excel, ctx);
  const ws = wb.addWorksheet("Open Orders", { properties: { tabColor: { argb: BLACK } } });

  const ordered = [...lines].sort(byPromiseDate);
  const metrics = metricsFor(ordered, ctx.runDate);

  titleBlock(ws, "OPEN ORDERS", summaryLine(metrics), ctx, RAW_LAYOUT.length);
  const headerRowAt = ws.rowCount + 2;
  dataTable(ws, headerRowAt, ordered, ctx);

  ws.autoFilter = {
    from: { row: headerRowAt, column: 1 },
    to: { row: headerRowAt, column: RAW_LAYOUT.length },
  };
  ws.views = [{ state: "frozen", ySplit: headerRowAt }];
  return wb;
}

/**
 * One customer's workbook: a SINGLE sheet, their standard orders in one table
 * and their repair orders in a second table below it.
 *
 * One sheet like the master (Ray, 2026-08-24: "all should be single sheet"),
 * with the one difference he called out — the repair split stays. So the
 * Summary tab that used to carry the KPIs and the ageing table is gone, and
 * the figures worth having survive as a single line under the title.
 */
export async function buildCustomerWorkbook(
  excel: typeof ExcelJS,
  report: OpenOrderCustomerReport,
  _account: OpenOrderCustomerAccount,
  ctx: WorkbookContext,
): Promise<ExcelJS.Workbook> {
  const wb = newWorkbook(excel, ctx);
  const ws = wb.addWorksheet("Open Orders", { properties: { tabColor: { argb: BLACK } } });

  titleBlock(ws, "OPEN ORDERS", report.customerName, ctx, RAW_LAYOUT.length, report.soldTo);

  let row = ws.rowCount + 2;
  note(ws, row++, summaryLine(report.metrics));
  row += 1;

  row = heading(ws, row, `OPEN ORDERS (${report.standardLines.length})`);
  const firstHeader = row;
  row = dataTable(ws, row, report.standardLines, ctx);

  // Two blank rows, so the second table reads as its own rather than a
  // continuation of the first.
  row += 2;
  row = heading(ws, row, `REPAIR ORDERS (${report.repairLines.length})`);
  if (report.repairLines.length > 0 && report.metrics.repairValue === 0) {
    note(ws, row++, "Repair orders are not priced in this report, so they show no value.");
  }
  row = dataTable(ws, row, report.repairLines, ctx);

  footer(ws, row + 1, ctx);
  ws.views = [{ state: "frozen", ySplit: firstHeader }];
  return wb;
}

/** Every customer report worth producing for this run. */
export function customerReportsFor(
  accounts: OpenOrderCustomerAccount[],
  lines: OpenOrderLine[],
  runDate: Date,
): OpenOrderCustomerReport[] {
  return accounts
    .filter((a) => a.active)
    .map((a) => customerReport(a, lines, runDate))
    // An account with no open lines gets no workbook — an empty spreadsheet
    // arriving at a customer reads as a mistake.
    .filter((r) => r.metrics.lines > 0);
}

// -----------------------------------------------------------------------------
// The table
// -----------------------------------------------------------------------------

/**
 * The raw layout, rendered.
 *
 * Black header band with white semibold text over a gold hairline, alternate
 * rows washed very lightly, hairline grey rules, and gold ONLY on a past-due
 * ship date — the one thing a reader scans this for. Returns the row after the
 * totals.
 */
function dataTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  lines: OpenOrderLine[],
  ctx: WorkbookContext,
): number {
  ws.columns = RAW_LAYOUT.map((c) => ({ width: c.width }));

  let r = headerRow(
    ws,
    startRow,
    RAW_LAYOUT.map((c) => c.header),
  );

  if (lines.length === 0) {
    const empty = ws.getRow(r++);
    empty.getCell(1).value = "Nothing open in this category.";
    empty.getCell(1).font = { name: BODY_FONT, size: 10, italic: true, color: { argb: DARK_GREY } };
    return r;
  }

  lines.forEach((line, i) => {
    const dataRow = ws.getRow(r++);
    const pastDue = agingBucketFor(line, ctx.runDate) === "Past due";

    RAW_LAYOUT.forEach((col, index) => {
      const cell = dataRow.getCell(index + 1);
      cell.value = col.header === "Comments" ? commentValue(line) : valueFor(line, col);
      // The date format is harmless on a prose comment — Excel ignores a number
      // format on text — and correct on the many comments that are dates.
      const fmt = col.header === "Comments" ? DATE : numFmtFor(col);
      if (fmt) cell.numFmt = fmt;
      if (col.align) cell.alignment = { horizontal: col.align };
    });

    styleDataRow(dataRow, RAW_LAYOUT.length, i % 2 === 1);

    // Past due is marked by WEIGHT, not by colour: the ship date goes bold and
    // nothing else changes. Colouring the row made the banding mean two things
    // at once and left the table looking patchy. This keeps the one signal the
    // report exists for without breaking a plain banded table.
    if (pastDue) {
      const shipCol = RAW_LAYOUT.findIndex((c) => c.header === "Ship Date") + 1;
      if (shipCol > 0) {
        dataRow.getCell(shipCol).font = {
          name: HEAD_FONT,
          size: 10,
          bold: true,
          color: { argb: BLACK },
        };
      }
    }
  });

  totalsRow(ws, r, lines);
  return r + 1;
}

function headerRow(ws: ExcelJS.Worksheet, row: number, headers: string[]): number {
  const r = ws.getRow(row);
  r.height = 26;
  headers.forEach((text, i) => {
    const cell = r.getCell(i + 1);
    cell.value = text;
    cell.font = { name: HEAD_FONT, size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLACK } };
    cell.alignment = { vertical: "middle", wrapText: true };
    // A gold hairline under the black band — the one flash of accent on an
    // otherwise monochrome sheet.
    cell.border = { bottom: { style: "medium", color: { argb: GOLD } } };
  });
  return row + 1;
}

function styleDataRow(r: ExcelJS.Row, columns: number, banded: boolean) {
  r.height = 15;
  for (let c = 1; c <= columns; c++) {
    const cell = r.getCell(c);
    if (!cell.font) cell.font = { name: BODY_FONT, size: 10, color: { argb: BLACK } };
    cell.border = { bottom: { style: "hair", color: { argb: LIGHT_GREY } } };
    if (banded) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
  }
}

/** Totals under the numeric columns of the raw layout. */
function totalsRow(ws: ExcelJS.Worksheet, row: number, lines: OpenOrderLine[]) {
  const r = ws.getRow(row);
  r.height = 18;
  for (let c = 1; c <= RAW_LAYOUT.length; c++) {
    const cell = r.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREY } };
    cell.font = { name: HEAD_FONT, size: 10, bold: true, color: { argb: BLACK } };
    cell.border = { top: { style: "thin", color: { argb: MEDIUM_GREY } } };
  }
  r.getCell(1).value = `TOTAL — ${lines.length} line${lines.length === 1 ? "" : "s"}`;

  RAW_LAYOUT.forEach((col, i) => {
    if (!SUMMABLE.includes(col.header)) return;
    const cell = r.getCell(i + 1);
    cell.value = round2(
      lines.reduce((t, l) => {
        const v = l[col.field];
        return t + (typeof v === "number" ? v : 0);
      }, 0),
    );
    cell.numFmt = numFmtFor(col) ?? QTY;
  });
}

// -----------------------------------------------------------------------------
// Chrome
// -----------------------------------------------------------------------------

function newWorkbook(excel: typeof ExcelJS, ctx: WorkbookContext): ExcelJS.Workbook {
  const wb = new excel.Workbook();
  wb.creator = "ARC — Altronic Resource Center";
  wb.lastModifiedBy = ctx.generatedBy ?? "ARC";
  wb.created = ctx.runDate;
  wb.modified = ctx.runDate;
  return wb;
}

/**
 * The Altronic header: the wordmark in black on white, the subject, the run
 * date, closed off with a gold rule.
 *
 * The run date is in the SHEET rather than only in the filename, because these
 * files get forwarded and renamed, and one that doesn't say when it was run
 * gets read as current for months.
 */
function titleBlock(
  ws: ExcelJS.Worksheet,
  title: string,
  subject: string,
  ctx: WorkbookContext,
  span: number,
  soldTo?: string,
) {
  placeWordmark(ws);

  const t = ws.getRow(2);
  t.height = 20;
  t.getCell(1).value = title;
  t.getCell(1).font = { name: HEAD_FONT, size: 13, bold: true, color: { argb: BLACK } };

  const s = ws.getRow(3);
  s.getCell(1).value = soldTo ? `${subject}   ·   Customer ${soldTo}` : subject;
  s.getCell(1).font = { name: BODY_FONT, size: 10, color: { argb: DARK_GREY } };

  const d = ws.getRow(4);
  d.getCell(1).value = `Run date ${runDateStamp(ctx.runDate)} — figures as at this date`;
  d.getCell(1).font = { name: BODY_FONT, size: 9, italic: true, color: { argb: DARK_GREY } };
  for (let c = 1; c <= Math.min(span, RAW_LAYOUT.length); c++) {
    d.getCell(c).border = { bottom: { style: "thin", color: { argb: GOLD } } };
  }
}

/**
 * The official wordmark, dropped into the top-left of a sheet.
 *
 * The real mark rather than styled text (Ray, 2026-08-24). It's the 12KB
 * transparent PNG, embedded once per workbook — ExcelJS de-duplicates an image
 * added once and placed repeatedly, but each workbook is its own file, so this
 * costs ~12KB per report.
 *
 * Height is fixed and the width derived from the mark's own aspect ratio, so it
 * can never come out stretched. The row is made tall enough to hold it, with a
 * little air, since an image floats over cells rather than sizing them.
 */
function placeWordmark(ws: ExcelJS.Worksheet) {
  const HEIGHT_PX = 26;
  const row = ws.getRow(1);
  row.height = 34;
  const workbook = ws.workbook;
  const imageId = workbook.addImage({
    base64: ALTRONIC_WORDMARK_BLACK_PNG,
    extension: "png",
  });
  ws.addImage(imageId, {
    tl: { col: 0.15, row: 0.2 },
    ext: { width: Math.round(HEIGHT_PX * ALTRONIC_WORDMARK_ASPECT), height: HEIGHT_PX },
    editAs: "oneCell",
  });
}

function heading(ws: ExcelJS.Worksheet, row: number, text: string): number {
  const cell = ws.getRow(row).getCell(1);
  cell.value = text;
  cell.font = { name: HEAD_FONT, size: 11, bold: true, color: { argb: BLACK } };
  return row + 1;
}


function note(ws: ExcelJS.Worksheet, row: number, text: string) {
  const cell = ws.getRow(row).getCell(1);
  cell.value = text;
  cell.font = { name: BODY_FONT, size: 9, italic: true, color: { argb: DARK_GREY } };
}





/** The one-line description under the title. */
function summaryLine(metrics: OpenOrderMetrics): string {
  // Through the shared formatter, so the sheet and the screen can't disagree
  // about how a two-currency total is written.
  const money = formatByCurrency(metrics.byCurrency, "openValue");
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return (
    `${metrics.lines.toLocaleString("en-US")} open ${plural(metrics.lines, "line", "lines")} ` +
    `across ${metrics.orders.toLocaleString("en-US")} ${plural(metrics.orders, "order", "orders")}` +
    `   ·   ${money} open   ·   ` +
    `${metrics.pastDueStandardLines.toLocaleString("en-US")} ` +
    `${plural(metrics.pastDueStandardLines, "line", "lines")} past due` +
    // Said out loud, because the detail table below still SHOWS the late
    // repair lines — a reader counting them by hand would otherwise get a
    // different number and not know which to trust.
    (metrics.pastDueLines > metrics.pastDueStandardLines
      ? ` (excluding ${(metrics.pastDueLines - metrics.pastDueStandardLines).toLocaleString("en-US")} repair)`
      : "")
  );
}

function footer(ws: ExcelJS.Worksheet, row: number, ctx: WorkbookContext) {
  const cell = ws.getRow(row).getCell(1);
  cell.value = ctx.generatedBy
    ? `Generated from ARC by ${ctx.generatedBy} · ${runDateStamp(ctx.runDate)}`
    : `Generated from ARC · ${runDateStamp(ctx.runDate)}`;
  cell.font = { name: BODY_FONT, size: 8, italic: true, color: { argb: MEDIUM_GREY } };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
