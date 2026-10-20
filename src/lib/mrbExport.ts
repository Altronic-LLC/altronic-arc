import type ExcelJS from "exceljs";
import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import type { MrbEntry } from "@/types/task";
import { ALTRONIC_WORDMARK_ASPECT, ALTRONIC_WORDMARK_BLACK_PNG } from "@/assets/brand/altronicWordmark";
import { MRB_FIELD_BY_KEY } from "./mrbFields";
import { isArchivedMrbEntry, mrbState, needsDisposition } from "./mrbMapper";
import { formatSpDate, toDateInputValue } from "./spDates";
import { parseIsoDate, toIsoDate } from "./dateInput";

// =============================================================================
// The MRB meeting pack — the register exported for a date window, as a
// printable PDF or an Excel workbook, pressed just before the meeting.
//
// Two sections, in the order the board works through them:
//
//   Needs disposition  live entries nobody has decided (blank or To be
//                      Determined). By default EVERY one of these is included
//                      whatever its date — an entry raised before the window
//                      and still undecided is exactly what the meeting is for,
//                      and a pack that dropped it would let it sit for ever.
//   Decided            live entries IN the window that already have one —
//                      the record of what was decided since last time.
//
// Archive rows (the old Excel import) are never exported: they are retained
// history, not work. Oldest first within each section, undated last.
//
// Dates compare as `yyyy-mm-dd` KEYS. An MRB date is a date-only value held at
// midday UTC (parseSpDateOnly), so its key is read in UTC; the window's bounds
// come from the date picker, already keys. Comparing Date objects instead
// would make the window's edges depend on the browser's time zone.
// =============================================================================

export type MrbExportFormat = "pdf" | "xlsx";

export interface MrbExportOptions {
  /** yyyy-mm-dd, or "" for no lower bound. */
  from: string;
  /** yyyy-mm-dd, or "" for no upper bound. */
  to: string;
  /** Include undecided entries dated outside the window (and undated ones). */
  includeAllOpen: boolean;
}

export interface MrbExportModel {
  from: string;
  to: string;
  includeAllOpen: boolean;
  generatedAt: Date;
  needs: MrbEntry[];
  decided: MrbEntry[];
}

export type MrbRangePreset = "7d" | "30d" | "month" | "year";

export const MRB_RANGE_PRESETS: { id: MrbRangePreset; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
];

/** A preset as a from/to pair of LOCAL yyyy-mm-dd keys, ending today. */
export function mrbPresetRange(preset: MrbRangePreset, today: Date = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const to = toIsoDate(today);
  switch (preset) {
    case "7d":
      return { from: toIsoDate(new Date(y, m, d - 6)), to };
    case "30d":
      return { from: toIsoDate(new Date(y, m, d - 29)), to };
    case "month":
      return { from: toIsoDate(new Date(y, m, 1)), to };
    case "year":
      return { from: toIsoDate(new Date(y, 0, 1)), to };
  }
}

/** Why the window can't be exported, or null. */
export function mrbRangeProblem(from: string, to: string): string | null {
  if (from && to && from > to) return "The From date is after the To date.";
  return null;
}

