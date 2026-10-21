// =============================================================================
// QCFRM-012 (CPU-95 Ignition Module Electrical Test and Inspection) — field
// descriptors.
//
// The columns are DATA, not code — same rule as the Drawing File Logs and
// FAIT. Every column the mapper, the list view, the giant form and the paper
// export know about is declared exactly once, here.
//
// The list is "QCFRM-012 CPU-95 Test Sheets" on Altronic_PMO (2026-10-21). Its
// layout lives in scripts/data/qc-cpu95-columns.json, which built it and which
// the migration read; `qcCpu95Fields.test.ts` fails if a `column` below isn't
// in that file, so the two can't drift. It replaced the "CPU-95" list on the
// Engineering site, whose ~230 columns had machine-generated names, a voltage
// set per variant and a firing-angle grid per cylinder count.
//
// There is still no `$select` on the read (see api/qcCpu95.ts): naming ~150
// columns makes a long URL for no gain, and `toQcCpu95Record` only reads the
// columns it knows about.
//
// WHICH FIELDS SHOW is decided by the unit's Altronic Part Number, two ways:
//
// - Its Altmode (0-6, `qcCpu95Altmode` in qcCpu95Mapper.ts) picks the firing
//   grid: 16 cylinders (0, 2), 8 (1, the 791950-08), 20 (3) or 18 (4-6).
// - Its VARIANT (`qcCpu95Variant` below) picks the checks (Tim, 2026-10-21,
//   with operations). Every variant is tested on the 95 sheet; the others
//   differ in a few lines:
//     highVolt  791952-18, 791962-18 — the base unit at 140/160/180 V peak
//     791956    791956-16 — four checks of its own
//     95c       791955-16 (CPU-95C and the 3516) — seven checks of its own, an
//               Application in place of Memory No., and some base checks gone
//     evs       791963-16A, 791963-16E — an E1 single supply current in place
//               of the peak volts, counts on E1S with a CAVG, a six-energy-
//               level check, and some base checks gone
//     base      everything else
//   Varispark is obsolete and has nothing here.
//
// A field's `only` shows it for those variants alone; `hiddenIn` hides it on
// those; `labelIn` rewords it where the paper does.
// =============================================================================

import firingSpecTable from "@/data/qcCpu95FiringSpecs.json";

export type QcCpu95FieldKind ="text" | "number" | "check" | "flag" | "date" | "datetime" | "multiline";

/** A check's answers. Blank is "not answered", never "No". */
export const QC_CPU95_CHECK_CHOICES = ["Yes", "No", "N/A"] as const;

export const QC_CPU95_SECTIONS = [
  "Header",
  "Oven Burn-in",
  "Initial Start-up",
  "Final Tests",
  "Final Checklist",
  "Firing Angles",
  "Current Loop",
  "Post Test Inspection",
  "Defects / NCM",
  "Comments & Sign-off",
] as const;
export type QcCpu95Section = (typeof QC_CPU95_SECTIONS)[number];

export type QcCpu95Variant = "base" | "highVolt" | "791956" | "95c" | "evs";

/** The part numbers behind each variant that is decided by part number alone. */
export const QC_CPU95_VARIANT_PART_NUMBERS = {
  "791956": ["791956-16"],
  "95c": ["791955-16"],
  evs: ["791963-16A", "791963-16E"],
} as const;

/** The one part number the four "On 791956-16" checks apply to. */
export const QC_CPU95_791956_PART_NUMBER = QC_CPU95_VARIANT_PART_NUMBERS["791956"][0];

/**
 * Which variant a unit is. The part-number lists win; otherwise Altmode 5/6
 * (791952-18, 791962-18) is the high-voltage unit, and anything else is base.
 * Matched trimmed and case-insensitively.
 */
export function qcCpu95Variant(altMode: number | null, partNumber: string): QcCpu95Variant {
  const pn = partNumber.trim().toUpperCase();
  for (const [variant, pns] of Object.entries(QC_CPU95_VARIANT_PART_NUMBERS)) {
    if ((pns as readonly string[]).some((p) => p.toUpperCase() === pn)) return variant as QcCpu95Variant;
  }
  return altMode === 5 || altMode === 6 ? "highVolt" : "base";
}

