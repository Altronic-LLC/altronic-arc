import type ExcelJS from "exceljs";
import type {
  OpenOrderCustomerAccount,
  OpenOrderCustomerReport,
  OpenOrderLine,
  OpenOrderMetrics,
} from "@/types/task";
import { RAW_LAYOUT, type RawLayoutColumn } from "./openOrdersFields";
import {
  agingBucketFor,
  byPromiseDate,
  customerReport,
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
// **The master is ONE sheet** (Ray, 2026-08-24: "i do not need all of those
// tabs either just the consolidated raw file with formatting that is clean and
// on brand"). The Dashboard / By Customer / Aging / Repairs / Coverage tabs
// that used to be here are gone. The customer workbook keeps its Summary and
// its two tables, because that was asked for explicitly and separately.
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
/** A wash of the accent, for the one row state worth marking. */
const GOLD_WASH = "FFF7EFE0";
/** Zebra banding — lighter than Light Grey, so it reads as texture not blocks. */
const BAND = "FFF7F7F7";

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
 * One customer's workbook: a Summary, then their lines with repair orders in a
 * second table below the first.
 */
export async function buildCustomerWorkbook(
  excel: typeof ExcelJS,
  report: OpenOrderCustomerReport,
  _account: OpenOrderCustomerAccount,
  ctx: WorkbookContext,
): Promise<ExcelJS.Workbook> {
  const wb = newWorkbook(excel, ctx);
  const m = report.metrics;

  // ---- Summary -----------------------------------------------------------
  const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: BLACK } } });
  sum.columns = [{ width: 30 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 18 }];
  titleBlock(sum, "OPEN ORDERS SUMMARY", report.customerName, ctx, 5, report.soldTo);

  let row = sum.rowCount + 2;
  row = kpiRow(sum, row, [
    { label: "Open value", value: m.openValue, format: MONEY, accent: false },
    { label: "Past due", value: m.pastDueValue, format: MONEY, accent: true },
    { label: "Open lines", value: m.lines, format: QTY, accent: false },
    { label: "Open orders", value: m.orders, format: QTY, accent: false },
    { label: "Open qty", value: m.openQty, format: QTY, accent: false },
  ]);

  row += 1;
  row = heading(sum, row, "AGEING — BY SHIP DATE");
  row = agingTable(sum, row, m);

  row += 1;
  row = heading(sum, row, "NEXT SHIP DATE");
  const next = sum.getRow(row++);
  label(next.getCell(1), m.nextPromiseDate ? "Soonest line due" : "No ship date on any open line");
  if (m.nextPromiseDate) {
    next.getCell(2).value = m.nextPromiseDate;
    next.getCell(2).numFmt = DATE;
    next.getCell(2).font = { name: HEAD_FONT, size: 10, bold: true, color: { argb: BLACK } };
  }

  row += 1;
  row = heading(sum, row, "STANDARD ORDERS VS REPAIR ORDERS");
  row = twoColumnTable(sum, row, [
    ["Standard orders", report.standardLines.length, round2(m.openValue - m.repairValue)],
    ["Repair orders", report.repairLines.length, m.repairValue],
  ]);
  if (report.repairLines.length > 0 && m.repairValue === 0) {
    note(sum, row++, "Repair orders are not priced in this report, so they show no value.");
  }

  if (m.currencies.length > 1) {
    row += 1;
    row = heading(sum, row, "BY CURRENCY");
    note(
      sum,
      row++,
      `These lines are in ${m.currencies.join(" and ")}. No exchange rate is applied, so the currencies are shown separately.`,
    );
    row = headerRow(sum, row, ["Currency", "Open value", "Past due"]);
    for (const [i, entry] of m.byCurrency.entries()) {
      const r = sum.getRow(row++);
      r.values = [entry.currency, entry.openValue, entry.pastDueValue];
      styleDataRow(r, 3, i % 2 === 1);
      r.getCell(2).numFmt = MONEY;
      r.getCell(3).numFmt = MONEY;
    }
  }
  footer(sum, row + 1, ctx);

  // ---- Open Orders: standard, then repairs below --------------------------
  const detail = wb.addWorksheet("Open Orders", { properties: { tabColor: { argb: DARK_GREY } } });
  titleBlock(detail, "OPEN ORDERS", report.customerName, ctx, RAW_LAYOUT.length, report.soldTo);

  let dRow = detail.rowCount + 2;
  dRow = heading(detail, dRow, `OPEN ORDERS (${report.standardLines.length})`);
  const firstHeader = dRow;
  dRow = dataTable(detail, dRow, report.standardLines, ctx);

  // Two blank rows, so the second table reads as its own rather than a
  // continuation of the first.
  dRow += 2;
  dRow = heading(detail, dRow, `REPAIR ORDERS (${report.repairLines.length})`);
  if (report.repairLines.length > 0 && report.metrics.repairValue === 0) {
    note(detail, dRow++, "Repair orders are not priced in this report, so they show no value.");
  }
  dataTable(detail, dRow, report.repairLines, ctx);

  detail.views = [{ state: "frozen", ySplit: firstHeader }];
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

    if (pastDue) {
      for (let c = 1; c <= RAW_LAYOUT.length; c++) {
        dataRow.getCell(c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: GOLD_WASH },
        };
      }
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
  const mark = ws.getRow(1);
  mark.height = 30;
  mark.getCell(1).value = "ALTRONIC";
  // xlsx has no letter-spacing, so the wordmark leans on weight and size.
  mark.getCell(1).font = { name: HEAD_FONT, size: 20, bold: true, color: { argb: BLACK } };
  mark.getCell(1).alignment = { vertical: "middle" };

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

