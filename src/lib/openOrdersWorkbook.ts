import type ExcelJS from "exceljs";
import type {
  OpenOrderCustomerAccount,
  OpenOrderCustomerReport,
  OpenOrderLine,
  OpenOrderMetrics,
} from "@/types/task";
import {
  accountsWithNoLines,
  agingBucketFor,
  byPromiseDate,
  customerReport,
  customerRollup,
  isRepairLine,
  metricsFor,
  runDateStamp,
} from "./openOrders";

// =============================================================================
// Open Orders — the workbooks.
//
// Two builders: the master dashboard everyone reads, and the per-customer file
// the regional managers send out. Both are branded the same way and both take
// an injected ExcelJS module, so the ~950KB library is only ever pulled in by
// the caller that actually generates a file (dynamic import in the hook) and
// never lands in the main bundle.
//
// Cooper brand palette, from tailwind.config:
//   Cooper Red #CB2C30 · Cooper Gray #707372 · Ajax Yellow #F8C237
//   Cooper Green #009A44 · Superior Blue #1C60AC
//
// Two rules about the styling, both learned from the notification emails:
//   - Header bands are SATURATED red, not near-black. Anything near-black gets
//     remapped to muddy grey by Outlook/Excel dark themes; the brand red
//     survives in both.
//   - The wordmark is TEXT, not an image. An embedded logo bloats every one of
//     forty workbooks and shows as a broken placeholder wherever images are
//     blocked.
//
// These files go to CUSTOMERS, and carry the FULL column set including
// Comments (Ray, 2026-08-24 — "comments are customer safe, show all columns
// for customer"). What still never appears is another customer's name: a
// customer workbook is filtered to one sold-to and the master's Customer
// column is dropped from it.
//
// Every sheet says what it is and when it was run — a spreadsheet with no run
// date gets forwarded for months as if it were current.
// =============================================================================

const RED = "FFCB2C30";
const GRAY = "FF707372";
const YELLOW = "FFF8C237";
const GREEN = "FF009A44";
const BLUE = "FF1C60AC";
const WHITE = "FFFFFFFF";
const BAND = "FFF3F4F6";
const PAST_DUE_FILL = "FFFDECEC";

const MONEY = '#,##0.00;[Red]-#,##0.00';
const QTY = "#,##0";
const DATE = "yyyy-mm-dd";

/** Column plan for a line-level table — one place, so every table matches. */
interface LineColumn {
  header: string;
  width: number;
  value: (l: OpenOrderLine) => string | number | Date | null;
  format?: string;
  align?: "left" | "center" | "right";
}

/**
 * The line columns, in reading order — every field the extract carries.
 *
 * All of it goes to the customer (Ray, 2026-08-24). The order is what someone
 * chasing an order scans for: the order and their own PO first, then what it
 * is, then quantities and money, then the dates, then the status columns and
 * comments, with SAP's internal codes last so they're out of the way without
 * being hidden.
 */