export interface QcCpu95Field {
  /** Domain key — how this field is stored in `QcCpu95Record.values`. */
  key: string;
  /** SharePoint internal column on the PMO list (scripts/data/qc-cpu95-columns.json). */
  column: string;
  label: string;
  kind: QcCpu95FieldKind;
  section: QcCpu95Section;
  /** Shown ONLY for these variants. */
  only?: readonly QcCpu95Variant[];
  /** Hidden for these variants. */
  hiddenIn?: readonly QcCpu95Variant[];
  /** The label on a variant whose paper words it differently. */
  labelIn?: Partial<Record<QcCpu95Variant, string>>;
  /** A firing-angle row slot, 1-20 — labelled by the unit's cylinder grid. */
  slot?: number;
  /**
   * A short name for the paper export's one notes line, for the 95C / EVS
   * checks the 95 sheet has no line for — the full wording doesn't fit.
   */
  sheetLabel?: string;
}

// The firing-angle grids' row letters, in the paper form's order. The 18-cyl
// grid adds G and H; the 20-cyl grid is left/right pairs.
const FIRING_LETTERS_16 = ["A", "B", "C", "D", "E", "F", "K", "L", "M", "N", "P", "R", "S", "T", "U", "V"] as const;
const FIRING_LETTERS_18 = ["A", "B", "C", "D", "E", "F", "G", "H", "K", "L", "M", "N", "P", "R", "S", "T", "U", "V"] as const;
const FIRING_LETTERS_20 = [
  "AL", "AR", "BL", "BR", "CL", "CR", "DL", "DR", "EL", "ER",
  "FL", "FR", "KL", "KR", "LL", "LR", "ML", "MR", "NL", "NR",
] as const;

/** Exported for the paper-sheet export, which prints all three letter columns side by side. */
export const FIRING_LETTERS: Record<"16" | "18" | "20", readonly string[]> = {
  "16": FIRING_LETTERS_16,
  "18": FIRING_LETTERS_18,
  "20": FIRING_LETTERS_20,
};

export const FIRING_SLOTS = 20;

/**
 * The unit's firing grid: which letter column it uses and how many rows it
 * fills. 791950-08 (Altmode 1) is an 8-cylinder unit on the 16-cyl letters,
 * so only A-L. `null` (the blank form) is every slot.
 */
export function qcCpu95FiringGrid(altMode: number | null): { grid: "16" | "18" | "20"; cylinders: number } {
  if (altMode === 1) return { grid: "16", cylinders: 8 };
  if (altMode === 3 || altMode === null) return { grid: "20", cylinders: 20 };
  if (altMode !== null && altMode >= 4) return { grid: "18", cylinders: 18 };
  return { grid: "16", cylinders: 16 };
}

const NOT_95C = ["95c"] as const;
const NOT_EVS = ["evs"] as const;
const ONLY_95C = ["95c"] as const;
const ONLY_EVS = ["evs"] as const;
const ONLY_791956 = ["791956"] as const;

/** A peak-volt reading — one column per blank; the spec is the variant's. */
function volt(key: string, column: string, input: "20V" | "24V", e: "E1" | "E2" | "E3", section: QcCpu95Section): QcCpu95Field {
  const spec = { E1: ["130", "140"], E2: ["150", "160"], E3: ["170", "180"] }[e];
  return {
    key,
    column,
    label: `${input} Input Peak Volt ${e} (${spec[0]}V)`,
    kind: "number",
    section,
    hiddenIn: NOT_EVS,
    labelIn: { highVolt: `${input} Input Peak Volt ${e} (${spec[1]}V)` },
  };
}

function check(key: string, column: string, label: string, section: QcCpu95Section, extra: Partial<QcCpu95Field> = {}): QcCpu95Field {
  return { key, column, label, kind: "check", section, ...extra };
}

