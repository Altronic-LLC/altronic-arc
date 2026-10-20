import type { QcCpu95Record } from "@/types/task";
import { FIRING_LETTERS, qcCpu95VisibleFields, QC_CPU95_FIELDS } from "./qcCpu95Fields";
import { qcCpu95Altmode } from "./qcCpu95Mapper";

// =============================================================================
// QCFRM-012 (CPU-95) as the PAPER sheet — a pure layout model the PDF renderer
// (lib/qcCpu95Pdf.ts) draws.
//
// Reproduces the "95" sheet, FORM QCFRM-012 REV 2: the combined 16/18/20-cyl
// test sheet ARC's fields were built from, plus its Post Test Inspection page.
// One sheet covers every Altmode, so a blank export needs no variant pick.
// The 95C, 95C-3516, Varispark and EVS sheets carry different checklists that
// ARC has no columns for, and are not reproduced.
//
// Coordinates are PIXELS on the 950 × 1230 scan of the paper form (Tim,
// 2026-10-20), y = text baseline. The renderer scales them to Letter points,
// so the layout can be checked against the scan by eye.
//
// `record === null` is the blank form. A filled form prints only the fields
// `qcCpu95VisibleFields` shows for the record's Altmode — exactly what the
// edit form shows — so a stale value on a hidden field never reaches paper.
// Everything with no ARC column behind it (Memory No., the ON/OFF log, the
// whole inspection page) stays a blank line to fill in by hand.
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

