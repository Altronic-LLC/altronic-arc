import type { QcCpu95Record } from "@/types/task";
import {
  FIRING_LETTERS,
  qcCpu95FieldLabel,
  qcCpu95FiringGrid,
  qcCpu95StandardFiringSpecs,
  qcCpu95Variant,
  qcCpu95VisibleFields,
  QC_CPU95_FIELDS,
  type QcCpu95Variant,
} from "./qcCpu95Fields";
import { qcCpu95Altmode } from "./qcCpu95Mapper";

// =============================================================================
// QCFRM-012 (CPU-95) as the PAPER sheet — a pure layout model the PDF renderer
// (lib/qcCpu95Pdf.ts) draws.
//
// Reproduces the "95" sheet, FORM QCFRM-012 REV 2, plus its Post Test
// Inspection page — the sheet every variant is tested on (Tim, 2026-10-21).
// One sheet covers every unit, so a blank export needs no variant pick. The
// few 95C and EVS checks with no line on this sheet print on the notes line
// above Comments.
//
// Coordinates are PIXELS on the 950 × 1230 scan of the paper form (Tim,
// 2026-10-20), y = text baseline. The renderer scales them to Letter points,
// so the layout can be checked against the scan by eye.
//
// `record === null` is the blank form. A filled form prints only the fields
// `qcCpu95VisibleFields` shows for the unit — exactly what the edit form
// shows — so a stale value on a hidden field never reaches paper. A check
// prints a tick for Yes and the words for No or N/A. The second ON/OFF pair
// stays a blank line to fill in by hand, as on the blank form.
// =============================================================================

export const SHEET_WIDTH = 950;
export const SHEET_HEIGHT = 1230;

export type SheetFont = "normal" | "bold" | "italic" | "bolditalic";

export type SheetOp =
  | {
      type: "text";
      x: number;
      y: number;
      text: string;
      size?: number;
      font?: SheetFont;
      underline?: boolean;
      align?: "left" | "center" | "right";
      /** A value from the record, rather than the form's own print. */
      filled?: boolean;
    }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number }
  | { type: "rect"; x: number; y: number; w: number; h: number; fill?: boolean }
  | { type: "check"; x: number; y: number }
  /**
   * A filled value that may need more than one line — wrapped by the
   * renderer. What doesn't fit in `maxLines` is printed in full on a
   * continuation page under `title`, never cut off.
   */
  | {
      type: "wrap";
      x: number;
      y: number;
      width: number;
      lineHeight: number;
      maxLines: number;
      text: string;
      title: string;
    };

export interface SheetPage {
  ops: SheetOp[];
}

const ROW = 13; // one printed line on the scan
const BODY = 8; // pt

const LEFT = 87; // left margin of the printed text
const TICK_X1 = 87; // the left-hand tick blank
const TICK_X2 = 138;
const LABEL_X = 140;

/** "2026-10-20" → "10/20/2026"; anything else as stored. */
export function sheetDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : value.trim();
}

/**
 * The units a blank sheet can be printed for (Tim, 2026-10-21: "a select when
 * you export the blank sheet … instead of showing everything"). Each stands
 * for its part numbers by one of them; `printPartNumber` puts it on the sheet
 * when it's the only one.
 */
export interface QcCpu95BlankVariant {
  id: string;
  label: string;
  partNumber: string;
  printPartNumber?: boolean;
  /** Goes in the file name. */
  fileTag: string;
}

export const QC_CPU95_BLANK_VARIANTS: readonly QcCpu95BlankVariant[] = [
  { id: "16", label: "CPU-95, 16 cylinder (791950-16 and others)", partNumber: "791950-16", fileTag: "16 cyl" },
  { id: "8", label: "791950-08, 8 cylinder", partNumber: "791950-08", printPartNumber: true, fileTag: "791950-08" },
  { id: "18", label: "791950-18, 18 cylinder", partNumber: "791950-18", printPartNumber: true, fileTag: "791950-18" },
  { id: "20", label: "791950-20 / 791962-20, 20 cylinder", partNumber: "791950-20", fileTag: "20 cyl" },
  { id: "highVolt", label: "791952-18 / 791962-18 (140/160/180 V)", partNumber: "791962-18", fileTag: "791952-791962-18" },
  { id: "791956", label: "791956-16", partNumber: "791956-16", printPartNumber: true, fileTag: "791956-16" },
  { id: "95c", label: "CPU-95C (791955-16)", partNumber: "791955-16", printPartNumber: true, fileTag: "CPU-95C" },
  { id: "evs", label: "CPU-95 EVS (791963-16A / 791963-16E)", partNumber: "791963-16A", fileTag: "EVS" },
];