function firingSlots(variant: "Spec" | "Actual"): QcCpu95Field[] {
  return Array.from({ length: FIRING_SLOTS }, (_, i) => {
    const nn = String(i + 1).padStart(2, "0");
    return {
      key: `firing${variant}${nn}`,
      column: `Firing${variant}${nn}`,
      label: `${variant} ${i + 1}`,
      kind: "number" as const,
      section: "Firing Angles" as const,
      slot: i + 1,
    };
  });
}

const INSPECTION: Array<[string, string, string]> = [
  ["inspLabelMatches", "InspLabelMatches", "Ensure label, test sheet, serial number and memory correspond to work order"],
  ["inspGasket", "InspGasket", "Ensure gasket (610674) has not shrunk and there are no tears"],
  ["inspCoverBoard", "InspCoverBoard", "Ensure cover board (772065) installed with 4 screws (902439)"],
  ["inspIoPlugs", "InspIoPlugs", "Ensure 12 pin IO plug (204014), 6 pin IO plug (204015) and 5 pin IO plug (204016)"],
  ["inspProgrammedMemory", "InspProgrammedMemory", "Check for programmed memory"],
  ["inspLidLatches", "InspLidLatches", "Ensure lid closed and latches secured"],
  ["inspEndPlateCaps", "InspEndPlateCaps", "Ensure 3 caps (510516) installed on end plate fittings"],
  ["inspConnectorTorque", "InspConnectorTorque", "Ensure connector screws are tight using Yellow-Green Torque wrench at 12 Lbf-in"],
  ["inspConnectorCap", "InspConnectorCap", "Ensure cap (510517) installed on connector"],
  ["inspBottomScrews", "InspBottomScrews", "Ensure counter sunk screws on bottom of unit are seated and tight"],
  ["inspShockMounts", "InspShockMounts", "Ensure shock mounts are correct, ground strap on right side"],
  ["inspClean", "InspClean", "Ensure unit is clean, no chips or scratches"],
];