function inWindow(key: string, from: string, to: string): boolean {
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function oldestFirst(a: MrbEntry, b: MrbEntry): number {
  const ak = toDateInputValue(a.mrbDate);
  const bk = toDateInputValue(b.mrbDate);
  if (ak !== bk) {
    if (!ak) return 1;
    if (!bk) return -1;
    return ak < bk ? -1 : 1;
  }
  return a.id - b.id;
}

export function selectMrbExport(
  entries: MrbEntry[],
  options: MrbExportOptions,
  generatedAt: Date = new Date(),
): MrbExportModel {
  const { from, to, includeAllOpen } = options;
  const needs: MrbEntry[] = [];
  const decided: MrbEntry[] = [];
  for (const entry of entries) {
    if (isArchivedMrbEntry(entry)) continue;
    const key = toDateInputValue(entry.mrbDate);
    if (needsDisposition(entry)) {
      if (includeAllOpen || inWindow(key, from, to)) needs.push(entry);
    } else if (mrbState(entry) === "decided" && inWindow(key, from, to)) {
      decided.push(entry);
    }
  }
  needs.sort(oldestFirst);
  decided.sort(oldestFirst);
  return { from, to, includeAllOpen, generatedAt, needs, decided };
}

/** Σ Price Per Issue. A blank price adds nothing — it is unknown, not free. */
export function mrbCostTotal(entries: MrbEntry[]): number {
  return Math.round(entries.reduce((sum, e) => sum + (e.pricePerIssue ?? 0), 0) * 100) / 100;
}

/** "Sep 20, 2026 – Oct 20, 2026", with open ends said in words. */
export function mrbWindowLabel(from: string, to: string): string {
  const show = (key: string) => formatSpDate(parseIsoDate(key) ? new Date(`${key}T12:00:00Z`) : null);
  if (from && to) return `${show(from)} – ${show(to)}`;
  if (from) return `${show(from)} onward`;
  if (to) return `Up to ${show(to)}`;
  return "All dates";
}

export function mrbExportFileName(model: Pick<MrbExportModel, "from" | "to">, format: MrbExportFormat): string {
  const span = [model.from, model.to].filter(Boolean).join(" to ") || "all dates";
  return `MRB ${span}.${format}`;
}

/** "To be Determined" is a decision not yet made; blank is a box to write in. */
function dispositionText(entry: MrbEntry): string {
  return entry.disposition.trim();
}

function money(value: number | null): string {
  if (value === null) return "";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function quantity(value: number | null): string {
  return value === null ? "" : String(value);
}

const ALTRONIC_PART_LABEL = MRB_FIELD_BY_KEY.oldPartNumber.label;

// ---------------------------------------------------------------------------
// PDF — landscape letter, real text, jsPDF + AutoTable dynamically imported.
// ---------------------------------------------------------------------------

type AutoTableFn = (doc: jsPDF, options: UserOptions) => void;

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 36;

const PDF_HEAD = [
  "MRB Date",
  "SAP Number",
  ALTRONIC_PART_LABEL,
  "Description",
  "Vendor",
  "Qty",
  "Cost",
  "Where Caused",
  "Reason",
  "Disposition",
];

function pdfRow(entry: MrbEntry): string[] {
  return [
    entry.mrbDate ? formatSpDate(entry.mrbDate) : "",
    entry.sapNumber,
    entry.oldPartNumber,
    entry.description,
    entry.vendorName,
    quantity(entry.quantity),
    money(entry.pricePerIssue),
    entry.whereCaused,
    entry.reason,
    dispositionText(entry),
  ];
}

export async function buildMrbPdf(model: MrbExportModel, opts: { compress?: boolean; logo?: boolean } = {}): Promise<jsPDF> {
  const [{ jsPDF: JsPdf }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = (autoTableModule.autoTable ?? autoTableModule.default) as AutoTableFn;
  const doc = new JsPdf({ orientation: "landscape", unit: "pt", format: "letter", compress: opts.compress ?? true });
  renderMrbPdf(doc, autoTable, model, opts.logo ?? true);
  return doc;
}

export async function generateMrbPdf(model: MrbExportModel): Promise<Blob> {
  return (await buildMrbPdf(model)).output("blob");
}

export function renderMrbPdf(doc: jsPDF, autoTable: AutoTableFn, model: MrbExportModel, logo = true): void {
  const span = mrbWindowLabel(model.from, model.to);
  doc.setProperties({ title: `Material Review Board — ${span}`, creator: "Altronic ARC" });
  const right = PAGE_W - MARGIN;
  let y = 32;

  if (logo) {
    try {
      doc.addImage(`data:image/png;base64,${ALTRONIC_WORDMARK_BLACK_PNG}`, "PNG", MARGIN, y, 130, 130 / ALTRONIC_WORDMARK_ASPECT);
    } catch {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("ALTRONIC", MARGIN, y + 14);
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text("MATERIAL REVIEW BOARD", right, y + 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(64, 64, 64);
  doc.text(`Entries dated ${span}`, right, y + 28, { align: "right" });
  doc.text(
    `Generated ${model.generatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
    right,
    y + 40,
    { align: "right" },
  );

  y += 52;
  doc.setDrawColor(0xcb, 0xa0, 0x52);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, y, right, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(
    `${model.needs.length} need a disposition · ${model.decided.length} decided · ${money(
      mrbCostTotal([...model.needs, ...model.decided]),
    )} total cost`,
    MARGIN,
    y,
  );
  y += 18;

  const section = (title: string, note: string, entries: MrbEntry[], writeIn: boolean) => {
    if (y > PAGE_H - 110) {
      doc.addPage();
      y = MARGIN + 10;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(`${title} (${entries.length})`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text(note, MARGIN, y + 11);
    y += 18;

    if (entries.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(64, 64, 64);
      doc.text("None.", MARGIN, y + 8);
      y += 28;
      return;
    }

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: 40 },
      head: [PDF_HEAD],
      body: entries.map(pdfRow),
      foot: [["", "", "", "", "", "Total", money(mrbCostTotal(entries)), "", "", ""]],
      showFoot: "lastPage",
      // An entry never splits across a page — half a row on each sheet is
      // unreadable at the meeting table.
      rowPageBreak: "avoid",
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 7.5,
        cellPadding: 3,
        textColor: [0, 0, 0],
        lineColor: [190, 190, 190],
        lineWidth: 0.5,
        valign: "top",
        // Room to write the board's decision by hand.
        minCellHeight: writeIn ? 30 : 0,
      },
      headStyles: { fontStyle: "bold", fillColor: [235, 235, 235], minCellHeight: 0 },
      footStyles: { fontStyle: "bold", fillColor: [255, 255, 255], minCellHeight: 0 },
      columnStyles: {
        0: { cellWidth: 52 },
        1: { cellWidth: 66 },
        2: { cellWidth: 58 },
        3: { cellWidth: 100 },
        4: { cellWidth: 70 },
        5: { cellWidth: 30, halign: "right" },
        6: { cellWidth: 56, halign: "right" },
        7: { cellWidth: 60 },
        8: { cellWidth: "auto" },
        9: { cellWidth: 82 },
      },
      // columnStyles reach the body only; line the Qty / Cost headings and
      // the total up with the figures beneath them.
      didParseCell: (data) => {
        if (data.section !== "body" && (data.column.index === 5 || data.column.index === 6)) {
          data.cell.styles.halign = "right";
        }
      },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 24;
  };

  section(
    "NEEDS DISPOSITION",
    model.includeAllOpen
      ? "Every live entry still waiting on a decision, whatever its date."
      : "Live entries in this window still waiting on a decision.",
    model.needs,
    true,
  );
  section("DECIDED", "Live entries in this window that already have a disposition.", model.decided, false);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text(`MRB · ${span} · Page ${p} of ${pages}`, right, PAGE_H - 20, { align: "right" });
  }
}

// ---------------------------------------------------------------------------
// Excel — one sheet, real dates and numbers, a Status column to filter on.
// ExcelJS is INJECTED so the caller dynamic-imports it (worksheetExcel.ts).
// ---------------------------------------------------------------------------

const MONEY_FMT = '"$"#,##0.00';

function statusLabel(entry: MrbEntry): string {
  const state = mrbState(entry);
  if (state === "pending") return "To be Determined";
  if (state === "undecided") return "Needs disposition";
  return "Decided";
}

export async function buildMrbWorkbook(excel: typeof ExcelJS, model: MrbExportModel): Promise<ArrayBuffer> {
  const wb = new excel.Workbook();
  wb.creator = "Altronic ARC";
  const sheet = wb.addWorksheet("MRB");

  const columns: { header: string; width: number }[] = [
    { header: "Status", width: 18 },
    { header: "MRB Date", width: 12 },
    { header: "SAP Number", width: 16 },
    { header: ALTRONIC_PART_LABEL, width: 18 },
    { header: "Description", width: 32 },
    { header: "Vendor", width: 24 },
    { header: "Qty", width: 8 },
    { header: "Price Per Unit", width: 14 },
    { header: "Cost", width: 14 },
    { header: "Where Caused", width: 18 },
    { header: "Disposition", width: 18 },
    { header: "Reason", width: 48 },
    { header: "Comments", width: 40 },
  ];
  sheet.columns = columns.map((c) => ({ width: c.width }));

  const title = sheet.addRow(["Material Review Board", mrbWindowLabel(model.from, model.to)]);
  title.font = { bold: true, size: 13 };
  sheet.addRow([
    `${model.needs.length} need a disposition · ${model.decided.length} decided`,
    `Generated ${model.generatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
  ]);
  sheet.addRow([]);

  const header = sheet.addRow(columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEBEBEB" } };
  });
  const headerRow = header.number;

  for (const entry of [...model.needs, ...model.decided]) {
    const row = sheet.addRow([
      statusLabel(entry),
      entry.mrbDate,
      entry.sapNumber,
      entry.oldPartNumber,
      entry.description,
      entry.vendorName,
      entry.quantity,
      entry.pricePerUnit,
      entry.pricePerIssue,
      entry.whereCaused,
      dispositionText(entry),
      entry.reason,
      entry.notes,
    ]);
    row.getCell(2).numFmt = "yyyy-mm-dd";
    row.getCell(8).numFmt = MONEY_FMT;
    row.getCell(9).numFmt = MONEY_FMT;
    row.alignment = { vertical: "top", wrapText: true };
  }

  const total = sheet.addRow([
    "Total",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    mrbCostTotal([...model.needs, ...model.decided]),
  ]);
  total.font = { bold: true };
  total.getCell(9).numFmt = MONEY_FMT;

  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: columns.length },
  };

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function generateMrbWorkbook(model: MrbExportModel): Promise<Blob> {
  const excel = await import("exceljs");
  const buffer = await buildMrbWorkbook(excel, model);
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