interface Ctx {
  ops: SheetOp[];
  /** Values to print; empty for the blank form. */
  values: Record<string, string>;
  visible: Set<string>;
  filled: boolean;
  /**
   * The sheet is for one unit — a filled record, or a blank printed for one
   * variant. Lines that unit doesn't use are then marked N/A in print, and
   * only its firing grid and voltage spec appear.
   */
  known: boolean;
  /** The variant a blank sheet was printed for; null otherwise. */
  sheetFor: QcCpu95BlankVariant | null;
  /** The unit's Altmode; null on the every-variant blank form. */
  altMode: number | null;
  variant: QcCpu95Variant;
  partNumber: string;
  log: { on: LogEntry | null; off: LogEntry | null };
}

interface LogEntry {
  date: string;
  time: string;
}

/** A local `yyyy-mm-ddThh:mm` (the oven ON/OFF columns) as the sheet's date and time. */
function logEntry(value: string | undefined): LogEntry | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec((value ?? "").trim());
  if (!m) return null;
  const hours = Number(m[4] ?? 0);
  return {
    date: `${m[2]}/${m[3]}/${m[1]}`,
    // Formatted by hand: toLocaleTimeString puts a narrow no-break space
    // before AM/PM, which WinAnsi can't print.
    time: m[4] ? `${hours % 12 || 12}:${m[5]} ${hours < 12 ? "AM" : "PM"}` : "",
  };
}

/**
 * The ON/OFF log entry a filled sheet prints: the oven ON and OFF the
 * operator recorded. The second pair on the paper is for a re-run in the oven
 * and is filled in by hand.
 */
export function qcCpu95LogEntries(record: QcCpu95Record | null): { on: LogEntry | null; off: LogEntry | null } {
  if (!record) return { on: null, off: null };
  return { on: logEntry(record.values.ovenOn), off: logEntry(record.values.ovenOff) };
}

function text(ctx: Ctx, x: number, y: number, t: string, opts: Partial<Extract<SheetOp, { type: "text" }>> = {}) {
  ctx.ops.push({ type: "text", x, y, text: t, size: BODY, ...opts });
}

function underline(ctx: Ctx, x1: number, x2: number, y: number) {
  ctx.ops.push({ type: "line", x1, y1: y + 2, x2, y2: y + 2 });
}

/** The record's value for `key`, or "" when blank, hidden by the Altmode, or a blank export. */
function value(ctx: Ctx, key: string): string {
  if (!ctx.filled || !ctx.visible.has(key)) return "";
  return (ctx.values[key] ?? "").trim();
}

/** An underlined blank, with the value written on it (left-aligned, or centred). */
function blank(ctx: Ctx, x1: number, x2: number, y: number, key: string | null, center = false) {
  underline(ctx, x1, x2, y);
  if (!key) return;
  const field = QC_CPU95_FIELDS.find((f) => f.key === key);
  if (field && ctx.known && !ctx.visible.has(key)) {
    // A line this unit doesn't use — printed (black), not an answer (blue).
    text(ctx, (x1 + x2) / 2, y, "N/A", { align: "center", size: 7 });
    return;
  }
  let v = value(ctx, key);
  if (!v) return;
  if (field?.kind === "flag" || (field?.kind === "check" && v === "Yes")) {
    ctx.ops.push({ type: "check", x: (x1 + x2) / 2, y });
    return;
  }
  if (field?.kind === "check") {
    // No or N/A, in words — a tick can't say either.
    text(ctx, (x1 + x2) / 2, y, v.toUpperCase(), { filled: true, align: "center", size: 7 });
    return;
  }
  if (field?.kind === "date") v = sheetDate(v);
  if (center) text(ctx, (x1 + x2) / 2, y, v, { filled: true, align: "center" });
  else text(ctx, x1 + 3, y, v, { filled: true });
}

/** A checklist row: tick blank on the left, one or more lines of print beside it. */
function tickRow(ctx: Ctx, y: number, key: string | null, ...lines: string[]) {
  blank(ctx, TICK_X1, TICK_X2, y, key, true);
  lines.forEach((line, i) => text(ctx, LABEL_X, y + i * ROW, line));
}

// ---- Page 1: the test sheet -------------------------------------------------