export const QC_CPU95_FIELDS: QcCpu95Field[] = [
  // ---- Header ------------------------------------------------------------
  { key: "serialNumber", column: "Title", label: "Serial / Unit Number", kind: "text", section: "Header" },
  // Serial, part number and the date codes are scanned back to back with a
  // barcode reader, Enter moving to the next field — keep them first and in
  // this order.
  { key: "altronicPartNumber", column: "AltronicPartNumber", label: "Altronic Part Number", kind: "text", section: "Header" },
  { key: "logicBoardDateCode", column: "LogicBoardDateCode", label: "Logic Board Date Code", kind: "text", section: "Header" },
  { key: "powerBoardDateCode", column: "PowerBoardDateCode", label: "Power Board Date Code", kind: "text", section: "Header" },
  { key: "microDateCode", column: "MicroDateCode", label: "Micro Date Code", kind: "text", section: "Header" },
  { key: "sapNumber", column: "SapNumber", label: "SAP Number", kind: "text", section: "Header" },
  { key: "memoryNumber", column: "MemoryNumber", label: "Memory No.", kind: "text", section: "Header", hiddenIn: NOT_95C },
  { key: "application", column: "Application", label: "Application", kind: "text", section: "Header", only: ONLY_95C },
  { key: "customer", column: "Customer", label: "Customer", kind: "text", section: "Header" },
  { key: "invoiceNumber", column: "InvoiceNumber", label: "Invoice Number", kind: "text", section: "Header" },
  { key: "testMemoryNumber", column: "TestMemoryNumber", label: "Test Memory Number", kind: "text", section: "Header" },
  { key: "testRpm", column: "TestRpm", label: "Test RPM", kind: "text", section: "Header" },
  { key: "testStandNumber", column: "TestStandNumber", label: "Test Stand Number", kind: "text", section: "Header" },
  { key: "dateTested", column: "DateTested", label: "Date Tested", kind: "date", section: "Header" },
  { key: "projectReference", column: "ProjectReference", label: "Project Reference", kind: "text", section: "Header" },

  // ---- Oven burn-in: the first ON/OFF pair (the second is filled by hand) --
  { key: "ovenOn", column: "OvenOn", label: "Oven ON", kind: "datetime", section: "Oven Burn-in" },
  { key: "ovenOff", column: "OvenOff", label: "Oven OFF", kind: "datetime", section: "Oven Burn-in" },

  // ---- Initial start-up (23 °C) ------------------------------------------
  volt("startup20vE1", "Startup20vE1", "20V", "E1", "Initial Start-up"),
  volt("startup24vE1", "Startup24vE1", "24V", "E1", "Initial Start-up"),
  volt("startup20vE2", "Startup20vE2", "20V", "E2", "Initial Start-up"),
  volt("startup24vE2", "Startup24vE2", "24V", "E2", "Initial Start-up"),
  volt("startup20vE3", "Startup20vE3", "20V", "E3", "Initial Start-up"),
  volt("startup24vE3", "Startup24vE3", "24V", "E3", "Initial Start-up"),
  { key: "startup20vE3Current", column: "Startup20vE3Current", label: "20V Input E3 Supply Current (Amps)", kind: "number", section: "Initial Start-up", hiddenIn: NOT_EVS },
  { key: "startup24vE3Current", column: "Startup24vE3Current", label: "24V Input E3 Supply Current (Amps)", kind: "number", section: "Initial Start-up", hiddenIn: NOT_EVS },
  { key: "startupE1SupplyCurrent", column: "StartupE1SupplyCurrent", label: "E1 Single Supply Current (Amps)", kind: "number", section: "Initial Start-up", only: ONLY_EVS, sheetLabel: "E1 current (start-up)" },
  { key: "startupCountAOutput", column: "StartupACount", label: 'Count Number of "A" Output (E3S)', kind: "number", section: "Initial Start-up", labelIn: { evs: 'Count Number of "A" Output (E1S)' } },
  { key: "startupEavg", column: "StartupAverage", label: "EAVG", kind: "number", section: "Initial Start-up", labelIn: { evs: "CAVG" } },
  check("startupGndGProgram", "StartupGndGProgram", 'Gnd. "G" lead to program and verify display reads Shutdown', "Initial Start-up", { only: ONLY_95C, sheetLabel: "Gnd G to program" }),
  check("startupUnitProgram", "StartupUnitProgram", "Unit program, RX TX LEDs ok", "Initial Start-up", { labelIn: { "95c": "Verify RX TX LEDs flash during programming" } }),
  check("startupDisplayReady", "StartupDisplayReady", "Display reads Ready", "Initial Start-up", { only: ONLY_95C, sheetLabel: "Display Ready" }),
  check("startupLowSpeedOperation", "StartupLowSpeed", "Low speed operation, vary speed — no misfiring", "Initial Start-up", {
    labelIn: { "95c": "Low speed operation (Manual Mode), increase to 1200 RPM and switch to Auto — timing steady with advance shift" },
  }),
  check("startupAlarmLedOff", "StartupAlarmLedOff", "Alarm LED off, power LED on", "Initial Start-up", {
    labelIn: { "95c": "Alarm LED off, power LED on, hall effect LED flashing" },
  }),
  check("startupVerifyACountSetup", "StartupACountSetup", 'Verify "A" count setup, shorted secondary (E3S)', "Initial Start-up", {
    hiddenIn: NOT_95C,
    labelIn: { evs: 'Verify "A" count setup, shorted secondary (E1S)' },
  }),

  // ---- Final tests (65 °C) -------------------------------------------------
  volt("finalE1_20v", "Final20vE1", "20V", "E1", "Final Tests"),
  volt("finalE1_24v", "Final24vE1", "24V", "E1", "Final Tests"),
  volt("finalE2_20v", "Final20vE2", "20V", "E2", "Final Tests"),
  volt("finalE2_24v", "Final24vE2", "24V", "E2", "Final Tests"),
  volt("finalE3_20v", "Final20vE3", "20V", "E3", "Final Tests"),
  volt("finalE3_24v", "Final24vE3", "24V", "E3", "Final Tests"),
  { key: "finalE3Current_20v", column: "Final20vE3Current", label: "20V Input E3 Supply Current (Amps)", kind: "number", section: "Final Tests", hiddenIn: NOT_EVS },
  { key: "finalE3Current_24v", column: "Final24vE3Current", label: "24V Input E3 Supply Current (Amps)", kind: "number", section: "Final Tests", hiddenIn: NOT_EVS },
  { key: "finalE1SupplyCurrent", column: "FinalE1SupplyCurrent", label: "E1 Single Supply Current (Amps)", kind: "number", section: "Final Tests", only: ONLY_EVS, sheetLabel: "E1 current (final)" },
  { key: "finalCountAOutput", column: "FinalACount", label: 'Count Number of "A" Output (E3S)', kind: "number", section: "Final Tests", labelIn: { evs: 'Count Number of "A" Output (E1S)', "95c": 'Count Number of "A" Output (+/- 8 counts @ 23 °C)' } },
  { key: "finalEavg", column: "FinalAverage", label: "EAVG", kind: "number", section: "Final Tests", labelIn: { evs: "CAVG" } },

  // ---- Final checklist -----------------------------------------------------
  check("finalSixEnergyLevels", "FinalSixEnergyLevels", "Check all six energy levels with scope (compare to chart)", "Final Checklist", { only: ONLY_EVS, sheetLabel: "Six energy levels" }),
  check("finalGndGLead", "FinalGndGLead", 'Gnd. "G" lead — no display "Shutdown", alarm out on, fault out on, fire out off (18 n/a)', "Final Checklist", { hiddenIn: NOT_95C }),
  check("finalGndSD", "FinalGndSD", 'Gnd. S/D, no delay — display "Shutdown", alarm out on, fault out on, fire out off', "Final Checklist", { hiddenIn: NOT_95C }),
  check("finalCatFirePulses", "FinalCatFirePulses", "Verify fire pulses out at CAT controller, result of S.D. in Auto Mode", "Final Checklist", { only: ONLY_95C, sheetLabel: "CAT fire pulses" }),
  check("finalEachOutputFiring", "FinalEachOutputFiring", "Each output firing consistently, in sequence, no multiple firing", "Final Checklist"),
  check("finalMultiFire", "FinalMultiFire", "Multi-fire, no warnings", "Final Checklist", { labelIn: { "95c": "Multi strike, no warnings, Gnd. misc. input" } }),
  check("finalHDisconnect", "FinalHDisconnect", 'Press "H" disconnect — unit quits firing, displays fault, alarm LED on, G.T. error message; reset and unit starts firing', "Final Checklist", { only: ONLY_95C, sheetLabel: "H disconnect" }),
  check("finalModeMessage", "FinalModeMessage", "Verify mode message corresponds with actual mode (Manual or Auto)", "Final Checklist", { only: ONLY_95C, sheetLabel: "Mode message" }),
  check("finalLossOfReset", "FinalLossOfReset", 'Loss of reset — display "Fault", NO fire and all output switches open', "Final Checklist", { hiddenIn: NOT_95C }),
  check("finalInternal4Leds", "FinalInternal4Leds", "Internal 4 LEDs normal operation", "Final Checklist", { hiddenIn: NOT_95C }),
  check("final2032VoltInput", "Final2032VoltInput", "20-32 Volt input, normal output operation", "Final Checklist"),
  check("finalShortPrimary", "FinalShortPrimary", 'Short one primary "+" wire to ground momentarily — check for warning and proper output identifier', "Final Checklist", { hiddenIn: NOT_EVS }),
  check("finalAlarmOutputVerify", "FinalAlarmOutputVerify", 'Alarm output verify (disconnect one primary coil wire) — "primary open" with designator, alarm out off, fault out on, fire out on', "Final Checklist", {
    labelIn: { "95c": 'Open one primary "+" wire and verify warning and proper output identifier' },
  }),
  check("finalOpenSecondaryOutput", "FinalOpenSecondary", "Open one secondary output — verify warning, designator, and 250-255 counts on that output (F1 key)", "Final Checklist", {
    labelIn: { "95c": "Open one secondary output — check for warnings and proper identifier, output count = 255 (+/-5)" },
  }),
  check("final791956Timing", "Final791956Timing", "On 791956-16 units, timing set at 3° fixed advance", "Final Checklist", { only: ONLY_791956 }),
  check("finalCheckGlobalTiming", "FinalGlobalTiming", "Check global timing operation", "Final Checklist", { labelIn: { "95c": "Verify global timing adjusts correctly only in Manual Mode" } }),
  check("finalMagCal", "FinalMagCal", "Verify Mag Cal switch retards 1° per increment for a total of 15° (Manual Mode only)", "Final Checklist", { only: ONLY_95C, sheetLabel: "Mag Cal" }),
  check("finalAdjust2OutputTiming", "FinalIndividualTiming", "Adjust 2 output timing offsets and verify (individual)", "Final Checklist", {
    labelIn: { evs: "Adjust 1 output timing offsets and verify (individual)", "95c": "Verify individual timing (active both modes)" },
  }),
  check("finalSaveOffsetsEeprom", "FinalSaveOffsets", "Save offsets to EEPROM, power off-on, verify stored values", "Final Checklist", {
    labelIn: { "95c": "Verify individual timing saves to EEPROM" },
  }),
  check("finalResetOffsetsEeprom", "FinalResetOffsets", "Reset all offset EEPROM values back to zero and verify", "Final Checklist"),
  check("finalCheck420maLoop", "Final420maLoop", "Check 4-20 mA loop operation", "Final Checklist", { hiddenIn: ["95c", "evs"] }),
  check("final791956LossOfLoop", "Final791956LossOfLoop", 'On 791956-16, verify loss of loop — "Fault", no fire, all output switches open', "Final Checklist", { only: ONLY_791956 }),
  check("finalVerifyOneStep", "FinalOneStep", "Verify one-step operation (ground misc. input)", "Final Checklist", { hiddenIn: NOT_95C }),
  check("finalVerifyOverspeed", "FinalOverspeed", "Verify overspeed operation (against set value)", "Final Checklist", { labelIn: { "95c": "Verify over speed orientation" } }),
  check("finalVerifyTestMode", "FinalTestMode", "Verify test mode (global and individual)", "Final Checklist"),
  check("final791956Below250Rpm", "Final791956Below250Rpm", "On 791956-16, verify max energy is on below 250 RPM", "Final Checklist", { only: ONLY_791956 }),
  check("final791956CanComm", "Final791956CanComm", "On 791956-16, verify CAN communication", "Final Checklist", { only: ONLY_791956 }),
  check("finalTiming110Rpm", "FinalTiming110Rpm", "Timing: test program and ship program verified at 110 RPM", "Final Checklist", { only: ONLY_95C, sheetLabel: "110 RPM timing" }),
  check("finalProgramOrBlankMemory", "FinalProgramMemory", "Program or blank memory per purchase order", "Final Checklist", { hiddenIn: NOT_95C }),
  check("finalVerifyNoChecksum", "FinalNoChecksum", "Verify no checksum or diagnostic fault", "Final Checklist"),
  check("finalTriacLeakage", "FinalTriacLeakage", "Triac leakage test — 20 μA maximum hot", "Final Checklist", { hiddenIn: NOT_EVS, labelIn: { "95c": "Triac leakage 20 μA maximum (hot)" } }),
  check("finalDiodeLeakage", "FinalDiodeLeakage", "Diode leakage test — μA maximum hot", "Final Checklist", { hiddenIn: NOT_EVS, labelIn: { "95c": "Diode leakage 20 μA maximum (hot)" } }),

  // ---- Firing angles -------------------------------------------------------
  // Operators draw a line for "at spec" (Tim, 2026-10-21). Yes here means the
  // actuals stay blank; No means the actual is typed for each cylinder that
  // was off, and a blank actual is at spec.
  check("firingActualsAtSpec", "FiringActualsAtSpec", "All firing actuals at spec", "Firing Angles"),
  ...firingSlots("Spec"),
  ...firingSlots("Actual"),

  // ---- Current loop ----------------------------------------------------------
  { key: "testCurrentLoop", column: "TestCurrentLoop", label: "Test Current Loop", kind: "number", section: "Current Loop", hiddenIn: NOT_95C },
  { key: "finalCurrentLoop", column: "FinalCurrentLoop", label: "Final Current Loop", kind: "number", section: "Current Loop", hiddenIn: NOT_95C },

  // ---- Post Test Inspection — every unit -------------------------------------
  ...INSPECTION.map(([key, column, label]) => check(key, column, label, "Post Test Inspection")),

  // ---- Defects / NCM (flags, not checks) ---------------------------------------
  { key: "inRepair", column: "InRepair", label: "In Repair", kind: "flag", section: "Defects / NCM" },
  { key: "aeSolderDefect", column: "AESolderDefect", label: "AE Solder Defect", kind: "flag", section: "Defects / NCM" },
  { key: "processSolderDefect", column: "ProcessSolderDefect", label: "Process Solder Defect", kind: "flag", section: "Defects / NCM" },
  { key: "aeWiringDeficiency", column: "AEWiringDeficiency", label: "AE Wiring Deficiency", kind: "flag", section: "Defects / NCM" },
  { key: "aeWrongOrMissingComponent", column: "AEWrongOrMissingComponent", label: "AE Wrong or Missing Component", kind: "flag", section: "Defects / NCM" },
  { key: "aeAssemblyDeficiency", column: "AEAssemblyDeficiency", label: "AE Assembly Deficiency", kind: "flag", section: "Defects / NCM" },
  { key: "aeIdentificationDeficiency", column: "AEIdentificationDeficiency", label: "AE Identification Deficiency", kind: "flag", section: "Defects / NCM" },
  { key: "programmingFirmware", column: "ProgrammingFirmware", label: "Programming / Firmware", kind: "flag", section: "Defects / NCM" },
  { key: "coatingPottingDeficiency", column: "CoatingPottingDeficiency", label: "Coating / Potting Deficiency", kind: "flag", section: "Defects / NCM" },
  { key: "machinePartPlacementDeficiency", column: "MachinePartPlacementDeficiency", label: "Machine Part Placement Deficiency", kind: "flag", section: "Defects / NCM" },
  { key: "physicalDamage", column: "PhysicalDamage", label: "Physical Damage", kind: "flag", section: "Defects / NCM" },
  { key: "ncmVendor", column: "NCMVendor", label: "NCM Vendor", kind: "flag", section: "Defects / NCM" },
  { key: "ncmInternal", column: "NCMInternal", label: "NCM Internal", kind: "flag", section: "Defects / NCM" },
  { key: "other", column: "OtherDefect", label: "Other", kind: "flag", section: "Defects / NCM" },

  // ---- Comments & Sign-off ---------------------------------------------------
  { key: "comments", column: "Comments", label: "Comments", kind: "multiline", section: "Comments & Sign-off" },
  { key: "finalTestBy", column: "FinalTestBy", label: "Final Test By", kind: "text", section: "Comments & Sign-off" },
  { key: "finalTestDate", column: "FinalTestDate", label: "Final Test Date", kind: "date", section: "Comments & Sign-off" },
  { key: "finalInspectionBy", column: "FinalInspectionBy", label: "Final Inspection By", kind: "text", section: "Comments & Sign-off" },
  { key: "finalInspectionDate", column: "FinalInspectionDate", label: "Final Inspection Date", kind: "date", section: "Comments & Sign-off" },
];