const LINE_COLUMNS: LineColumn[] = [
  { header: "Sales Order", width: 14, value: (l) => l.salesOrder },
  { header: "Line", width: 7, value: (l) => l.lineNo, align: "center" },
  { header: "Your PO", width: 18, value: (l) => l.customerPo },
  { header: "Material", width: 16, value: (l) => l.material },
  { header: "Altronic Part No.", width: 17, value: (l) => l.altronicPartNumber },
  { header: "Description", width: 38, value: (l) => l.description },
  { header: "Type", width: 8, value: (l) => l.orderType, align: "center" },
  { header: "Order Qty", width: 10, value: (l) => l.orderQty, format: QTY, align: "right" },
  { header: "Shipped", width: 10, value: (l) => l.shippedQty, format: QTY, align: "right" },
  { header: "Open Qty", width: 10, value: (l) => l.openQty, format: QTY, align: "right" },
  { header: "Unit Price", width: 13, value: (l) => l.unitPrice, format: MONEY, align: "right" },
  { header: "Open Value", width: 15, value: (l) => l.openValue, format: MONEY, align: "right" },
  // Currency is a column rather than a note: an extract can mix them, so a
  // value with no currency beside it is ambiguous on exactly the rows it
  // matters for.
  { header: "Currency", width: 9, value: (l) => l.currency, align: "center" },
  { header: "Order Date", width: 12, value: (l) => l.orderDate, format: DATE, align: "center" },
  { header: "Requested", width: 12, value: (l) => l.requestedDate, format: DATE, align: "center" },
  { header: "Promise Date", width: 13, value: (l) => l.promiseDate, format: DATE, align: "center" },
  { header: "Delivery Status", width: 13, value: (l) => l.status, align: "center" },
  { header: "Delivery Block", width: 13, value: (l) => l.deliveryBlock, align: "center" },
  { header: "Reason for Rejection", width: 20, value: (l) => l.rejectionReason },
  // One column, either kind of comment. A revised date arrives as a real date
  // so it sorts and filters; the date format is simply ignored by Excel on the
  // rows that hold prose.
  {
    header: "Comments",
    width: 46,
    value: (l) => l.commentDate ?? l.comments,
    format: DATE,
  },
  { header: "Ship-To", width: 12, value: (l) => l.shipTo },
  { header: "Sales Office", width: 12, value: (l) => l.salesOffice, align: "center" },
  { header: "MRP Controller", width: 13, value: (l) => l.mrpController, align: "center" },
  { header: "Created By", width: 13, value: (l) => l.createdBy },
];

/**
 * The repairs table carries the repair order number; the standard table does
 * not, because a column that is blank on every row of it is noise.
 */
const REPAIR_LINE_COLUMNS: LineColumn[] = LINE_COLUMNS.flatMap((c) =>
  c.header === "Type"
    ? [c, { header: "Repair Order", width: 14, value: (l: OpenOrderLine) => l.repairOrder }]
    : [c],
);

/** The master detail table adds the customer, which a customer file must not. */
const MASTER_LINE_COLUMNS: LineColumn[] = [
  { header: "Sold-To", width: 12, value: (l) => l.soldTo },
  { header: "Customer", width: 34, value: (l) => l.customerName },
  ...LINE_COLUMNS,
];

export interface WorkbookContext {
  runDate: Date;
  /** Shown in the footer of every sheet — who generated it. */
  generatedBy?: string;
}

/**
 * Build the master dashboard.
 *
 * Tabs: Dashboard (the read), By Customer (the rollup), Aging, Open Orders
 * (every standard line), Repairs (ZS1), and Coverage — the managed accounts
 * with nothing in the extract, which is the sheet that answers "why did my
 * customer get no report".
 */