function header(ctx: Ctx) {
  text(ctx, 475, 83, "CPU-95 IGNITION SYSTEM - IGNITION MODULE", { size: 11, font: "bold", align: "center" });
  text(ctx, 475, 100, "ELECTRICAL TEST AND INSPECTION", { size: 11, font: "bold", align: "center" });

  // The CPU-95C sheet has APPLICATION where the 95 sheet has MEMORY NO.
  const memory: [string, string] = ctx.variant === "95c" ? ["APPLICATION", "application"] : ["MEMORY NO.", "memoryNumber"];
  const left: Array<[string, string | null]> = [
    memory,
    ["LOGIC BD. DATE CODE", "logicBoardDateCode"],
    ["POWER BD. DATE CODE", "powerBoardDateCode"],
    ["MICRO. DATE CODE", "microDateCode"],
    ["TEST MEMORY NO.", "testMemoryNumber"],
    ["TEST RPM", "testRpm"],
    ["TEST STAND NO.", "testStandNumber"],
    ["DATE TESTED", "dateTested"],
  ];
  left.forEach(([label, key], i) => {
    const y = 120 + i * ROW;
    text(ctx, LEFT, y, label);
    // Starts clear of the longest label ("POWER BD. DATE CODE" is ~150px in
    // Times) — on the paper they touch.
    blank(ctx, 250, 390, y, key, true);
  });

  const right: Array<[string, string]> = [
    ["ALTRONIC PART NO.", "altronicPartNumber"],
    ["SERIAL NUMBER", "serialNumber"],
    ["CUSTOMER", "customer"],
    ["INVOICE NO.", "invoiceNumber"],
  ];
  right.forEach(([label, key], i) => {
    const y = 120 + i * ROW;
    text(ctx, 440, y, label);
    blank(ctx, 597, 810, y, key, true);
  });
  // A blank printed for a single part number carries it.
  if (ctx.sheetFor?.printPartNumber) text(ctx, 703, 120, ctx.sheetFor.partNumber, { align: "center" });

  const note = { size: 7, font: "bolditalic" as const };
  text(ctx, LEFT, 232, "79195X-XX Program as P4A180.FD and -18 as R4T1180.FD for test when gear tooth and or total output", note);
  text(ctx, LEFT, 245, " requirements are not met in shipped memory. 791956-16 Program, test and ship as application 2416G-12", note);
}

function startup(ctx: Ctx) {
  const bold = { font: "bold" as const, underline: true };
  text(ctx, LABEL_X, 271, "INITIAL START-UP (23° C)", bold);
  // A sheet for one unit prints only its own spec on the left, so the
  // "791962-18 and 791952-18 Units only" column goes.
  const highVolt = ctx.variant === "highVolt";
  if (!ctx.known) {
    text(ctx, 385, 271, "791962-18 and", { font: "bold" });
    text(ctx, 385, 284, "791952-18 Units only", bold);
  }
  text(ctx, LEFT, 284, "20V INPUT", bold);
  text(ctx, 287, 284, "24V INPUT", bold);

  // Centred over the values written under them; COMMENTS ends with its lines.
  text(ctx, 636, 271, "DATE", { ...bold, align: "center" });
  text(ctx, 702, 271, "TIME", { ...bold, align: "center" });
  text(ctx, 810, 271, "COMMENTS", { ...bold, align: "right" });
  ["ON:", "OFF:", "ON:", "OFF:"].forEach((label, i) => {
    const y = 284 + i * ROW;
    text(ctx, 554, y, label);
    underline(ctx, 597, 810, y);
  });
  // ARC has no ON/OFF log columns. A filled sheet prints one entry (Tim,
  // 2026-10-20): ON when the sheet was created, OFF when it was signed off.
  // The second pair is for a re-run in the oven (Tim, 2026-10-21): printed,
  // left blank, filled in by hand.
  for (const [y, entry] of [
    [284, ctx.log.on],
    [297, ctx.log.off],
  ] as const) {
    if (!entry) continue;
    text(ctx, 636, y, entry.date, { filled: true, align: "center" });
    if (entry.time) text(ctx, 702, y, entry.time, { filled: true, align: "center" });
  }

  // Peak volts: 20V reading on the left, 24V reading in the middle. The
  // 791962/52-18 units read 140/160/180 V on the same two blanks.
  const volts: Array<[string, string, string, string]> = [
    ["E1", "130", "140", "1"],
    ["E2", "150", "160", "2"],
    ["E3", "170", "180", "3"],
  ];
  volts.forEach(([e, std, alt, n], i) => {
    const y = 297 + i * ROW;
    blank(ctx, TICK_X1, TICK_X2, y, `startup20v${e}`, true);
    text(ctx, LABEL_X, y, `Peak volt ${e} ${highVolt ? alt : std} V (+10/-0)`);
    blank(ctx, 285, 335, y, `startup24v${e}`, true);
    if (!ctx.known) text(ctx, 338, y, `Peak volt E${n} ${alt} V (+10/-0)`);
  });

  let y = 336;
  blank(ctx, TICK_X1, TICK_X2, y, "startup20vE3Current", true);
  text(ctx, LABEL_X, y, "E3 supply current amps");
  blank(ctx, 285, 335, y, "startup24vE3Current", true);

  // EVS counts on E1S and averages as CAVG.
  const evs = ctx.variant === "evs";
  y += ROW;
  tickRow(ctx, y, "startupLowSpeedOperation", "Low speed operation, vary speed no misfiring");
  tickRow(ctx, (y += ROW), "startupAlarmLedOff", "Alarm led off, power led on");
  tickRow(ctx, (y += ROW), "startupUnitProgram", "Unit program, RX TX leds ok.");
  tickRow(ctx, (y += ROW), "startupVerifyACountSetup", `Verify "A" count setup, shorted secondary (${evs ? "E1S" : "E3S"})`);
  y += ROW;
  blank(ctx, TICK_X1, TICK_X2, y, "startupCountAOutput", true);
  text(ctx, LABEL_X, y, `Count numer of "A" output (${evs ? "E1S" : "E3S"}),`);
  blank(ctx, 330, 362, y, "startupEavg", true);
  text(ctx, 365, y, evs ? "CAVG" : "EAVG");
}