export const QC_CPU95_FIELD_BY_KEY: Record<string, QcCpu95Field> = Object.fromEntries(
  QC_CPU95_FIELDS.map((f) => [f.key, f]),
);

export function qcCpu95FieldsInSection(section: QcCpu95Section): QcCpu95Field[] {
  return QC_CPU95_FIELDS.filter((f) => f.section === section);
}

/**
 * Fields to render for a unit: its variant's checks (`only` / `hiddenIn`) and
 * its firing grid's rows. Passing `null` for the Altmode — the blank form,
 * printed before anyone knows the unit — shows everything.
 */
export function qcCpu95VisibleFields(altMode: number | null, partNumber = ""): QcCpu95Field[] {
  if (altMode === null) return QC_CPU95_FIELDS;
  const variant = qcCpu95Variant(altMode, partNumber);
  const { cylinders } = qcCpu95FiringGrid(altMode);
  return QC_CPU95_FIELDS.filter((f) => {
    if (f.only && !f.only.includes(variant)) return false;
    if (f.hiddenIn?.includes(variant)) return false;
    if (f.slot && f.slot > cylinders) return false;
    return true;
  });
}

/**
 * The standard TEST firing-angle spec per part number, as `[offset, pair]`
 * (Tim, 2026-10-21). The test spec is set by the TEST PROGRAM the unit is
 * loaded with, not by the unit — the 95C and the 3516 both test on CAT16TST,
 * so they share one spec. Operators write the first three angles and an
 * arrow — "0, 45, 90 ↓" — and the arrow means the pattern carries on:
 * cylinder pairs `pair` degrees apart, the second of each pair `offset`
 * after the first, wrapping at 360. The REV 2 workbook pre-prints exactly
 * that on the sheets that have it: CPU-95C and CPU-95C 3516 read 0, 60, 90,
 * 150, 180, 240, 270, 330 and again for M-V ([60, 90]); Varispark reads
 * 0, 45 … 315 twice ([45, 90]).
 *
 * The rest are read off the 2025 paper sheets. A unit not listed — or one
 * whose spec comes from a customer sheet, like 708939 ("Per sheet") — starts
 * blank and the operator types it.
 *
 * The table is src/data/qcCpu95FiringSpecs.json, shared with the backfill
 * script, so a spec change is an edit there. Each sheet stores its own specs,
 * so one already saved keeps the spec it was tested to.
 */