export async function buildMasterWorkbook(
  excel: typeof ExcelJS,
  lines: OpenOrderLine[],
  accounts: OpenOrderCustomerAccount[],
  ctx: WorkbookContext,
): Promise<ExcelJS.Workbook> {
  const wb = newWorkbook(excel, ctx);
  const metrics = metricsFor(lines, ctx.runDate);
  const rollup = customerRollup(lines, ctx.runDate);

  // ---- Dashboard ---------------------------------------------------------
  const dash = wb.addWorksheet("Dashboard", tabColour(RED));
  dash.columns = [
    { width: 34 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
  ];
  titleBlock(dash, "Open Orders Dashboard", "All open order lines, company-wide", ctx);

  let row = dash.rowCount + 2;
  row = kpiRow(dash, row, [
    { label: "Open value", value: metrics.openValue, format: MONEY, tone: BLUE },
    { label: "Past-due value", value: metrics.pastDueValue, format: MONEY, tone: RED },
    { label: "Open lines", value: metrics.lines, format: QTY, tone: GRAY },
    { label: "Open orders", value: metrics.orders, format: QTY, tone: GRAY },
    { label: "Customers", value: rollup.length, format: QTY, tone: GRAY },
  ]);

  row += 1;
  row = sectionHeading(dash, row, "Aging — by promise date");
  row = agingTable(dash, row, metrics, ctx);

  row += 1;
  row = sectionHeading(dash, row, "Standard orders vs repair orders");
  row = twoColumnTable(dash, row, ["", "Lines", "Open value"], [
    [
      "Standard orders",
      metrics.lines - metrics.repairLines,
      round2(metrics.openValue - metrics.repairValue),
    ],
    ["Repair orders", metrics.repairLines, metrics.repairValue],
  ]);
  if (metrics.repairLines > 0 && metrics.repairValue === 0) {
    const note = dash.getRow(row++);
    note.getCell(1).value = `Repair orders carry no price in this extract, so all ${metrics.repairLines} add nothing to open value.`;
    note.getCell(1).font = { italic: true, size: 9, color: { argb: GRAY } };
  }

  // Mixed currencies are never added together — the sum would not be money in
  // any currency. The per-currency table IS the total.
  if (metrics.currencies.length > 1) {
    row += 1;
    row = sectionHeading(dash, row, "Open value by currency");
    const note = dash.getRow(row++);
    note.getCell(1).value =
      `This extract mixes ${metrics.currencies.join(" and ")}. No exchange rate is applied, ` +
      "so the currencies are reported separately rather than as one figure.";
    note.getCell(1).font = { italic: true, size: 9, color: { argb: GRAY } };
    row = headerRow(dash, row, ["Currency", "Open value", "Past-due value"]);
    for (const entry of metrics.byCurrency) {
      const r = dash.getRow(row++);
      r.values = [entry.currency, entry.openValue, entry.pastDueValue];
      styleDataRow(r, 3);
      r.getCell(2).numFmt = MONEY;
      r.getCell(3).numFmt = MONEY;
      if (entry.pastDueValue > 0) r.getCell(3).font = { bold: true, color: { argb: RED }, size: 10 };
    }
  }

  row += 1;
  row = sectionHeading(dash, row, "Top customers by open value");
  const topHeader = ["Customer", "Sold-To", "Lines", "Open value", "Past-due value", "Next promise"];
  row = headerRow(dash, row, topHeader);
  for (const entry of rollup.slice(0, 10)) {
    const r = dash.getRow(row++);
    r.values = [
      entry.customerName,
      entry.soldTo,
      entry.metrics.lines,
      entry.metrics.openValue,
      entry.metrics.pastDueValue,
      entry.metrics.nextPromiseDate,
    ];
    styleDataRow(r, topHeader.length);
    r.getCell(3).numFmt = QTY;
    r.getCell(4).numFmt = MONEY;
    r.getCell(5).numFmt = MONEY;
    r.getCell(6).numFmt = DATE;
    if (entry.metrics.pastDueValue > 0) {
      r.getCell(5).font = { bold: true, color: { argb: RED }, size: 10 };
    }
  }
  footer(dash, row + 1, ctx);
  dash.views = [{ state: "frozen", ySplit: 5 }];

  // ---- By Customer -------------------------------------------------------
  const byCust = wb.addWorksheet("By Customer", tabColour(BLUE));
  const custHeader = [
    "Customer",
    "Sold-To",
    "On report list",
    "Orders",
    "Lines",
    "Open qty",
    "Open value",
    "Past-due value",
    "Repairs value",
    "Next promise",
  ];
  titleBlock(byCust, "Open Orders by Customer", "Every customer in the extract", ctx);
  byCust.columns = [
    { width: 36 },
    { width: 12 },
    { width: 14 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
    { width: 15 },
    { width: 14 },
  ];
  let cRow = headerRow(byCust, byCust.rowCount + 2, custHeader);
  for (const entry of rollup) {
    const onList = accounts.some(
      (a) => a.active && normalise(a.accountNumber) === normalise(entry.soldTo),
    );
    const r = byCust.getRow(cRow++);
    r.values = [
      entry.customerName,
      entry.soldTo,
      onList ? "Yes" : "No",
      entry.metrics.orders,
      entry.metrics.lines,
      entry.metrics.openQty,
      entry.metrics.openValue,
      entry.metrics.pastDueValue,
      entry.metrics.repairValue,
      entry.metrics.nextPromiseDate,
    ];
    styleDataRow(r, custHeader.length);
    [4, 5, 6].forEach((c) => (r.getCell(c).numFmt = QTY));
    [7, 8, 9].forEach((c) => (r.getCell(c).numFmt = MONEY));
    r.getCell(10).numFmt = DATE;
    r.getCell(3).alignment = { horizontal: "center" };
    if (!onList) r.getCell(3).font = { color: { argb: GRAY }, size: 10, italic: true };
    if (entry.metrics.pastDueValue > 0) {
      r.getCell(8).font = { bold: true, color: { argb: RED }, size: 10 };
    }
  }
  totalRow(byCust, cRow, custHeader.length, [
    { col: 4, value: metrics.orders, format: QTY },
    { col: 5, value: metrics.lines, format: QTY },
    { col: 6, value: metrics.openQty, format: QTY },
    { col: 7, value: metrics.openValue, format: MONEY },
    { col: 8, value: metrics.pastDueValue, format: MONEY },
    { col: 9, value: metrics.repairValue, format: MONEY },
  ]);
  byCust.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: custHeader.length } };
  byCust.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];

  // ---- Aging -------------------------------------------------------------
  const aging = wb.addWorksheet("Aging", tabColour(YELLOW));
  titleBlock(aging, "Aging by Promise Date", "Bucketed against the run date", ctx);
  aging.columns = [{ width: 36 }, ...Array(6).fill({ width: 16 })];
  let aRow = sectionHeading(aging, aging.rowCount + 2, "Company-wide");
  aRow = agingTable(aging, aRow, metrics, ctx);
  aRow += 1;
  aRow = sectionHeading(aRow === 0 ? aging : aging, aRow, "Past-due value by customer");
  const pdHeader = ["Customer", "Sold-To", "Past-due lines", "Past-due value", "% of their open"];
  aRow = headerRow(aging, aRow, pdHeader);
  for (const entry of rollup.filter((e) => e.metrics.pastDueValue > 0)) {
    const r = aging.getRow(aRow++);
    const share = entry.metrics.openValue
      ? entry.metrics.pastDueValue / entry.metrics.openValue
      : 0;
    r.values = [
      entry.customerName,
      entry.soldTo,
      entry.metrics.pastDueLines,
      entry.metrics.pastDueValue,
      share,
    ];
    styleDataRow(r, pdHeader.length);
    r.getCell(3).numFmt = QTY;
    r.getCell(4).numFmt = MONEY;
    r.getCell(5).numFmt = "0.0%";
    r.getCell(4).font = { bold: true, color: { argb: RED }, size: 10 };
  }
  aging.views = [{ state: "frozen", ySplit: 5 }];

  // ---- Open Orders / Repairs --------------------------------------------
  const standard = lines.filter((l) => !isRepairLine(l)).sort(byPromiseDate);
  const repairs = lines.filter(isRepairLine).sort(byPromiseDate);
  addLineSheet(wb, "Open Orders", "Every standard open line", standard, MASTER_LINE_COLUMNS, ctx, BLUE);
  addLineSheet(
    wb,
    "Repairs",
    "Repair orders only — normally unpriced, so they add nothing to open value",
    repairs,
    [MASTER_LINE_COLUMNS[0], MASTER_LINE_COLUMNS[1], ...REPAIR_LINE_COLUMNS],
    ctx,
    GRAY,
  );

  // ---- Coverage ----------------------------------------------------------
  // Why a customer on the list got no workbook. Without this sheet the answer
  // is "nobody knows", and the report-list owner has no way to tell a missing
  // file from a customer with genuinely nothing open.
  const gaps = accountsWithNoLines(accounts, lines);
  const cover = wb.addWorksheet("Coverage", tabColour(GREEN));
  titleBlock(cover, "Report Coverage", "Who is on the weekly list, and who had nothing open", ctx);
  cover.columns = [{ width: 36 }, { width: 14 }, { width: 16 }, { width: 52 }];
  const covHeader = ["Customer", "Sold-To", "Lines this week", "Notes"];
  let vRow = headerRow(cover, cover.rowCount + 2, covHeader);
  for (const account of accounts.filter((a) => a.active)) {
    const found = lines.filter((l) => normalise(l.soldTo) === normalise(account.accountNumber));
    const r = cover.getRow(vRow++);
    r.values = [
      account.customerName,
      account.accountNumber,
      found.length,
      found.length === 0 ? "No open lines in this extract — no workbook produced" : account.notes,
    ];
    styleDataRow(r, covHeader.length);
    r.getCell(3).numFmt = QTY;
    if (found.length === 0) {
      r.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAST_DUE_FILL } };
      });
    }
  }
  if (gaps.length === 0) {
    const r = cover.getRow(vRow + 1);
    r.getCell(1).value = "Every active account on the list had open lines this week.";
    r.getCell(1).font = { italic: true, color: { argb: GREEN }, size: 10 };
  }
  cover.views = [{ state: "frozen", ySplit: 5 }];

  return wb;
}