function finalTests(ctx: Ctx) {
  const bold = { font: "bold" as const, underline: true };
  text(ctx, LABEL_X, 427, "FINAL TESTS (65°C)", bold);
  text(ctx, LEFT, 440, "20V INPUT", bold);
  text(ctx, 287, 440, "24V INPUT", bold);

  // A filled 791962/52-18 sheet prints the spec its readings were taken against.
  const alt = ctx.variant === "highVolt";
  const volts: Array<[string, string, string]> = [
    ["E1", "130", "140"],
    ["E2", "150", "160"],
    ["E3", "170", "180"],
  ];
  volts.forEach(([e, std, altV], i) => {
    const y = 453 + i * ROW;
    blank(ctx, TICK_X1, TICK_X2, y, `final${e}_20v`, true);
    text(ctx, LABEL_X, y, `Peak volt ${e} ${alt ? altV : std} V (+10/-0)`);
    blank(ctx, 285, 335, y, `final${e}_24v`, true);
  });

  let y = 492;
  blank(ctx, TICK_X1, TICK_X2, y, "finalE3Current_20v", true);
  text(ctx, LABEL_X, y, "E3 supply current amps");
  blank(ctx, 285, 335, y, "finalE3Current_24v", true);

  const evs = ctx.variant === "evs";
  y += ROW;
  blank(ctx, TICK_X1, TICK_X2, y, "finalCountAOutput", true);
  text(ctx, LABEL_X, y, `Count number of "A" output (${evs ? "E1S" : "E3S"}),`);
  blank(ctx, 330, 362, y, "finalEavg", true);
  text(ctx, 365, y, evs ? "CAVG" : "EAVG");

  tickRow(ctx, (y += ROW), "finalGndGLead", 'Gnd. "G" lead, no display "Shutdown", alarm out on,', "fault out on, fire out off (18 n/a)");
  tickRow(ctx, (y += 2 * ROW), "finalGndSD", 'Gnd. S/D, no delay, display, "Shutdown", alarm out on,', "fault out on, fire out off");
  tickRow(ctx, (y += 2 * ROW), "finalEachOutputFiring", "Each output firing consistently,", "in sequence, no multiple firing.");
  tickRow(ctx, (y += 2 * ROW), "finalMultiFire", "Multi-fire, no warnings.");
  tickRow(ctx, (y += ROW), "finalLossOfReset", 'Loss of reset, display "Fault", NO fire', "and all output switches open");
  tickRow(ctx, (y += 2 * ROW), "finalInternal4Leds", "Internal 4 leds normal operation");
  tickRow(ctx, (y += ROW), "final2032VoltInput", "20-32 Volt input, normal output operation");
  tickRow(ctx, (y += ROW), "finalShortPrimary", 'Short one primary "+" wire to ground momentarily, check for warning and proper output identifier.');
  tickRow(
    ctx,
    (y += ROW),
    "finalAlarmOutputVerify",
    'Alarm output verify (disconnect one primary coil wire ) display "primary open (appropriate designator)",',
    "alarm out off, fault out on, fire out on.",
  );
  tickRow(
    ctx,
    (y += 2 * ROW),
    "finalOpenSecondaryOutput",
    "Open one secondary output, verify display warning and designator and verify 250-255 counts on",
    "appropriate output (F1 key)",
  );
  // The four "On 791956-16" lines print on the every-variant blank and on a
  // 791956-16 sheet only — on any other unit they'd be four N/As.
  const show791956 = !ctx.known || ctx.variant === "791956";
  if (show791956) {
    blank(ctx, 452, 535, y + ROW, "final791956Timing", true);
    text(ctx, 538, y + ROW, "On 791956-16 Units, Timing set @ 3 Fixed Advance");
  }

  tickRow(ctx, (y += 2 * ROW), "finalCheckGlobalTiming", "Check global timing operation.");
  tickRow(ctx, (y += ROW), "finalAdjust2OutputTiming", "Adjust 2 output timing offsets and verify (individual).");
  tickRow(ctx, (y += ROW), "finalSaveOffsetsEeprom", "Save above offsets to EEPROM, power off-on, verify stored values.");
  tickRow(ctx, (y += ROW), "finalResetOffsetsEeprom", "Reset all offset EEPROM values back to zero, verify.");
  tickRow(ctx, (y += ROW), "finalCheck420maLoop", "Check 4-20 ma loop operation.");
  // The paper prints this one inline with no blank of its own; ARC records it
  // separately, so it gets a right-hand blank like the other 791956-16 checks.
  if (show791956) {
    blank(ctx, 452, 535, y, "final791956LossOfLoop", true);
    text(ctx, 538, y, 'On 791956-16 verify loss of loop, display "Fault"');
    text(ctx, 538, y + ROW, "no fire and all output switches open");
  }
  tickRow(ctx, (y += ROW), "finalVerifyOneStep", "Verify one step operation (ground misc. input).");
  tickRow(ctx, (y += ROW), "finalVerifyOverspeed", "Verify overspeed operation (against set value).");
  tickRow(ctx, (y += ROW), "finalVerifyTestMode", "Verify test mode (global and individual).");
  if (show791956) {
    blank(ctx, 452, 535, y, "final791956Below250Rpm", true);
    text(ctx, 538, y, "On 791956-16 verify that below 250 RPM max. energy is on");
  }
  tickRow(ctx, (y += ROW), "finalProgramOrBlankMemory", "Program or blank memory per purchase order.");
  tickRow(ctx, (y += ROW), "finalVerifyNoChecksum", "Verify no checksum or diagnostic faults.");
  if (show791956) {
    blank(ctx, 452, 535, y, "final791956CanComm", true);
    text(ctx, 538, y, "On 791956-16 verify CAN communication.");
  }
  tickRow(ctx, (y += ROW), "finalTriacLeakage", "Triac leakage test 20 µa maximum hot.");
  tickRow(ctx, (y += ROW), "finalDiodeLeakage", "Diode leakage test µa maximum hot.");

  // Current loop readings, right of the grid.
  blank(ctx, 693, 733, 635, "testCurrentLoop", true);
  text(ctx, 736, 635, "Test current loop");
  blank(ctx, 693, 733, 648, "finalCurrentLoop", true);
  text(ctx, 736, 648, "Final current loop");
}

