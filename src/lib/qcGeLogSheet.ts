import type { QcFormField, QcFormRecord } from "./qcFormEngine";
import {
  sheetBlank as blank,
  sheetDate,
  sheetText as text,
  sheetUnderline as underline,
  sheetValue as value,
  type SheetCtx,
  type SheetPage,
} from "./qcFormSheet";

// =============================================================================
// The GE log sheet as a pure layout model — the paper the GE family of QC
// forms is printed on (GET-1 first, then Series X; GEM-1/2, GEW G2, ActucomSG and
// GET-2 are the rest of Phase 1 in docs/QC-FORMS-ROADMAP.md). A form hands it a
// `GeLogSheetDef` — its title, checklist, board work orders and footer — and
// gets the draw operations the shared PDF renderer (lib/qcFormPdf.ts) prints.
// What the other GE sheets need beyond GET-1 is added when they arrive, not
// guessed now.
//
// Coordinates are PIXELS on the 950 × 1230 scan of the blank GET-1 Rev 3
// (Tim, 2026-10-26), y = text baseline. The checklist, board grid and
// sign-off follow each other down the page, so a sheet with more or fewer
// checks keeps the paper's spacing. A sheet whose paper is spaced differently
// (Series X's two-line title, tighter rows) says so in `spacing`, measured off
// its own scans; GET-1's measurements are the defaults.
//
// A check prints a tick in its box for Yes, and the words NO or N/A to the
// left of the box — where operators write N/A on the paper, which has no box
// for it. The Part Number line's box is printed and never filled (nobody
// ticks it). `record === null` is the blank form.
// =============================================================================

export const GE_SHEET_WIDTH = 950;
/** The scan's content band, title to footer — the PDF stretches it over the page. */
export const GE_SHEET_CONTENT_TOP = 66;
export const GE_SHEET_CONTENT_BOTTOM = 1205;

const BODY = 10;
const LEFT = 112; // the work-order, sign-off and notes labels
const BOX_X = 114; // a check's tick box
const BOX = 11;
const LABEL_X = 168; // a check's text
const RIGHT = 838; // the right-hand margin

const TITLE_Y = 92;

/** The gaps down the page, baseline to baseline. */
export interface GeLogSheetSpacing {
  /** Between title lines. */
  titleLineStep: number;
  /** Last title line to the subtitle. */
  subtitleGap: number;
  /** Subtitle to the Part Number / Serial line. */
  headerGap: number;
  /** That line to the first check. */
  checkGap: number;
  checkStep: number;
  /** The last check to the board heading. */
  boardsGap: number;
  /** The board heading to the first board. */
  boardRowGap: number;
  boardStep: number;
  /** Last board to the inspector line, and the inspector line to the notes. */
  signOffStep: number;
}

/** GET-1 Rev 3's spacing — the default. */
export const GE_SHEET_SPACING: GeLogSheetSpacing = {
  titleLineStep: 41,
  subtitleGap: 24,
  headerGap: 44,
  checkGap: 35,
  checkStep: 34.6,
  boardsGap: 69,
  boardRowGap: 33,
  boardStep: 33.6,
  signOffStep: 34,
};

export interface GeLogSheetBlank {
  label: string;
  key: string;
}

/** A board row: a label and its blank, or printed text alone (Series X's "No populated VD board."). */
export interface GeLogSheetBoardRow {
  label: string;
  key?: string;
}

export interface GeLogSheetDef {
  /** One string per printed line. */
  title: string | readonly string[];
  subtitle: string;
  /** The first line, behind a tick box nobody ticks. */
  partNumber: GeLogSheetBlank;
  serial: GeLogSheetBlank;
  /** One tick box per line; `blank` adds an underlined blank after the text (GET-1's firmware revision). */
  checks: ReadonlyArray<{ key: string; text: string; blank?: { key: string; x1: number; x2: number } }>;
  /** A work order per board, two columns, filled down the left first. */
  boards?: { heading: string; rows: readonly GeLogSheetBoardRow[] };
  inspector: GeLogSheetBlank;
  date: GeLogSheetBlank;
  notes: GeLogSheetBlank;
  /** Bottom right, one line each: form number, page, revision. */
  footer: readonly string[];
  /** "log sheet", for the export stamp. */
  noun: string;
  /** Where the paper differs from GET-1's spacing. */
  spacing?: Partial<GeLogSheetSpacing>;
}

function spacingOf(def: GeLogSheetDef): GeLogSheetSpacing {
  return { ...GE_SHEET_SPACING, ...def.spacing };
}

/** A tick box: a tick for Yes, the answer's words to its left for No or N/A. */
function tickBox(ctx: SheetCtx, y: number, key: string | null) {
  ctx.ops.push({ type: "rect", x: BOX_X, y: y - 10, w: BOX, h: BOX });
  if (!key) return;
  const v = value(ctx, key);
  if (v === "Yes") ctx.ops.push({ type: "check", x: BOX_X + BOX / 2, y });
  else if (v) text(ctx, BOX_X - 4, y, v.toUpperCase(), { filled: true, align: "right", size: 8 });
}