/**
 * Build one customer's workbook.
 *
 * Two tabs: Summary, then Open Orders with the standard table first and the
 * ZS1 / repairs table BELOW it as a separate table (Ray, 2026-08-24) — two
 * tables on one sheet rather than two sheets, so a customer sees everything
 * open in one scroll.
 */
export async function buildCustomerWorkbook(
  excel: typeof ExcelJS,
  report: OpenOrderCustomerReport,
  /**
   * The list row this report belongs to. Nothing on the customer's own sheets
   * comes off it any more — the report carries the name and the numbers — but
   * it stays in the signature because a customer workbook is defined by the
   * account it was built for, and the next thing anyone adds here (a contact,
   * a note, a covering line) comes from this row.
   */
  _account: OpenOrderCustomerAccount,
  ctx: WorkbookContext,
): Promise<ExcelJS.Workbook> {
  const wb = newWorkbook(excel, ctx);
  const m = report.metrics;

  // ---- Summary -----------------------------------------------------------
  const sum = wb.addWorksheet("Summary", tabColour(RED));
  sum.columns = [{ width: 34 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }];
  titleBlock(sum, "Open Orders Summary", report.customerName, ctx, report.soldTo);

  let row = sum.rowCount + 2;
  row = kpiRow(sum, row, [
    { label: "Open value", value: m.openValue, format: MONEY, tone: BLUE },
    { label: "Past-due value", value: m.pastDueValue, format: MONEY, tone: RED },
    { label: "Open lines", value: m.lines, format: QTY, tone: GRAY },
    { label: "Open orders", value: m.orders, format: QTY, tone: GRAY },
    { label: "Open qty", value: m.openQty, format: QTY, tone: GRAY },
  ]);

  row += 1;
  row = sectionHeading(sum, row, "Aging — by promise date");
  row = agingTable(sum, row, m, ctx);

  row += 1;
  row = sectionHeading(sum, row, "Next promise date");
  const nextRow = sum.getRow(row++);
  nextRow.getCell(1).value = m.nextPromiseDate ? "Soonest line promised" : "No promise date on any open line";
  nextRow.getCell(1).font = { size: 10 };
  if (m.nextPromiseDate) {
    nextRow.getCell(2).value = m.nextPromiseDate;
    nextRow.getCell(2).numFmt = DATE;
    nextRow.getCell(2).font = { bold: true, size: 10, color: { argb: BLUE } };
  }

  row += 1;
  row = sectionHeading(sum, row, "Standard orders vs repairs (ZS1)");
  row = twoColumnTable(sum, row, ["", "Lines", "Open value"], [
    ["Standard orders", report.standardLines.length, round2(m.openValue - m.repairValue)],
    ["Repairs (ZS1)", report.repairLines.length, m.repairValue],
  ]);

  footer(sum, row + 1, ctx);

  // ---- Open Orders: two tables, standard then repairs -------------------
  const detail = wb.addWorksheet("Open Orders", tabColour(BLUE));
  applyColumnWidths(detail, LINE_COLUMNS);
  titleBlock(detail, "Open Orders", report.customerName, ctx, report.soldTo);

  let dRow = detail.rowCount + 2;
  dRow = sectionHeading(detail, dRow, `Open orders (${report.standardLines.length})`);
  dRow = lineTable(detail, dRow, report.standardLines, LINE_COLUMNS, ctx);

  // Two blank rows, so the second table reads as a separate table rather than
  // a continuation of the first.
  dRow += 2;
  dRow = sectionHeading(detail, dRow, `Repair orders (${report.repairLines.length})`);
  if (report.repairLines.length > 0 && report.metrics.repairValue === 0) {
    // Every repair line in the extract is unpriced. Saying so beats a table of
    // zeros that reads as a broken export.
    const note = detail.getRow(dRow++);
    note.getCell(1).value = "Repair orders are not priced in this report, so they show no value.";
    note.getCell(1).font = { italic: true, size: 9, color: { argb: GRAY } };
  }
  lineTable(detail, dRow, report.repairLines, REPAIR_LINE_COLUMNS, ctx);

  detail.views = [{ state: "frozen", ySplit: 5 }];
  return wb;
}