export const QC_CPU95_STANDARD_FIRING_SPECS: Record<string, readonly [offset: number, pair: number]> =
  Object.fromEntries(firingSpecTable.specs.map((s) => [s.partNumber, [s.offset, s.pair] as const]));

/** Upper case, trimmed, and a bare one-digit suffix padded ("791950-8" is 791950-08). */
function standardSpecKey(partNumber: string): string {
  return partNumber.trim().toUpperCase().replace(/-(\d)$/, "-0$1");
}

/**
 * The standard spec for a unit, keyed by firing-spec field (`firingSpec01`…),
 * one value per cylinder on its grid and `""` for every slot past it — or
 * `null` when the part number has no standard.
 */
export function qcCpu95StandardFiringSpecs(partNumber: string, altMode: number | null): Record<string, string> | null {
  const key = standardSpecKey(partNumber);
  const pattern = Object.entries(QC_CPU95_STANDARD_FIRING_SPECS).find(([pn]) => pn.toUpperCase() === key)?.[1];
  if (!pattern || altMode === null) return null;
  const [offset, pair] = pattern;
  const { cylinders } = qcCpu95FiringGrid(altMode);
  return Object.fromEntries(
    Array.from({ length: FIRING_SLOTS }, (_, i) => {
      const angle = (Math.floor(i / 2) * pair + (i % 2) * offset) % 360;
      return [`firingSpec${String(i + 1).padStart(2, "0")}`, i < cylinders ? String(angle) : ""];
    }),
  );
}