interface Ctx {
  ops: SheetOp[];
  /** Values to print; empty for the blank form. */
  values: Record<string, string>;
  visible: Set<string>;
  filled: boolean;
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
  let v = value(ctx, key);
  if (!v) return;
  if (field?.kind === "boolean") {
    ctx.ops.push({ type: "check", x: (x1 + x2) / 2, y });
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

/** The first of `keys` the record's Altmode shows (std vs the 791962/52-18 set). */
function firstVisible(ctx: Ctx, ...keys: string[]): string {
  return keys.find((k) => ctx.visible.has(k)) ?? keys[0];
}

// ---- Page 1: the test sheet -------------------------------------------------

function header(ctx: Ctx) {
  text(ctx, 475, 83, "CPU-95 IGNITION SYSTEM - IGNITION MODULE", { size: 11, font: "bold", align: "center" });
  text(ctx, 475, 100, "ELECTRICAL TEST AND INSPECTION", { size: 11, font: "bold", align: "center" });

  const left: Array<[string, string | null]> = [
    ["MEMORY NO.", null],
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
    // Starts clear of the longest label — on the paper they touch.
    blank(ctx, 213, 345, y, key, true);
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

  const note = { size: 7, font: "bolditalic" as const };
  text(ctx, LEFT, 232, "79195X-XX Program as P4A180.FD and -18 as R4T1180.FD for test when gear tooth and or total output", note);
  text(ctx, LEFT, 245, " requirements are not met in shipped memory. 791956-16 Program, test and ship as application 2416G-12", note);
}

function startup(ctx: Ctx) {
  const bold = { font: "bold" as const, underline: true };
  text(ctx, LABEL_X, 271, "INITIAL START-UP (23° C)", bold);
  text(ctx, 385, 271, "791962-18 and", { font: "bold" });
  text(ctx, 385, 284, "791952-18 Units only", bold);
  text(ctx, LEFT, 284, "20V INPUT", bold);
  text(ctx, 287, 284, "24V INPUT", bold);

  // The ON/OFF log — no ARC columns, always blank.
  text(ctx, 645, 271, "DATE", bold);
  text(ctx, 700, 271, "TIME", bold);
  text(ctx, 760, 271, "COMMENTS", bold);
  ["ON:", "OFF:", "ON:", "OFF:"].forEach((label, i) => {
    const y = 284 + i * ROW;
    text(ctx, 554, y, label);
    underline(ctx, 597, 810, y);
  });

  // Peak volts: 20V reading on the left, 24V reading in the middle. The
  // 791962/52-18 units read 140/160/180 V on the same two blanks.
  const volts: Array<[string, string, string, string]> = [
    ["E1", "130", "140", "1"],
    ["E2", "150", "160", "2"],
    ["E3", "170", "180", "3"],
  ];
  volts.forEach(([e, std, alt, n], i) => {
    const y = 297 + i * ROW;
    blank(ctx, TICK_X1, TICK_X2, y, firstVisible(ctx, `startup20v${e}`, `startup20v${e}Alt`), true);
    text(ctx, LABEL_X, y, `Peak volt ${e} ${std} V (+10/-0)`);
    blank(ctx, 285, 335, y, firstVisible(ctx, `startup24v${e}`, `startup24v${e}Alt`), true);
    text(ctx, 338, y, `Peak volt E${n} ${alt} V (+10/-0)`);
  });

  let y = 336;
  blank(ctx, TICK_X1, TICK_X2, y, firstVisible(ctx, "startup20vE3Current", "startup20vE3CurrentAlt"), true);
  text(ctx, LABEL_X, y, "E3 supply current amps");
  blank(ctx, 285, 335, y, firstVisible(ctx, "startup24vE3Current", "startup24vE3CurrentAlt"), true);

  y += ROW;
  tickRow(ctx, y, "startupLowSpeedOperation", "Low speed operation, vary speed no misfiring");
  tickRow(ctx, (y += ROW), "startupAlarmLedOff", "Alarm led off, power led on");
  tickRow(ctx, (y += ROW), "startupUnitProgram", "Unit program, RX TX leds ok.");
  tickRow(ctx, (y += ROW), "startupVerifyACountSetup", 'Verify "A" count setup, shorted secondary (E3S)');
  y += ROW;
  blank(ctx, TICK_X1, TICK_X2, y, "startupCountAOutput", true);
  text(ctx, LABEL_X, y, 'Count numer of "A" output (E3S),');
  blank(ctx, 330, 362, y, "startupEavg", true);
  text(ctx, 365, y, "EAVG");
}

function finalTests(ctx: Ctx) {
  const bold = { font: "bold" as const, underline: true };
  text(ctx, LABEL_X, 427, "FINAL TESTS (65°C)", bold);
  text(ctx, LEFT, 440, "20V INPUT", bold);
  text(ctx, 287, 440, "24V INPUT", bold);

  // A filled 791962/52-18 sheet prints the spec its readings were taken against.
  const alt = ctx.visible.has("finalE1Alt_20v") && !ctx.visible.has("finalE1_20v");
  const volts: Array<[string, string, string]> = [
    ["E1", "130", "140"],
    ["E2", "150", "160"],
    ["E3", "170", "180"],
  ];
  volts.forEach(([e, std, altV], i) => {
    const y = 453 + i * ROW;
    blank(ctx, TICK_X1, TICK_X2, y, firstVisible(ctx, `final${e}_20v`, `final${e}Alt_20v`), true);
    text(ctx, LABEL_X, y, `Peak volt ${e} ${alt ? altV : std} V (+10/-0)`);
    blank(ctx, 285, 335, y, firstVisible(ctx, `final${e}_24v`, `final${e}Alt_24v`), true);
  });

  let y = 492;
  blank(ctx, TICK_X1, TICK_X2, y, firstVisible(ctx, "finalE3Current_20v", "finalE3CurrentAlt_20v"), true);
  text(ctx, LABEL_X, y, "E3 supply current amps");
  blank(ctx, 285, 335, y, firstVisible(ctx, "finalE3Current_24v", "finalE3CurrentAlt_24v"), true);

  y += ROW;
  blank(ctx, TICK_X1, TICK_X2, y, "finalCountAOutput", true);
  text(ctx, LABEL_X, y, 'Count number of "A" output (E3S),');
  blank(ctx, 330, 362, y, "finalEavg", true);
  text(ctx, 365, y, "EAVG");

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
  blank(ctx, 452, 535, y + ROW, "final791956Timing", true);
  text(ctx, 538, y + ROW, "On 791956-16 Units, Timing set @ 3 Fixed Advance");

  tickRow(ctx, (y += 2 * ROW), "finalCheckGlobalTiming", "Check global timing operation.");
  tickRow(ctx, (y += ROW), "finalAdjust2OutputTiming", "Adjust 2 output timing offsets and verify (individual).");
  tickRow(ctx, (y += ROW), "finalSaveOffsetsEeprom", "Save above offsets to EEPROM, power off-on, verify stored values.");
  tickRow(ctx, (y += ROW), "finalResetOffsetsEeprom", "Reset all offset EEPROM values back to zero, verify.");
  tickRow(ctx, (y += ROW), "finalCheck420maLoop", "Check 4-20 ma loop operation.");
  // The paper prints this one inline with no blank of its own; ARC records it
  // separately, so it gets a right-hand blank like the other 791956-16 checks.
  blank(ctx, 452, 535, y, "final791956LossOfLoop", true);
  text(ctx, 538, y, 'On 791956-16 verify loss of loop, display "Fault"');
  text(ctx, 538, y + ROW, "no fire and all output switches open");
  tickRow(ctx, (y += ROW), "finalVerifyOneStep", "Verify one step operation (ground misc. input).");
  tickRow(ctx, (y += ROW), "finalVerifyOverspeed", "Verify overspeed operation (against set value).");
  tickRow(ctx, (y += ROW), "finalVerifyTestMode", "Verify test mode (global and individual).");
  blank(ctx, 452, 535, y, "final791956Below250Rpm", true);
  text(ctx, 538, y, "On 791956-16 verify that below 250 RPM max. energy is on");
  tickRow(ctx, (y += ROW), "finalProgramOrBlankMemory", "Program or blank memory per purchase order.");
  tickRow(ctx, (y += ROW), "finalVerifyNoChecksum", "Verify no checksum or diagnostic faults.");
  blank(ctx, 452, 535, y, "final791956CanComm", true);
  text(ctx, 538, y, "On 791956-16 verify CAN communication.");
  tickRow(ctx, (y += ROW), "finalTriacLeakage", "Triac leakage test 20 µa maximum hot.");
  tickRow(ctx, (y += ROW), "finalDiodeLeakage", "Diode leakage test µa maximum hot.");

  // Current loop readings, right of the grid.
  blank(ctx, 693, 733, 635, "testCurrentLoop", true);
  text(ctx, 736, 635, "Test current loop");
  blank(ctx, 693, 733, 648, "finalCurrentLoop", true);
  text(ctx, 736, 648, "Final current loop");
}

/** Which cylinder grid the record's Altmode fills — one per unit. */
function activeGrid(ctx: Ctx): "16" | "18" | "20" | null {
  if (!ctx.filled) return null;
  if (ctx.visible.has("firingSpec16A")) return "16";
  if (ctx.visible.has("firingSpec18A")) return "18";
  if (ctx.visible.has("firingSpec20AL")) return "20";
  return null;
}

function firingGrid(ctx: Ctx) {
  const bold = { font: "bold" as const, underline: true };
  text(ctx, 495, 349, "FIRING ANGLE SPEC.", bold);
  text(ctx, 693, 349, "FIRING ANGLE ACTUAL", bold);
  text(ctx, 497, 362, "TEST", bold);
  text(ctx, 533, 362, "SHIP", bold);
  text(ctx, 735, 362, "TEST", bold);
  text(ctx, 778, 362, "SHIP", bold);
  text(ctx, 590, 362, "16", { ...bold, align: "center" });
  text(ctx, 626, 362, "18", { ...bold, align: "center" });
  text(ctx, 663, 362, "20", { ...bold, align: "center" });

  const grid = activeGrid(ctx);
  for (let row = 0; row < 20; row++) {
    const y = 375 + row * ROW;
    (["16", "18", "20"] as const).forEach((mode, col) => {
      const letter = FIRING_LETTERS[mode][row];
      if (letter) text(ctx, 590 + col * 36.5, y, letter, { align: "center" });
    });
    underline(ctx, 495, 525, y);
    underline(ctx, 531, 565, y);
    underline(ctx, 733, 765, y);
    underline(ctx, 772, 810, y);

    // ARC records ONE spec and ONE actual per cylinder, not separate TEST and
    // SHIP figures, so the value is written across both columns.
    const letter = grid ? FIRING_LETTERS[grid][row] : undefined;
    if (!grid || !letter) continue;
    const spec = value(ctx, `firingSpec${grid}${letter}`);
    const actual = value(ctx, `firingActual${grid}${letter}`);
    if (spec) text(ctx, 530, y, spec, { filled: true, align: "center" });
    if (actual) text(ctx, 771, y, actual, { filled: true, align: "center" });
  }
}

/** Every Defects / NCM flag set on the record — ARC-only, not on the paper form. */
export function qcCpu95DefectLabels(record: QcCpu95Record): string[] {
  return QC_CPU95_FIELDS.filter((f) => f.section === "Defects / NCM" && record.values[f.key] === "Yes").map(
    (f) => f.label,
  );
}

function signOff(ctx: Ctx, record: QcCpu95Record | null) {
  if (record) {
    const defects = qcCpu95DefectLabels(record);
    if (defects.length > 0) {
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

function inspectionPage(ctx: Ctx, record: QcCpu95Record | null) {
  // ARC has no columns for this page, so it is always blank — but a loose
  // filled sheet says whose it is.
  if (record) {
    const serial = (record.values.serialNumber ?? "").trim();
    const part = (record.values.altronicPartNumber ?? "").trim();
    text(ctx, 155, 200, `SERIAL NUMBER: ${serial || "—"}      ALTRONIC PART NO.: ${part || "—"}`, {
      size: 9,
      filled: true,
    });
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
  POST_TEST_INSPECTION_POINTS.forEach((point, i) => text(ctx, 203, base(i + 1), point, { size: 9.5 }));

  text(ctx, 475, 1005, "95", { font: "bold", align: "center" });
  text(ctx, 860, 1005, "FORM QCFRM-012  REV 2", { size: 7, font: "bold", align: "right" });
}

/**
 * The paper sheet as draw operations — page 1 the test sheet, page 2 the Post
 * Test Inspection. `record === null` is the blank form. `exportedOn` is
 * `yyyy-mm-dd`, passed in so the output doesn't depend on the clock.
 */
export function qcCpu95SheetLayout(record: QcCpu95Record | null, exportedOn: string): SheetPage[] {
  const altMode = record ? qcCpu95Altmode(record.values.altronicPartNumber ?? "") : null;
  const visible = new Set(qcCpu95VisibleFields(altMode).map((f) => f.key));
  const values = record?.values ?? {};

  const sheet: Ctx = { ops: [], values, visible, filled: !!record };
  header(sheet);
  startup(sheet);
  firingGrid(sheet);
  finalTests(sheet);
  signOff(sheet, record);
  footer(sheet, record, exportedOn);

  const inspection: Ctx = { ops: [], values, visible, filled: !!record };
  inspectionPage(inspection, record);

  return [{ ops: sheet.ops }, { ops: inspection.ops }];
}