/** Everything one weekly run produces, ready to be written somewhere. */
export interface GeneratedWorkbook {
  filename: string;
  /** Which customer it is, or null for a master file. */
  soldTo: string | null;
  buffer: ArrayBuffer;
}

/** Build every customer report for the accounts that have lines. */
export function customerReportsFor(
  accounts: OpenOrderCustomerAccount[],
  lines: OpenOrderLine[],
  runDate: Date,
): OpenOrderCustomerReport[] {
  return accounts
    .filter((a) => a.active)
    .map((a) => customerReport(a, lines, runDate))
    // An account with no open lines gets no workbook — an empty spreadsheet
    // reads as a mistake at the customer's end. The Coverage sheet says so
    // instead.
    .filter((r) => r.metrics.lines > 0);
}

// -----------------------------------------------------------------------------
// Shared chrome
// -----------------------------------------------------------------------------

function newWorkbook(excel: typeof ExcelJS, ctx: WorkbookContext): ExcelJS.Workbook {
  const wb = new excel.Workbook();
  wb.creator = "ARC — Altronic Resource Center";
  wb.lastModifiedBy = ctx.generatedBy ?? "ARC";
  wb.created = ctx.runDate;
  wb.modified = ctx.runDate;
  return wb;
}

function tabColour(argb: string) {
  return { properties: { tabColor: { argb } } };
}