function firingGrid(ctx: Ctx) {
  const bold = { font: "bold" as const, underline: true };
  text(ctx, 495, 349, "FIRING ANGLE SPEC.", bold);
  text(ctx, 693, 349, "FIRING ANGLE ACTUAL", bold);
  text(ctx, 497, 362, "TEST", bold);
  text(ctx, 533, 362, "SHIP", bold);
  text(ctx, 735, 362, "TEST", bold);
  text(ctx, 778, 362, "SHIP", bold);
  // A sheet for one unit prints only its grid's letter column, headed by its
  // cylinder count, and only as many rows as it has cylinders.
  const unit = ctx.known ? qcCpu95FiringGrid(ctx.altMode) : null;
  const columns = (["16", "18", "20"] as const).map((mode, col) => ({ mode, x: 590 + col * 36.5 }));
  const shownColumns = unit ? columns.filter((c) => c.mode === unit.grid) : columns;
  for (const c of shownColumns) {
    text(ctx, c.x, 362, unit ? String(unit.cylinders) : c.mode, { ...bold, align: "center" });
  }
  const lines = unit ? unit.cylinders : 20;

  // ARC records ONE spec and ONE actual per cylinder, and both are the TEST
  // figure (Tim, 2026-10-20) — SHIP stays blank. The record's slots fill the
  // unit's grid rows in order.
  const rows = ctx.filled ? qcCpu95FiringGrid(ctx.altMode).cylinders : 0;
  const atSpec = value(ctx, "firingActualsAtSpec") === "Yes";
  // A blank printed for one unit carries its standard TEST spec, in black —
  // the form's own print, as the old 95C sheet had it (Tim, 2026-10-21).
  const standard = !ctx.filled && ctx.sheetFor ? qcCpu95StandardFiringSpecs(ctx.partNumber, ctx.altMode) : null;
  for (let row = 0; row < lines; row++) {
    const y = 375 + row * ROW;
    shownColumns.forEach(({ mode, x }) => {
      const letter = FIRING_LETTERS[mode][row];
      if (letter) text(ctx, x, y, letter, { align: "center" });
    });
    underline(ctx, 495, 525, y);
    underline(ctx, 531, 565, y);
    underline(ctx, 733, 765, y);
    underline(ctx, 772, 810, y);

    const printed = standard?.[`firingSpec${String(row + 1).padStart(2, "0")}`];
    if (printed) text(ctx, 510, y, printed, { align: "center" });
    if (row >= rows) continue;
    const nn = String(row + 1).padStart(2, "0");
    const spec = value(ctx, `firingSpec${nn}`);
    const actual = atSpec ? "" : value(ctx, `firingActual${nn}`);
    if (spec) text(ctx, 510, y, spec, { filled: true, align: "center" });
    if (actual) text(ctx, 749, y, actual, { filled: true, align: "center" });
  }
  // All at spec: the line operators draw down the TEST actual column.
  if (rows && atSpec) {
    ctx.ops.push({ type: "line", x1: 749, y1: 375 - 8, x2: 749, y2: 375 + (rows - 1) * ROW });
  }
}