/** A section's title — the firing angles name the unit's cylinder count. */
export function qcCpu95SectionTitle(section: QcCpu95Section, altMode: number | null): string {
  if (section === "Firing Angles" && altMode !== null) {
    return `Firing Angles — ${qcCpu95FiringGrid(altMode).cylinders} Cyl`;
  }
  return section;
}

/** The cylinder letter a firing slot is on this unit's grid ("A", "G", "AL"…). */
export function qcCpu95FiringLetter(slot: number, altMode: number | null): string {
  return FIRING_LETTERS[qcCpu95FiringGrid(altMode).grid][slot - 1] ?? String(slot);
}

/** A field's label for this unit — the variant's own wording where the paper differs. */
export function qcCpu95FieldLabel(field: QcCpu95Field, altMode: number | null, partNumber = ""): string {
  if (field.slot) return qcCpu95FiringLetter(field.slot, altMode);
  if (altMode === null) return field.label;
  return field.labelIn?.[qcCpu95Variant(altMode, partNumber)] ?? field.label;
}

/** A blank values bag — every descriptor key set to `""`. Shared by mock data and the create form. */
export function qcCpu95EmptyValues(): Record<string, string> {
  return Object.fromEntries(QC_CPU95_FIELDS.map((f) => [f.key, ""]));
}