/**
 * The red brand band every sheet opens with: wordmark, sheet title, subject,
 * and the run date.
 *
 * The run date is in the BAND rather than only in the filename, because these
 * files get forwarded and renamed, and a sheet that doesn't say when it was
 * run gets read as current forever.
 */
function titleBlock(
  ws: ExcelJS.Worksheet,
  title: string,
  subject: string,
  ctx: WorkbookContext,
  soldTo?: string,
) {
  const span = Math.max(6, Math.min(ws.columnCount || 6, 14));
  const bar = ws.getRow(1);
  bar.height = 30;
  bar.getCell(1).value = "ALTRONIC";
  bar.getCell(1).font = { bold: true, size: 16, color: { argb: WHITE }, name: "Calibri" };
  bar.getCell(1).alignment = { vertical: "middle" };
  for (let c = 1; c <= span; c++) {
    bar.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
  }
  ws.mergeCells(1, 1, 1, Math.min(4, span));

  const sub = ws.getRow(2);
  sub.height = 20;
  sub.getCell(1).value = title;
  sub.getCell(1).font = { bold: true, size: 13, color: { argb: "FF1F2937" } };

  const line3 = ws.getRow(3);
  line3.getCell(1).value = soldTo ? `${subject}  ·  Sold-To ${soldTo}` : subject;
  line3.getCell(1).font = { size: 10, color: { argb: GRAY } };

  const line4 = ws.getRow(4);
  line4.getCell(1).value = `Run date ${runDateStamp(ctx.runDate)} — figures as at this date`;
  line4.getCell(1).font = { size: 9, italic: true, color: { argb: GRAY } };
}

function sectionHeading(ws: ExcelJS.Worksheet, row: number, text: string): number {
  const r = ws.getRow(row);
  r.getCell(1).value = text;
  r.getCell(1).font = { bold: true, size: 11, color: { argb: "FF1F2937" } };
  r.getCell(1).border = { bottom: { style: "medium", color: { argb: RED } } };
  return row + 1;
}