const VARIANT_NAME: Partial<Record<QcCpu95Variant, string>> = { "95c": "CPU-95C", evs: "CPU-95 EVS" };

/**
 * The 95C and EVS lines the 95 sheet has no place for — the fields only that
 * variant shows, by their short sheet names — as "name: value". Empty on every
 * other unit. The header's own (Application) prints in the header.
 */
export function qcCpu95VariantLines(record: QcCpu95Record): string[] {
  const partNumber = record.values.altronicPartNumber ?? "";
  const altMode = qcCpu95Altmode(partNumber);
  return variantOnlyFields(altMode, partNumber).flatMap((f) => {
    const v = (record.values[f.key] ?? "").trim();
    return v ? [`${f.sheetLabel ?? qcCpu95FieldLabel(f, altMode, partNumber)}: ${v}`] : [];
  });
}

/** The 95C / EVS fields the 95 sheet has no line for — empty on every other unit. */
function variantOnlyFields(altMode: number, partNumber: string) {
  const variant = qcCpu95Variant(altMode, partNumber);
  if (!VARIANT_NAME[variant]) return [];
  return qcCpu95VisibleFields(altMode, partNumber).filter((f) => f.only?.includes(variant) && f.section !== "Header");
}

/** A blank printed for a 95C or EVS: a tick line per check of its own, four to a line, above Comments. */
function variantBlanks(ctx: Ctx) {
  const name = VARIANT_NAME[ctx.variant];
  if (!name || ctx.altMode === null) return;
  const fields = variantOnlyFields(ctx.altMode, ctx.partNumber);
  if (fields.length === 0) return;
  text(ctx, LEFT, 881, `${name.toUpperCase()}:`, { font: "bold" });
  fields.forEach((f, i) => {
    const x = 192 + (i % 4) * 155;
    const y = 881 + Math.floor(i / 4) * 12;
    underline(ctx, x, x + 28, y);
    text(ctx, x + 31, y, f.sheetLabel ?? f.label);
  });
}

/** Every Defects / NCM flag set on the record — ARC-only, not on the paper form. */
export function qcCpu95DefectLabels(record: QcCpu95Record): string[] {
  return QC_CPU95_FIELDS.filter((f) => f.section === "Defects / NCM" && record.values[f.key] === "Yes").map(
    (f) => f.label,
  );
}