/** Draws the title and the Part Number / Serial line, and returns that line's baseline. */
function header(ctx: SheetCtx, def: GeLogSheetDef, sp: GeLogSheetSpacing): number {
  const lines = typeof def.title === "string" ? [def.title] : def.title;
  lines.forEach((line, i) =>
    text(ctx, 475, TITLE_Y + i * sp.titleLineStep, line, { size: 20, font: "bold", align: "center" }),
  );
  const subtitleY = TITLE_Y + (lines.length - 1) * sp.titleLineStep + sp.subtitleGap;
  text(ctx, 475, subtitleY, def.subtitle, { size: 11, font: "bold", underline: true, align: "center" });

  const y = subtitleY + sp.headerGap;
  tickBox(ctx, y, null);
  text(ctx, LABEL_X, y, def.partNumber.label, { size: BODY });
  blank(ctx, 305, 487, y, def.partNumber.key);
  text(ctx, 492, y, def.serial.label, { size: BODY });
  blank(ctx, 603, 818, y, def.serial.key);
  // The paper splits the serial (FM2512 / 0012T); ARC holds it whole.
  if (!ctx.filled) text(ctx, 706, y, "/", { size: BODY });
  return y;
}

/** Draws the checklist below the header line `top` and returns the last line's baseline. */
function checklist(ctx: SheetCtx, def: GeLogSheetDef, sp: GeLogSheetSpacing, top: number): number {
  let y = top;
  def.checks.forEach((check, i) => {
    y = top + sp.checkGap + i * sp.checkStep;
    tickBox(ctx, y, check.key);
    text(ctx, LABEL_X, y, check.text, { size: BODY });
    if (check.blank) blank(ctx, check.blank.x1, check.blank.x2, y, check.blank.key);
  });
  return y;
}

/** Draws the board work orders below `y` and returns the last row's baseline. */
function boards(ctx: SheetCtx, def: GeLogSheetDef, sp: GeLogSheetSpacing, y: number): number {
  if (!def.boards) return y;
  const headingY = y + sp.boardsGap;
  text(ctx, LEFT, headingY, def.boards.heading, { size: BODY });
  const rows = def.boards.rows;
  const half = Math.ceil(rows.length / 2);
  rows.forEach((row, i) => {
    const right = i >= half;
    const rowY = headingY + sp.boardRowGap + (right ? i - half : i) * sp.boardStep;
    text(ctx, right ? 448 : LEFT, rowY, row.label, { size: BODY });
    if (!row.key) return;
    // Clear of "WO#" in Times, which is wider than the paper's font.
    if (right) blank(ctx, 554, 720, rowY, row.key);
    else blank(ctx, 220, 416, rowY, row.key);
  });
  return headingY + sp.boardRowGap + (half - 1) * sp.boardStep;
}

function signOff(ctx: SheetCtx, def: GeLogSheetDef, sp: GeLogSheetSpacing, y: number) {
  const inspectorY = y + sp.signOffStep;
  text(ctx, LEFT, inspectorY, def.inspector.label, { size: BODY });
  blank(ctx, 202, 483, inspectorY, def.inspector.key);
  text(ctx, 490, inspectorY, def.date.label, { size: BODY });
  blank(ctx, 527, 690, inspectorY, def.date.key);

  const notesY = inspectorY + sp.signOffStep;
  text(ctx, LEFT, notesY, def.notes.label, { size: BODY });
  underline(ctx, 250, RIGHT, notesY);
  underline(ctx, LEFT, RIGHT, notesY + 34);
  underline(ctx, LEFT, RIGHT, notesY + 67);
  const notes = value(ctx, def.notes.key);
  if (notes) {
    // What doesn't fit on the three lines continues on a last page.
    ctx.ops.push({ type: "wrap", x: 252, y: notesY, width: 584, lineHeight: 33.5, maxLines: 3, text: notes, title: def.notes.label });
  }
}

function footer(ctx: SheetCtx, def: GeLogSheetDef, record: QcFormRecord | null, exportedOn: string) {
  def.footer.forEach((line, i) => text(ctx, RIGHT, 1162 + i * 18, line, { size: 9, align: "right" }));
  if (record) {
    text(ctx, LEFT, 1198, `Exported from ARC on ${sheetDate(exportedOn)} — ${def.noun} #${record.id}`, {
      size: 6,
      filled: true,
    });
  }
}

/**
 * The sheet as draw operations — one page. `fields` are the form's
 * descriptors (every one shows: the GE sheets have no variants); `exportedOn`
 * is `yyyy-mm-dd`, passed in so the output doesn't depend on the clock.
 */
export function geLogSheetLayout(
  def: GeLogSheetDef,
  fields: readonly QcFormField[],
  record: QcFormRecord | null,
  exportedOn: string,
): SheetPage[] {
  const ctx: SheetCtx = {
    ops: [],
    values: record?.values ?? {},
    visible: new Set(fields.map((f) => f.key)),
    filled: !!record,
    known: !!record,
    fieldByKey: Object.fromEntries(fields.map((f) => [f.key, f])),
  };
  const sp = spacingOf(def);
  const headerY = header(ctx, def, sp);
  const afterChecks = checklist(ctx, def, sp, headerY);
  const afterBoards = boards(ctx, def, sp, afterChecks);
  signOff(ctx, def, sp, afterBoards);
  footer(ctx, def, record, exportedOn);
  return [{ ops: ctx.ops }];
}