interface Kpi {
  label: string;
  value: number;
  format: string;
  tone: string;
}

/** A row of KPI tiles — label above, big number below. */
function kpiRow(ws: ExcelJS.Worksheet, row: number, kpis: Kpi[]): number {
  const labels = ws.getRow(row);
  const values = ws.getRow(row + 1);
  values.height = 22;
  kpis.forEach((kpi, i) => {
    const col = i + 1;
    labels.getCell(col).value = kpi.label.toUpperCase();
    labels.getCell(col).font = { bold: true, size: 8, color: { argb: GRAY } };
    labels.getCell(col).alignment = { horizontal: "left" };
    const cell = values.getCell(col);
    cell.value = kpi.value;
    cell.numFmt = kpi.format;
    cell.font = { bold: true, size: 14, color: { argb: kpi.tone } };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = { top: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });
  return row + 2;
}

function agingTable(
  ws: ExcelJS.Worksheet,
  row: number,
  metrics: OpenOrderMetrics,
  ctx: WorkbookContext,
): number {
  void ctx;
  const header = ["Bucket", "Lines", "Open qty", "Open value", "% of open value"];
  let r = headerRow(ws, row, header);
  for (const bucket of metrics.aging) {
    const line = ws.getRow(r++);
    const share = metrics.openValue ? bucket.openValue / metrics.openValue : 0;
    line.values = [bucket.bucket, bucket.lines, bucket.openQty, bucket.openValue, share];
    styleDataRow(line, header.length);
    line.getCell(2).numFmt = QTY;
    line.getCell(3).numFmt = QTY;
    line.getCell(4).numFmt = MONEY;
    line.getCell(5).numFmt = "0.0%";
    if (bucket.bucket === "Past due" && bucket.lines > 0) {
      line.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAST_DUE_FILL } };
      });
      line.getCell(1).font = { bold: true, size: 10, color: { argb: RED } };
      line.getCell(4).font = { bold: true, size: 10, color: { argb: RED } };
    }
    // "No promise date" is greyed rather than coloured: it isn't good or bad,
    // it's missing data, and colouring it red would read as late.
    if (bucket.bucket === "No promise date" && bucket.lines > 0) {
      line.getCell(1).font = { italic: true, size: 10, color: { argb: GRAY } };
    }
  }
  totalRow(ws, r, header.length, [
    { col: 2, value: metrics.lines, format: QTY },
    { col: 3, value: metrics.openQty, format: QTY },
    { col: 4, value: metrics.openValue, format: MONEY },
  ]);
  return r + 1;
}

function twoColumnTable(
  ws: ExcelJS.Worksheet,
  row: number,
  header: string[],
  rows: Array<[string, number, number]>,
): number {
  let r = headerRow(ws, row, header);
  for (const [label, lines, value] of rows) {
    const line = ws.getRow(r++);
    line.values = [label, lines, value];
    styleDataRow(line, header.length);
    line.getCell(2).numFmt = QTY;
    line.getCell(3).numFmt = MONEY;
  }
  return r;
}

function headerRow(ws: ExcelJS.Worksheet, row: number, header: string[]): number {
  const r = ws.getRow(row);
  r.height = 18;
  header.forEach((text, i) => {
    const cell = r.getCell(i + 1);
    cell.value = text;
    cell.font = { bold: true, size: 10, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: WHITE } } };
  });
  return row + 1;
}

function styleDataRow(r: ExcelJS.Row, columns: number) {
  r.height = 15;
  for (let c = 1; c <= columns; c++) {
    const cell = r.getCell(c);
    if (!cell.font) cell.font = { size: 10 };
    cell.border = { bottom: { style: "hair", color: { argb: "FFE5E7EB" } } };
  }
}