function signOff(ctx: Ctx, record: QcCpu95Record | null) {
  if (!record) variantBlanks(ctx);
  if (record) {
    // Above Comments: the 95C / EVS checks the sheet has no line for (two
    // lines, in the space after the last check), then any Defects / NCM flags
    // (one line). What doesn't fit continues on a last page.
    const defects = qcCpu95DefectLabels(record);
    const variantLines = qcCpu95VariantLines(record);
    const name = VARIANT_NAME[ctx.variant];
    if (variantLines.length > 0 && name) {
      text(ctx, LEFT, 881, `${name.toUpperCase()}:`, { font: "bold" });
      ctx.ops.push({
        type: "wrap",
        x: 192,
        y: 881,
        width: 618,
        lineHeight: 12,
        maxLines: defects.length > 0 ? 1 : 2,
        text: variantLines.join("; "),
        title: `${name} checks`,
      });
      if (defects.length > 0) {
        text(ctx, LEFT, 893, "DEFECTS / NCM:", { font: "bold" });
        ctx.ops.push({ type: "wrap", x: 192, y: 893, width: 618, lineHeight: 12, maxLines: 1, text: defects.join(", "), title: "Defects / NCM" });
      }
    } else if (defects.length > 0) {
      text(ctx, LEFT, 887, "DEFECTS / NCM:", { font: "bold" });
      ctx.ops.push({
        type: "wrap",
        x: 192,
        y: 887,
        width: 618,
        lineHeight: 12,
        maxLines: 1,
        text: defects.join(", "),
        title: "Defects / NCM",
      });
    }
  }

  text(ctx, LEFT, 905, "COMMENTS:");
  underline(ctx, 205, 810, 905);
  const comments = record ? (record.values.comments ?? "").trim() : "";
  if (comments) {
    ctx.ops.push({
      type: "wrap",
      x: 208,
      y: 905,
      width: 600,
      lineHeight: 12,
      maxLines: 2,
      text: comments,
      title: "Comments",
    });
  }

  text(ctx, LEFT, 933, "FINAL TEST BY:");
  blank(ctx, 245, 440, 933, "finalTestBy");
  text(ctx, 445, 933, "DATE");
  blank(ctx, 492, 810, 933, "finalTestDate");
  text(ctx, LEFT, 957, "FINAL INSPECTION BY:");
  blank(ctx, 245, 440, 957, "finalInspectionBy");
  text(ctx, 445, 957, "DATE");
  blank(ctx, 492, 810, 957, "finalInspectionDate");
}

function footer(ctx: Ctx, record: QcCpu95Record | null, exportedOn: string) {
  text(ctx, 475, 1005, "95", { font: "bold", align: "center" });
  text(ctx, 860, 1005, "FORM QCFRM-012  REV 2", { size: 7, font: "bold", align: "right" });
  if (ctx.sheetFor) text(ctx, LEFT, 1005, `For ${ctx.sheetFor.label}`, { size: 7, font: "bold" });
  if (record) {
    text(ctx, LEFT, 1030, `Exported from ARC on ${sheetDate(exportedOn)} — test sheet #${record.id}`, {
      size: 6,
      filled: true,
    });
  }
}

// ---- Page 2: Post Test Inspection -------------------------------------------

export const POST_TEST_INSPECTION_POINTS = [
  "Ensure label, test sheet, serial number and memory correspond to work order",
  "Ensure gasket (610674) has not shrunk and there are no tears",
  "Ensure cover board (772065) installed with 4 screws (902439)",
  "Ensure 12 pin IO plug (204014), 6 pin IO plug (204015) and 5 pin IO plug (204016)",
  "Check for programmed memory",
  "Ensure lid closed and latches secured",
  "Ensure 3 caps (510516) installed on end plate fittings",
  "Ensure connector screws are tight using Yellow-Green Torque wrench at 12 Lbf-in",
  "Ensure cap (510517) installed on connector",
  "Ensure counter sunk screws on bottom of unit are seated and tight",
  "Ensure shock mounts are correct, ground strap on right side",
  "Ensure unit is clean, no chips or scratches",
] as const;

/** The inspection columns, in POST_TEST_INSPECTION_POINTS order. */
const INSPECTION_KEYS = QC_CPU95_FIELDS.filter((f) => f.section === "Post Test Inspection").map((f) => f.key);

