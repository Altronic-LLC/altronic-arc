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
// "Needs disposition only" (Tim, 2026-11-11) leaves the Decided section out
// altogether — the pack for a meeting that only works the backlog.
//
// Each section is split into a MAIN PLANT table and a PANELS table, by the
// Panel department flag (BusinessIT#71), so the flag itself isn't printed as
// a column. In the workbook it is a Plant column instead, to filter on.
//
// The PDF is laid out to fit on as few pages as possible while staying
// readable (Tim, 2026-11-11): narrow margins, a short page header, mm/dd/yy
// dates, every column but Reason sized to its longest value so it stays on
// one line, no minimum row height, and no Disposition column at all when only
// the entries needing one are exported. A row is as tall as its Reason wraps.
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
  /** Leave the Decided section out altogether. */
  needsOnly?: boolean;
}

export interface MrbExportModel {
  from: string;
  to: string;
  includeAllOpen: boolean;
  needsOnly: boolean;
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
  const needsOnly = options.needsOnly ?? false;
  const needs: MrbEntry[] = [];
  const decided: MrbEntry[] = [];
  for (const entry of entries) {
    if (isArchivedMrbEntry(entry)) continue;
    const key = toDateInputValue(entry.mrbDate);
    if (needsDisposition(entry)) {
      if (includeAllOpen || inWindow(key, from, to)) needs.push(entry);
    } else if (!needsOnly && mrbState(entry) === "decided" && inWindow(key, from, to)) {
      decided.push(entry);
    }
  }
  needs.sort(oldestFirst);
  decided.sort(oldestFirst);
  return { from, to, includeAllOpen, needsOnly, generatedAt, needs, decided };
}

/** Which table an entry goes in. */
export type MrbPlant = "Main plant" | "Panels";

export function mrbPlant(entry: MrbEntry): MrbPlant {
  return entry.panelDepartment ? "Panels" : "Main plant";
}

/** A section's entries split into its two tables, order kept. */
export function splitByPlant(entries: MrbEntry[]): { plant: MrbPlant; entries: MrbEntry[] }[] {
  return (["Main plant", "Panels"] as const).map((plant) => ({
    plant,
    entries: entries.filter((e) => mrbPlant(e) === plant),
  }));
}