function totalRow(
  ws: ExcelJS.Worksheet,
  row: number,
  columns: number,
  cells: Array<{ col: number; value: number; format: string }>,
) {
  const r = ws.getRow(row);
  r.getCell(1).value = "Total";
  for (let c = 1; c <= columns; c++) {
    r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
    r.getCell(c).font = { bold: true, size: 10 };
    r.getCell(c).border = { top: { style: "thin", color: { argb: GRAY } } };
  }
  for (const cell of cells) {
    r.getCell(cell.col).value = cell.value;
    r.getCell(cell.col).numFmt = cell.format;
  }
}

function applyColumnWidths(ws: ExcelJS.Worksheet, columns: LineColumn[]) {
  ws.columns = columns.map((c) => ({ width: c.width }));
}

/** A line-level table with a total row. Returns the row after it. */
function lineTable(
  ws: ExcelJS.Worksheet,
  row: number,
  lines: OpenOrderLine[],
  columns: LineColumn[],
  ctx: WorkbookContext,
): number {
  let r = headerRow(
    ws,
    row,
    columns.map((c) => c.header),
  );
  if (lines.length === 0) {
    const empty = ws.getRow(r++);
    empty.getCell(1).value = "Nothing open in this category.";
    empty.getCell(1).font = { italic: true, size: 10, color: { argb: GRAY } };
    return r;
  }
  for (const line of lines) {
    const dataRow = ws.getRow(r++);
    columns.forEach((col, i) => {
      const cell = dataRow.getCell(i + 1);
      cell.value = col.value(line);
      if (col.format) cell.numFmt = col.format;
      if (col.align) cell.alignment = { horizontal: col.align };
    });
    styleDataRow(dataRow, columns.length);
    // Past-due lines are tinted across the row and their promise date turned
    // red — the one thing a reader is scanning this table for.
    if (agingBucketFor(line, ctx.runDate) === "Past due") {
      for (let c = 1; c <= columns.length; c++) {
        dataRow.getCell(c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: PAST_DUE_FILL },
        };
      }
      const promiseCol = columns.findIndex((c) => c.header === "Promise Date") + 1;
      if (promiseCol > 0) {
        dataRow.getCell(promiseCol).font = { bold: true, size: 10, color: { argb: RED } };
      }
    }
  }
  const openQtyCol = columns.findIndex((c) => c.header === "Open Qty") + 1;
  const openValCol = columns.findIndex((c) => c.header === "Open Value") + 1;
  totalRow(ws, r, columns.length, [
    ...(openQtyCol > 0
      ? [{ col: openQtyCol, value: sumOf(lines, (l) => l.openQty), format: QTY }]
      : []),
    ...(openValCol > 0
      ? [{ col: openValCol, value: sumOf(lines, (l) => l.openValue), format: MONEY }]
      : []),
  ]);
  return r + 1;
}

function addLineSheet(
  wb: ExcelJS.Workbook,
  name: string,
  subject: string,
  lines: OpenOrderLine[],
  columns: LineColumn[],
  ctx: WorkbookContext,
  colour: string,
) {
  const ws = wb.addWorksheet(name, tabColour(colour));
  applyColumnWidths(ws, columns);
  titleBlock(ws, name, subject, ctx);
  const headerAt = ws.rowCount + 2;
  lineTable(ws, headerAt, lines, columns, ctx);
  ws.autoFilter = {
    from: { row: headerAt, column: 1 },
    to: { row: headerAt, column: columns.length },
  };
  ws.views = [{ state: "frozen", ySplit: headerAt }];
}

function footer(ws: ExcelJS.Worksheet, row: number, ctx: WorkbookContext) {
  const r = ws.getRow(row);
  r.getCell(1).value = ctx.generatedBy
    ? `Generated from ARC by ${ctx.generatedBy} · ${runDateStamp(ctx.runDate)}`
    : `Generated from ARC · ${runDateStamp(ctx.runDate)}`;
  r.getCell(1).font = { size: 8, italic: true, color: { argb: GRAY } };
}

function sumOf(lines: OpenOrderLine[], pick: (l: OpenOrderLine) => number): number {
  return round2(lines.reduce((t, l) => t + pick(l), 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalise(s: string): string {
  return s.trim().replace(/^0+/, "").toUpperCase();
}