function heading(ws: ExcelJS.Worksheet, row: number, text: string): number {
  const cell = ws.getRow(row).getCell(1);
  cell.value = text;
  cell.font = { name: HEAD_FONT, size: 11, bold: true, color: { argb: BLACK } };
  return row + 1;
}

function label(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { name: BODY_FONT, size: 10, color: { argb: DARK_GREY } };
}

function note(ws: ExcelJS.Worksheet, row: number, text: string) {
  const cell = ws.getRow(row).getCell(1);
  cell.value = text;
  cell.font = { name: BODY_FONT, size: 9, italic: true, color: { argb: DARK_GREY } };
}

interface Kpi {
  label: string;
  value: number;
  format: string;
  /** Gold, for the single figure worth the accent. */
  accent: boolean;
}

function kpiRow(ws: ExcelJS.Worksheet, row: number, kpis: Kpi[]): number {
  const labels = ws.getRow(row);
  const values = ws.getRow(row + 1);
  values.height = 24;
  kpis.forEach((kpi, i) => {
    const col = i + 1;
    const l = labels.getCell(col);
    l.value = kpi.label.toUpperCase();
    l.font = { name: HEAD_FONT, size: 8, bold: true, color: { argb: DARK_GREY } };

    const v = values.getCell(col);
    v.value = kpi.value;
    v.numFmt = kpi.format;
    v.font = { name: HEAD_FONT, size: 15, bold: true, color: { argb: kpi.accent ? GOLD : BLACK } };
    v.alignment = { vertical: "middle" };
    v.border = { top: { style: "thin", color: { argb: kpi.accent ? GOLD : LIGHT_GREY } } };
  });
  return row + 2;
}

function agingTable(ws: ExcelJS.Worksheet, row: number, metrics: OpenOrderMetrics): number {
  let r = headerRow(ws, row, ["Bucket", "Lines", "Open qty", "Open value", "% of value"]);
  metrics.aging.forEach((bucket, i) => {
    const line = ws.getRow(r++);
    const share = metrics.openValue ? bucket.openValue / metrics.openValue : 0;
    line.values = [bucket.bucket, bucket.lines, bucket.openQty, bucket.openValue, share];
    styleDataRow(line, 5, i % 2 === 1);
    line.getCell(2).numFmt = QTY;
    line.getCell(3).numFmt = QTY;
    line.getCell(4).numFmt = MONEY;
    line.getCell(5).numFmt = "0.0%";
    if (bucket.bucket === "Past due" && bucket.lines > 0) {
      for (let c = 1; c <= 5; c++) {
        line.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD_WASH } };
      }
      line.getCell(1).font = { name: HEAD_FONT, size: 10, bold: true, color: { argb: BLACK } };
      line.getCell(4).font = { name: HEAD_FONT, size: 10, bold: true, color: { argb: GOLD } };
    }
    // "No ship date" is missing data, not lateness — grey, never the accent.
    if (bucket.bucket === "No promise date" && bucket.lines > 0) {
      line.getCell(1).font = { name: BODY_FONT, size: 10, italic: true, color: { argb: DARK_GREY } };
    }
  });
  const total = ws.getRow(r);
  for (let c = 1; c <= 5; c++) {
    total.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREY } };
    total.getCell(c).font = { name: HEAD_FONT, size: 10, bold: true, color: { argb: BLACK } };
    total.getCell(c).border = { top: { style: "thin", color: { argb: MEDIUM_GREY } } };
  }
  total.getCell(1).value = "TOTAL";
  total.getCell(2).value = metrics.lines;
  total.getCell(2).numFmt = QTY;
  total.getCell(3).value = metrics.openQty;
  total.getCell(3).numFmt = QTY;
  total.getCell(4).value = metrics.openValue;
  total.getCell(4).numFmt = MONEY;
  return r + 1;
}

function twoColumnTable(
  ws: ExcelJS.Worksheet,
  row: number,
  rows: Array<[string, number, number]>,
): number {
  let r = headerRow(ws, row, ["", "Lines", "Open value"]);
  rows.forEach(([text, lines, value], i) => {
    const line = ws.getRow(r++);
    line.values = [text, lines, value];
    styleDataRow(line, 3, i % 2 === 1);
    line.getCell(2).numFmt = QTY;
    line.getCell(3).numFmt = MONEY;
  });
  return r;
}

/** The one-line description under the master's title. */
function summaryLine(metrics: OpenOrderMetrics): string {
  const money = metrics.byCurrency
    .map((c) => `${c.currency} ${c.openValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`)
    .join(" + ");
  return (
    `${metrics.lines.toLocaleString("en-US")} open lines across ` +
    `${metrics.orders.toLocaleString("en-US")} orders   ·   ${money} open   ·   ` +
    `${metrics.pastDueLines.toLocaleString("en-US")} lines past due`
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