/** The one-line count the dialog, the PDF and the workbook all show. */
export function mrbExportSummary(model: Pick<MrbExportModel, "needs" | "decided" | "needsOnly">): string {
  const needs = `${model.needs.length} need${model.needs.length === 1 ? "s" : ""} a disposition`;
  return model.needsOnly ? needs : `${needs} · ${model.decided.length} decided`;
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
const MARGIN = 28;

const FONT_SIZE = 7.5;
const PAD_X = 2.5;
/** The least the Reason may be squeezed to before other columns give way. */
const MIN_REASON_WIDTH = 150;

/** `10/05/26` — an MRB date is midday UTC, so it's read in UTC. */
export function mrbShortDate(date: Date | null): string {
  if (!date) return "";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getUTCMonth() + 1)}/${two(date.getUTCDate())}/${two(date.getUTCFullYear() % 100)}`;
}

/**
 * One PDF column.
 *
 * **Every column but Reason is sized to its longest value**, up to `cap`, so
 * it stays on one line and the row is only as tall as the Reason's wrap
 * (Tim, 2026-11-11). A value past its cap still wraps rather than being cut —
 * nothing on the page is hidden. Reason takes the width that is left.
 */
interface PdfColumn {
  head: string;
  value: (entry: MrbEntry) => string;
  align?: "right";
  /** Widest it may grow to fit its values; omitted = Reason, the rest. */
  cap?: number;
  /** A fixed width, whatever its values (the write-in Disposition). */
  fixed?: number;
}

function pdfColumns(needsOnly: boolean): PdfColumn[] {
  const columns: PdfColumn[] = [
    { head: "MRB Date", value: (e) => mrbShortDate(e.mrbDate), cap: 40 },
    { head: "SAP Number", value: (e) => e.sapNumber, cap: 72 },
    // "Old Material", for short — the field ARC calls the Altronic Part
    // Number (its SharePoint column is Old Part Number). The PDF only.
    { head: "Old Material", value: (e) => e.oldPartNumber, cap: 76 },
    { head: "Description", value: (e) => e.description, cap: 200 },
    { head: "Vendor", value: (e) => e.vendorName, cap: 110 },
    { head: "Qty", value: (e) => quantity(e.quantity), align: "right", cap: 30 },
    { head: "Cost", value: (e) => money(e.pricePerIssue), align: "right", cap: 60 },
    { head: "Where Caused", value: (e) => e.whereCaused, cap: 76 },
    { head: "Reason", value: (e) => e.reason },
  ];
  // Needs disposition only: every row would be blank there, so the column
  // goes altogether rather than costing the Reason its width.
  if (!needsOnly) columns.push({ head: "Disposition", value: dispositionText, fixed: 64 });
  return columns;
}

/**
 * Each column's width, measured with the PDF's own font over every entry in
 * the export, so all its tables line up. `undefined` is the Reason.
 */
function pdfColumnWidths(doc: jsPDF, columns: PdfColumn[], entries: MrbEntry[], totals: string[]): (number | undefined)[] {
  const widest = (texts: string[], bold: boolean) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(FONT_SIZE);
    return Math.max(0, ...texts.map((t) => doc.getTextWidth(t)));
  };
  const costCol = columns.findIndex((c) => c.head === "Cost");
  const widths = columns.map((column, i) => {
    if (column.fixed) return column.fixed;
    if (column.cap === undefined) return undefined;
    // A header may wrap between words, but never inside one.
    const headWord = widest(column.head.split(" "), true);
    // The foot puts "Total" in the column before Cost, and the totals in
    // Cost — both bold, both on one line.
    const extra = i === costCol ? widest(totals, true) : i === costCol - 1 ? widest(["Total"], true) : 0;
    const body = widest(entries.map(column.value), false);
    return Math.ceil(Math.min(column.cap, Math.max(headWord, body, extra)) + PAD_X * 2 + 1);
  });

  // Keep the Reason readable: if the others leave it too little, the two
  // widest free-text columns give way first (they then wrap, never cut).
  const avail = PAGE_W - MARGIN * 2;
  const used = () => widths.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  for (const head of ["Description", "Vendor"]) {
    const short = MIN_REASON_WIDTH - (avail - used());
    if (short <= 0) break;
    const i = columns.findIndex((c) => c.head === head);
    const w = widths[i] as number;
    widths[i] = Math.max(60, w - short);
  }
  return widths;
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
  let y = 24;

  if (logo) {
    try {
      doc.addImage(`data:image/png;base64,${ALTRONIC_WORDMARK_BLACK_PNG}`, "PNG", MARGIN, y, 110, 110 / ALTRONIC_WORDMARK_ASPECT);
    } catch {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("ALTRONIC", MARGIN, y + 14);
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text("MATERIAL REVIEW BOARD", right, y + 12, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(64, 64, 64);
  doc.text(
    `Entries dated ${span} · generated ${model.generatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
    right,
    y + 25,
    { align: "right" },
  );

  y += 33;
  doc.setDrawColor(0xcb, 0xa0, 0x52);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, y, right, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text(
    `${mrbExportSummary(model)} · ${money(mrbCostTotal([...model.needs, ...model.decided]))} total cost`,
    MARGIN,
    y,
  );
  y += 18;

  /** Start a new page if fewer than `need` points are left. */
  const room = (need: number) => {
    if (y > PAGE_H - need) {
      doc.addPage();
      y = MARGIN + 8;
    }
  };

  const columns = pdfColumns(model.needsOnly);
  const all = [...model.needs, ...model.decided];
  const totals = [model.needs, model.decided].flatMap((section) =>
    splitByPlant(section).map((g) => money(mrbCostTotal(g.entries))),
  );
  const widths = pdfColumnWidths(doc, columns, all, totals);
  const costCol = columns.findIndex((c) => c.head === "Cost");
  const columnStyles = Object.fromEntries(
    columns.map((column, i) => [
      i,
      { cellWidth: widths[i] ?? "auto", ...(column.align ? { halign: column.align } : {}) },
    ]),
  ) as UserOptions["columnStyles"];

  const plantTable = (plant: MrbPlant, entries: MrbEntry[]) => {
    // An empty table is one line saying so, never a header row over nothing.
    room(entries.length ? 70 : 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const heading = `${plant} (${entries.length})`;
    doc.text(heading, MARGIN, y);
    if (entries.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(115, 115, 115);
      doc.text("None.", MARGIN + doc.getTextWidth(heading) + 6, y);
      y += 14;
      return;
    }
    y += 4;

    const foot = columns.map(() => "");
    foot[costCol - 1] = "Total";
    foot[costCol] = money(mrbCostTotal(entries));

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: 30 },
      head: [columns.map((c) => c.head)],
      body: entries.map((entry) => columns.map((c) => c.value(entry))),
      foot: [foot],
      showFoot: "lastPage",
      // An entry never splits across a page — half a row on each sheet is
      // unreadable at the meeting table.
      rowPageBreak: "avoid",
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: FONT_SIZE,
        cellPadding: { top: 2, bottom: 2, left: PAD_X, right: PAD_X },
        textColor: [0, 0, 0],
        lineColor: [190, 190, 190],
        lineWidth: 0.5,
        valign: "top",
        // No minimum height: a row is exactly as tall as its Reason wraps.
      },
      headStyles: { fontStyle: "bold", fillColor: [235, 235, 235] },
      footStyles: { fontStyle: "bold", fillColor: [255, 255, 255] },
      columnStyles,
      // columnStyles reach the body only; line the Qty / Cost headings and
      // the total up with the figures beneath them.
      didParseCell: (data) => {
        if (data.section !== "body" && columns[data.column.index]?.align === "right") {
          data.cell.styles.halign = "right";
        }
      },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 14;
  };

  const section = (title: string, note: string, entries: MrbEntry[]) => {
    room(90);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    const heading = `${title} (${entries.length})`;
    doc.text(heading, MARGIN, y);
    const headingWidth = doc.getTextWidth(heading);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text(note, MARGIN + headingWidth + 8, y);
    y += 14;
    for (const group of splitByPlant(entries)) plantTable(group.plant, group.entries);
    y += 6;
  };

  section(
    "NEEDS DISPOSITION",
    model.includeAllOpen
      ? "Every live entry still waiting on a decision, whatever its date."
      : "Live entries in this window still waiting on a decision.",
    model.needs,
  );
  if (!model.needsOnly) {
    section("DECIDED", "Live entries in this window that already have a disposition.", model.decided);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text(`MRB · ${span} · Page ${p} of ${pages}`, right, PAGE_H - 14, { align: "right" });
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
    { header: "Plant", width: 12 },
    { header: "Disposition", width: 18 },
    { header: "Reason", width: 48 },
    { header: "Comments", width: 40 },
  ];
  sheet.columns = columns.map((c) => ({ width: c.width }));

  const title = sheet.addRow(["Material Review Board", mrbWindowLabel(model.from, model.to)]);
  title.font = { bold: true, size: 13 };
  sheet.addRow([
    mrbExportSummary(model),
    `Generated ${model.generatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
  ]);
  sheet.addRow([]);

  const header = sheet.addRow(columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEBEBEB" } };
  });
  const headerRow = header.number;

  // Main plant, then Panels, within each section — the PDF's order — with a
  // Plant column to filter on rather than a Yes / No.
  const ordered = [model.needs, model.decided].flatMap((section) =>
    splitByPlant(section).flatMap((group) => group.entries),
  );
  for (const entry of ordered) {
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
      mrbPlant(entry),
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