function inspectionPage(ctx: Ctx, record: QcCpu95Record | null) {
  // A loose filled page says whose it is.
  if (record) {
    const serial = (record.values.serialNumber ?? "").trim();
    const part = (record.values.altronicPartNumber ?? "").trim();
    const sap = (record.values.sapNumber ?? "").trim();
    text(
      ctx,
      155,
      200,
      `SERIAL NUMBER: ${serial || "—"}      ALTRONIC PART NO.: ${part || "—"}${sap ? `      SAP NO.: ${sap}` : ""}`,
      { size: 9, filled: true },
    );
  }
  text(ctx, 205, 228, "Post Test Inspection per QWI-342 and 791950 Print", { size: 10, font: "bold", underline: true });
  text(ctx, 155, 245, "This form is to be used in combination with 791950 print for part references and", { size: 9.5 });
  text(ctx, 155, 262, "QWI-342 for full final inspection criteria.", { size: 9.5 });

  const top = 266;
  const rowH = 18;
  const rows = POST_TEST_INSPECTION_POINTS.length + 1;
  ctx.ops.push({ type: "rect", x: 83, y: top, w: 727, h: rowH, fill: true });
  ctx.ops.push({ type: "rect", x: 83, y: top, w: 727, h: rowH * rows });
  for (let i = 1; i < rows; i++) ctx.ops.push({ type: "line", x1: 83, y1: top + i * rowH, x2: 810, y2: top + i * rowH });
  for (const x of [152, 200]) ctx.ops.push({ type: "line", x1: x, y1: top, x2: x, y2: top + rowH * rows });

  const base = (i: number) => top + i * rowH + 13;
  text(ctx, 117, base(0), "Yes", { size: 9.5, align: "center" });
  text(ctx, 176, base(0), "No", { size: 9.5, align: "center" });
  text(ctx, 203, base(0), "Inspection Point Criteria", { size: 9.5 });
  POST_TEST_INSPECTION_POINTS.forEach((point, i) => {
    text(ctx, 203, base(i + 1), point, { size: 9.5 });
    // Yes ticks the Yes column, No the No column; N/A is written across Yes.
    const v = value(ctx, INSPECTION_KEYS[i]);
    if (v === "Yes") ctx.ops.push({ type: "check", x: 117, y: base(i + 1) });
    else if (v === "No") ctx.ops.push({ type: "check", x: 176, y: base(i + 1) });
    else if (v === "N/A") text(ctx, 117, base(i + 1), "N/A", { size: 8, align: "center", filled: true });
  });

  text(ctx, 475, 1005, "95", { font: "bold", align: "center" });
  text(ctx, 860, 1005, "FORM QCFRM-012  REV 2", { size: 7, font: "bold", align: "right" });
  if (ctx.sheetFor) text(ctx, LEFT, 1005, `For ${ctx.sheetFor.label}`, { size: 7, font: "bold" });
}

/**
 * The paper sheet as draw operations — page 1 the test sheet, page 2 the Post
 * Test Inspection, which every unit gets (Tim, 2026-10-21: it was newly added
 * and is for all units, not only 791950). `record === null` is the blank
 * form: every line of every variant, or — given `blankVariantId`, one of
 * `QC_CPU95_BLANK_VARIANTS` — the sheet for that unit alone. `exportedOn` is
 * `yyyy-mm-dd`, passed in so the output doesn't depend on the clock.
 */
export function qcCpu95SheetLayout(
  record: QcCpu95Record | null,
  exportedOn: string,
  blankVariantId?: string | null,
): SheetPage[] {
  const sheetFor = record ? null : (QC_CPU95_BLANK_VARIANTS.find((v) => v.id === blankVariantId) ?? null);
  const partNumber = record?.values.altronicPartNumber ?? sheetFor?.partNumber ?? "";
  const known = !!record || !!sheetFor;
  const altMode = known ? qcCpu95Altmode(partNumber) : null;
  const visible = new Set(qcCpu95VisibleFields(altMode, partNumber).map((f) => f.key));
  const values = record?.values ?? {};

  const base = {
    values,
    visible,
    filled: !!record,
    known,
    sheetFor,
    altMode,
    variant: qcCpu95Variant(altMode, partNumber),
    partNumber,
    log: qcCpu95LogEntries(record),
  };
  const sheet: Ctx = { ops: [], ...base };
  header(sheet);
  startup(sheet);
  firingGrid(sheet);
  finalTests(sheet);
  signOff(sheet, record);
  footer(sheet, record, exportedOn);

  const inspection: Ctx = { ops: [], ...base };
  inspectionPage(inspection, record);
  return [{ ops: sheet.ops }, { ops: inspection.ops }];
}
