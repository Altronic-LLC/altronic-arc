// =============================================================================
// QCFRM-012 (CPU-95 Ignition Module Electrical Test and Inspection) — field
// descriptors.
//
// The columns are DATA, not code — same rule as the Drawing File Logs and
// FAIT. Every column the mapper, the list view and the giant form know about
// is declared exactly once, here. Internal SharePoint column names below were
// confirmed against a live schema export (scripts/cpu-95-schema.json,
// discover-list.ps1) rather than guessed.
//
// "Project Tag" (internal name `ProjectTag`) IS a real column — a multi-value
// lookup into the Projects list, the same list Tasks/EIRs/ECNs point at — but
// it's deliberately NOT mapped here yet. Wiring it in means the same
// join-and-render treatment those other lists give a Project Reference, which
// is a small feature of its own, not a field-name fix.
//
// There is deliberately NO `$select` on the CPU-95 read at all (see
// api/qcCpu95.ts) — with ~200 columns, a $select naming every one of them
// produced a request URL close to 5,000 characters, which came back as a
// bare 404 "UnknownError" with no rows (found live, 2026-09-17). Every other
// wide list in ARC (FAIT at 51 columns, the ECN checklist's single JSON blob)
// stays well under that; CPU-95 is the one list actually wide enough to hit
// it. `toQcCpu95Record` already only reads the columns it knows about, so an
// unfiltered `$expand=fields` costs a larger response, never a wrong one.
//
// Which fields apply to which paper variant (Altmode 0-6, see
// `qcCpu95Mapper.ts`) — from `Form1_Altmode_Visible_Fields.csv` (Ray,
// 2026-09-17). Only the fields named in that export carry an `altModes` list
// below; everything else (header, the general checklist, defects, sign-off,
// EAVG/current-loop numbers) had no condition in the export and is treated as
// always-visible, same as before. The five conditions in the CSV collapse to
// five Altmode sets:
//
//   Altmode < 5   → [0, 1, 2, 3, 4]   the standard 130/150/170V spec fields
//   Altmode > 4   → [5, 6]            the 791962/52-18 140/160/180V fields
//                                      + the four "On 791956-16" checks
//   Altmode < 3   → [0, 1, 2]         Firing Angle Spec/Actual 16-cyl
//   Altmode > 3   → [4, 5, 6]         Firing Angle Spec/Actual 18-cyl
//   Altmode = 3   → [3]               Firing Angle Spec/Actual 20-cyl
// =============================================================================

const ALTMODE_LT_5 = [0, 1, 2, 3, 4] as const;
const ALTMODE_GT_4 = [5, 6] as const;
const ALTMODE_LT_3 = [0, 1, 2] as const;
const ALTMODE_GT_3 = [4, 5, 6] as const;
const ALTMODE_EQ_3 = [3] as const;

export type QcCpu95FieldKind = "text" | "number" | "boolean" | "date" | "multiline";

export const QC_CPU95_SECTIONS = [
  "Header",
  "Startup — 20V / 24V Input",
  "Final — 20V / 24V Input",
  "Final Checklist",
  "Firing Angle Spec — 16 Cyl",
  "Firing Angle Spec — 18 Cyl",
  "Firing Angle Spec — 20 Cyl",
  "Firing Angle Actual — 16 Cyl",
  "Firing Angle Actual — 18 Cyl",
  "Firing Angle Actual — 20 Cyl",
  "Current Loop",
  "Defects / NCM",
  "Comments & Sign-off",
] as const;
export type QcCpu95Section = (typeof QC_CPU95_SECTIONS)[number];

export interface QcCpu95Field {
  /** Domain key — how this field is stored in `QcCpu95Record.values`. */
  key: string;
  /** SharePoint internal column (StaticName), from a live schema export. */
  column: string;
  label: string;
  kind: QcCpu95FieldKind;
  section: QcCpu95Section;
  /**
   * Which Altmode(s) (0-6) this field prints on. `undefined` = every
   * variant — the default until the per-variant mapping is supplied. See the
   * file header comment.
   */
  altModes?: readonly number[];
}

// 16 and 18 cylinders do NOT share one letter set — confirmed against the
// live schema (scripts/cpu-95-schema.json, 2026-09-17): the 18-cylinder grid
// has 18 columns (adds G and H), the 16-cylinder grid has 16. Sharing one
// alphabet between them (as an earlier version of this file did, guessing
// from the CSV alone) silently dropped the 18-cyl G/H columns from every
// $select and from the form.
const FIRING_LETTERS_16 = [
  "A", "B", "C", "D", "E", "F", "K", "L", "M", "N", "P", "R", "S", "T", "U", "V",
] as const;
const FIRING_LETTERS_18 = [
  "A", "B", "C", "D", "E", "F", "G", "H", "K", "L", "M", "N", "P", "R", "S", "T", "U", "V",
] as const;
const FIRING_LETTERS_20 = [
  "AL", "AR", "BL", "BR", "CL", "CR", "DL", "DR", "EL", "ER",
  "FL", "FR", "KL", "KR", "LL", "LR", "ML", "MR", "NL", "NR",
] as const;

const FIRING_LETTERS: Record<"16" | "18" | "20", readonly string[]> = {
  "16": FIRING_LETTERS_16,
  "18": FIRING_LETTERS_18,
  "20": FIRING_LETTERS_20,
};

const FIRING_ALTMODES: Record<"16" | "18" | "20", readonly number[]> = {
  "16": ALTMODE_LT_3,
  "18": ALTMODE_GT_3,
  "20": ALTMODE_EQ_3,
};

function firingAngleFields(mode: "16" | "18" | "20", variant: "Spec" | "Actual"): QcCpu95Field[] {
  const letters = FIRING_LETTERS[mode];
  const section = `Firing Angle ${variant} — ${mode} Cyl` as QcCpu95Section;
  return letters.map((letter) => ({
    key: `firing${variant}${mode}${letter}`,
    column: `FiringAngle${variant}${mode}${letter}`,
    label: `${mode}${letter}`,
    kind: "number" as const,
    section,
    altModes: FIRING_ALTMODES[mode],
  }));
}

export const QC_CPU95_FIELDS: QcCpu95Field[] = [
  // ---- Header ------------------------------------------------------------
  { key: "serialNumber", column: "Title", label: "Serial / Unit Number", kind: "text", section: "Header" },
  { key: "altronicPartNumber", column: "AltronicPartNumber", label: "Altronic Part Number", kind: "text", section: "Header" },
  { key: "logicBoardDateCode", column: "LogicBd_x002e_DateCode", label: "Logic Board Date Code", kind: "text", section: "Header" },
  { key: "powerBoardDateCode", column: "PowerBoardDateCode", label: "Power Board Date Code", kind: "text", section: "Header" },
  { key: "microDateCode", column: "MicroDateCode", label: "Micro Date Code", kind: "text", section: "Header" },
  { key: "customer", column: "Customer", label: "Customer", kind: "text", section: "Header" },
  { key: "invoiceNumber", column: "InvoiceNumber", label: "Invoice Number", kind: "text", section: "Header" },
  { key: "testMemoryNumber", column: "TestMemoryNumber", label: "Test Memory Number", kind: "text", section: "Header" },
  { key: "testRpm", column: "TestRPM", label: "Test RPM", kind: "text", section: "Header" },
  { key: "testStandNumber", column: "TestStandNumber", label: "Test Stand Number", kind: "text", section: "Header" },
  { key: "dateTested", column: "DateTested", label: "Date Tested", kind: "date", section: "Header" },

  // ---- Startup — 20V / 24V Input ------------------------------------------
  { key: "startup20vE1", column: "StartupPeakvoltE1130V", label: "20V Input Peak Volt E1 (130V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "startup24vE1", column: "Startup24VInputPeakvoltE1130V", label: "24V Input Peak Volt E1 (130V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "startup20vE2", column: "StartupPeakVoltE2150V", label: "20V Input Peak Volt E2 (150V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "startup24vE2", column: "Startup24VInputPeakVoltE2150V", label: "24V Input Peak Volt E2 (150V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "startup20vE3", column: "StartupPeakVoltE3170V", label: "20V Input Peak Volt E3 (170V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "startup24vE3", column: "Startup24VInputPeakVoltE3170V", label: "24V Input Peak Volt E3 (170V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "startup20vE3Current", column: "E3SupplyCurrent", label: "20V Input E3 Supply Current (Amps)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "startup24vE3Current", column: "Startup24VInputE3SupplyCurrentAm", label: "24V Input E3 Supply Current (Amps)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "startup20vE1Alt", column: "_x0037_91962_x002f_52_x002d_18St", label: "791962/52-18 20V Input Peak Volt E1 (140V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "startup24vE1Alt", column: "_x0037_91962_x002f_52_x002d_18St3", label: "791962/52-18 24V Input Peak Volt E1 (140V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "startup20vE2Alt", column: "_x0037_91962_x002f_52_x002d_18St0", label: "791962/52-18 20V Input Peak Volt E2 (160V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "startup24vE2Alt", column: "_x0037_91962_x002f_52_x002d_18St4", label: "791962/52-18 24V Input Peak Volt E2 (160V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "startup20vE3Alt", column: "_x0037_91962_x002f_52_x002d_18St1", label: "791962/52-18 20V Input Peak Volt E3 (180V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "startup24vE3Alt", column: "_x0037_91962_x002f_52_x002d_18St5", label: "791962/52-18 24V Input Peak Volt E3 (180V)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "startup20vE3CurrentAlt", column: "_x0037_91962_x002f_52_x002d_18St2", label: "791962/52-18 20V Input E3 Supply Current (Amps)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "startup24vE3CurrentAlt", column: "_x0037_91962_x002f_52_x002d_18St6", label: "791962/52-18 24V Input E3 Supply Current (Amps)", kind: "number", section: "Startup — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "startupCountAOutput", column: "CountnumberofAoutput_x0028_E3S_x", label: 'Count Number of "A" Output (E3S)', kind: "number", section: "Startup — 20V / 24V Input" },
  { key: "startupEavg", column: "StartupEAVG", label: "EAVG", kind: "number", section: "Startup — 20V / 24V Input" },
  { key: "startupLowSpeedOperation", column: "StartupLowspeedoperation_x002c_v", label: "Low speed operation, vary speed — no misfiring", kind: "boolean", section: "Startup — 20V / 24V Input" },
  { key: "startupAlarmLedOff", column: "AlarmLEDoff_x002c_powerLEDon", label: "Alarm LED off, power LED on", kind: "boolean", section: "Startup — 20V / 24V Input" },
  { key: "startupUnitProgram", column: "UnitProgram_x002c_RXTXLEDSok", label: "Unit program, RX TX LEDs ok", kind: "boolean", section: "Startup — 20V / 24V Input" },
  { key: "startupVerifyACountSetup", column: "VerifyAcountsetup_x002c_shorteds", label: 'Verify "A" count setup, shorted secondary (E3S)', kind: "boolean", section: "Startup — 20V / 24V Input" },

  // ---- Final — 20V / 24V Input ---------------------------------------------
  { key: "finalE1_20v", column: "FinalPeakvoltE1130V", label: "20V Input Peak Volt E1 (130V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "finalE1_24v", column: "Final24VInputPeakVoltE1130V", label: "24V Input Peak Volt E1 (130V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "finalE2_20v", column: "FinalPeakVoltE2150V", label: "20V Input Peak Volt E2 (150V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "finalE2_24v", column: "Final24VInputPeakVoltE2150V", label: "24V Input Peak Volt E2 (150V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "finalE3_20v", column: "FinalPeakVoltE3170V", label: "20V Input Peak Volt E3 (170V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "finalE3_24v", column: "Final24VInputPeakVoltE3170V", label: "24V Input Peak Volt E3 (170V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "finalE3Current_20v", column: "FinalE3supplycurrentamps", label: "20V Input E3 Supply Current (Amps)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "finalE3Current_24v", column: "Final24VInputE3supplycurrentamps", label: "24V Input E3 Supply Current (Amps)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_LT_5 },
  { key: "finalE1Alt_20v", column: "_x0037_91962_x002f_52_x002d_18Fi", label: "791962/52-18 20V Input Peak Volt E1 (140V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "finalE1Alt_24v", column: "_x0037_91962_x002f_52_x002d_18Fi3", label: "791962/52-18 24V Input Peak Volt E1 (140V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "finalE2Alt_20v", column: "_x0037_91962_x002f_52_x002d_18Fi0", label: "791962/52-18 20V Input Peak Volt E2 (160V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "finalE2Alt_24v", column: "_x0037_91962_x002f_52_x002d_18Fi4", label: "791962/52-18 24V Input Peak Volt E2 (160V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "finalE3Alt_20v", column: "_x0037_91962_x002f_52_x002d_18Fi1", label: "791962/52-18 20V Input Peak Volt E3 (180V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "finalE3Alt_24v", column: "_x0037_91962_x002f_52_x002d_18Fi5", label: "791962/52-18 24V Input Peak Volt E3 (180V)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "finalE3CurrentAlt_20v", column: "_x0037_91962_x002f_52_x002d_18Fi2", label: "791962/52-18 20V Input E3 Supply Current (Amps)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "finalE3CurrentAlt_24v", column: "_x0037_91962_x002f_52_x002d_18Fi6", label: "791962/52-18 24V Input E3 Supply Current (Amps)", kind: "number", section: "Final — 20V / 24V Input", altModes: ALTMODE_GT_4 },
  { key: "finalCountAOutput", column: "FinalCountnumberofAoutput_x0028_", label: 'Count Number of "A" Output (E3S)', kind: "number", section: "Final — 20V / 24V Input" },
  { key: "finalEavg", column: "FinalEAVG", label: "EAVG", kind: "number", section: "Final — 20V / 24V Input" },

  // ---- Final Checklist -----------------------------------------------------
  { key: "finalGndGLead", column: "FinalGnd_x002e_Glead_x002c_nodis", label: 'Gnd. "G" lead — no display "Shutdown", alarm out on, fault out on, fire out off (18 n/a)', kind: "boolean", section: "Final Checklist" },
  { key: "finalGndSD", column: "Gnd_x002e_S_x002f_D_x002c_nodisp", label: 'Gnd. S/D, no delay — display "Shutdown", alarm out on, fault out on, fire out off', kind: "boolean", section: "Final Checklist" },
  { key: "finalEachOutputFiring", column: "Eachoutputfiringconsistently_x00", label: "Each output firing consistently, in sequence, no multiple firing", kind: "boolean", section: "Final Checklist" },
  { key: "finalMultiFire", column: "Multi_x002d_fire_x002c_nowarning", label: "Multi-fire, no warnings", kind: "boolean", section: "Final Checklist" },
  { key: "finalLossOfReset", column: "Lossofreset_x002c_displayFault_x", label: 'Loss of reset — display "Fault", NO fire and all output switches open', kind: "boolean", section: "Final Checklist" },
  { key: "finalInternal4Leds", column: "Internal4ledsnormaloperation", label: "Internal 4 LEDs normal operation", kind: "boolean", section: "Final Checklist" },
  { key: "final2032VoltInput", column: "_x0032_0_x002d_32Voltinput_x002c", label: "20-32 Volt input, normal output operation", kind: "boolean", section: "Final Checklist" },
  { key: "finalShortPrimary", column: "Shortoneprimary_x002b_wiretogrou", label: 'Short one primary "+" wire to ground momentarily — check for warning and proper output identifier', kind: "boolean", section: "Final Checklist" },
  { key: "finalAlarmOutputVerify", column: "Alarmoutputverify_x0028_disconne", label: 'Alarm output verify (disconnect one primary coil wire) — "primary open" with designator, alarm out off, fault out on, fire out on', kind: "boolean", section: "Final Checklist" },
  { key: "finalOpenSecondaryOutput", column: "Openonesecondaryoutput_x002c_ver", label: "Open one secondary output — verify warning, designator, and 250-255 counts on that output (F1 key)", kind: "boolean", section: "Final Checklist" },
  { key: "final791956Timing", column: "On791956_x002d_16Units_x002c_Tim", label: "On 791956-16 units, timing set at 3° fixed advance", kind: "boolean", section: "Final Checklist", altModes: ALTMODE_GT_4 },
  { key: "finalCheckGlobalTiming", column: "Checkglobaltimingoperation", label: "Check global timing operation", kind: "boolean", section: "Final Checklist" },
  { key: "finalAdjust2OutputTiming", column: "Adjust2outputtimingoffsetsandver", label: "Adjust 2 output timing offsets and verify (individual)", kind: "boolean", section: "Final Checklist" },
  { key: "finalSaveOffsetsEeprom", column: "SaveoffsetstoEEPROM_x002c_powero", label: "Save offsets to EEPROM, power off-on, verify stored values", kind: "boolean", section: "Final Checklist" },
  { key: "finalResetOffsetsEeprom", column: "ResetalloffsetEEPROMvaluesbackto", label: "Reset all offset EEPROM values back to zero and verify", kind: "boolean", section: "Final Checklist" },
  { key: "finalCheck420maLoop", column: "Check4_x002d_20mAloopoperation", label: "Check 4-20 mA loop operation", kind: "boolean", section: "Final Checklist" },
  { key: "final791956LossOfLoop", column: "On791956_x002d_16verifylossoflop", label: 'On 791956-16, verify loss of loop — "Fault", no fire, all output switches open', kind: "boolean", section: "Final Checklist" },
  { key: "finalVerifyOneStep", column: "Verifyonestepoperation_x0028_gro", label: "Verify one-step operation (ground misc. input)", kind: "boolean", section: "Final Checklist" },
  { key: "finalVerifyOverspeed", column: "Verifyoverspeedoperation_x0028_a", label: "Verify overspeed operation (against set value)", kind: "boolean", section: "Final Checklist" },
  { key: "finalVerifyTestMode", column: "Verifytestmode_x0028_globalandin", label: "Verify test mode (global and individual)", kind: "boolean", section: "Final Checklist" },
  { key: "final791956Below250Rpm", column: "On791956_x002d_16verifythatbelow", label: "On 791956-16, verify max energy is on below 250 RPM", kind: "boolean", section: "Final Checklist" },
  { key: "final791956CanComm", column: "On791956_x002d_16verifyCANcommun", label: "On 791956-16, verify CAN communication", kind: "boolean", section: "Final Checklist" },
  { key: "finalProgramOrBlankMemory", column: "Programorblankmemoryperpurchaseo", label: "Program or blank memory per purchase order", kind: "boolean", section: "Final Checklist" },
  { key: "finalVerifyNoChecksum", column: "Verifynochecksumordiagnosticfaul", label: "Verify no checksum or diagnostic fault", kind: "boolean", section: "Final Checklist" },
  { key: "finalTriacLeakage", column: "Triacleakagetest20_x03bc_Amaximu", label: "Triac leakage test — 20 μA maximum hot", kind: "boolean", section: "Final Checklist" },
  { key: "finalDiodeLeakage", column: "Diodeleakagetest_x03bc_Amaximumh", label: "Diode leakage test — μA maximum hot", kind: "boolean", section: "Final Checklist" },

  // ---- Firing angle grids (generated) --------------------------------------
  ...firingAngleFields("16", "Spec"),
  ...firingAngleFields("18", "Spec"),
  ...firingAngleFields("20", "Spec"),
  ...firingAngleFields("16", "Actual"),
  ...firingAngleFields("18", "Actual"),
  ...firingAngleFields("20", "Actual"),

  // ---- Current Loop ---------------------------------------------------------
  { key: "testCurrentLoop", column: "TestCurrentLoop", label: "Test Current Loop", kind: "number", section: "Current Loop" },
  { key: "finalCurrentLoop", column: "FinalCurrentLoop", label: "Final Current Loop", kind: "number", section: "Current Loop" },

  // ---- Defects / NCM ---------------------------------------------------------
  { key: "inRepair", column: "InRepair", label: "In Repair", kind: "boolean", section: "Defects / NCM" },
  { key: "aeSolderDefect", column: "AESolderDefect", label: "AE Solder Defect", kind: "boolean", section: "Defects / NCM" },
  { key: "processSolderDefect", column: "ProcessSolderDefect", label: "Process Solder Defect", kind: "boolean", section: "Defects / NCM" },
  { key: "aeWiringDeficiency", column: "AEWiringDeficiency", label: "AE Wiring Deficiency", kind: "boolean", section: "Defects / NCM" },
  { key: "aeWrongOrMissingComponent", column: "AEWrongorMissingComponent", label: "AE Wrong or Missing Component", kind: "boolean", section: "Defects / NCM" },
  { key: "aeAssemblyDeficiency", column: "AEAssemblyDeficiency", label: "AE Assembly Deficiency", kind: "boolean", section: "Defects / NCM" },
  { key: "aeIdentificationDeficiency", column: "AEIdentificationDeficiency", label: "AE Identification Deficiency", kind: "boolean", section: "Defects / NCM" },
  { key: "programmingFirmware", column: "Programming_x002f_Firmware", label: "Programming / Firmware", kind: "boolean", section: "Defects / NCM" },
  { key: "coatingPottingDeficiency", column: "Coating_x002f_PottingDeficiency", label: "Coating / Potting Deficiency", kind: "boolean", section: "Defects / NCM" },
  { key: "machinePartPlacementDeficiency", column: "MachinePartPlacementDeficiency", label: "Machine Part Placement Deficiency", kind: "boolean", section: "Defects / NCM" },
  { key: "physicalDamage", column: "PhysicalDamage", label: "Physical Damage", kind: "boolean", section: "Defects / NCM" },
  { key: "ncmVendor", column: "NCMVendor", label: "NCM Vendor", kind: "boolean", section: "Defects / NCM" },
  { key: "ncmInternal", column: "NCMInternal", label: "NCM Internal", kind: "boolean", section: "Defects / NCM" },
  { key: "other", column: "Other", label: "Other", kind: "boolean", section: "Defects / NCM" },

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

// 791950-08 (Altmode 1, Ray/Tim, 2026-09-17) is an 8-cylinder unit that
// reuses the SAME 16-cylinder firing-angle columns every other Altmode in
// ALTMODE_LT_3 uses — SharePoint has no separate 8-cyl columns. Only the
// first 8 of the 16 letters (A-L) ever hold real values on this variant; M
// through V are unused. This is a DISPLAY-ONLY filter layered on top of the
// ordinary Altmode visibility rule: the columns, keys and write payload are
// identical to the 16-cyl form, and Altmode 0 / 2 (genuinely 16-cylinder)
// still show all 16 letters.
const EIGHT_CYL_UNUSED_16_LETTERS = FIRING_LETTERS_16.slice(8);
const EIGHT_CYL_HIDDEN_KEYS = new Set(
  EIGHT_CYL_UNUSED_16_LETTERS.flatMap((letter) => [
    `firingSpec16${letter}`,
    `firingActual16${letter}`,
  ]),
);

/**
 * Fields to render for a given Altmode — every field whose `altModes` list
 * (see the file header comment) includes it, plus every field with no
 * `altModes` at all (always visible), minus the 8-cyl unused M-V columns on
 * Altmode 1 specifically (see `EIGHT_CYL_HIDDEN_KEYS` above). Passing `null`
 * (Altmode couldn't be determined, e.g. a blank or unrecognized part number)
 * shows everything, since hiding fields on a guess would be worse than
 * showing too many.
 */
export function qcCpu95VisibleFields(altMode: number | null): QcCpu95Field[] {
  if (altMode === null) return QC_CPU95_FIELDS;
  return QC_CPU95_FIELDS.filter((f) => {
    if (f.altModes && !f.altModes.includes(altMode)) return false;
    if (altMode === 1 && EIGHT_CYL_HIDDEN_KEYS.has(f.key)) return false;
    return true;
  });
}

/**
 * Display-only section title — on Altmode 1 (791950-08, an 8-cylinder unit)
 * the two 16-cyl firing-angle sections read "8 Cyl" instead of "16 Cyl".
 * Nothing about the section's fields or columns changes; see
 * `EIGHT_CYL_HIDDEN_KEYS` above.
 */
export function qcCpu95SectionTitle(section: QcCpu95Section, altMode: number | null): string {
  if (
    altMode === 1 &&
    (section === "Firing Angle Spec — 16 Cyl" || section === "Firing Angle Actual — 16 Cyl")
  ) {
    return section.replace("16 Cyl", "8 Cyl");
  }
  return section;
}

/**
 * Display-only field label — on Altmode 1, the visible 16-cyl firing-angle
 * fields (A-L; M-V are already hidden by `qcCpu95VisibleFields`) read
 * "8A".."8L" instead of "16A".."16L", matching the "8 Cyl" section title.
 * Every other Altmode's label is unchanged.
 */
export function qcCpu95FieldLabel(field: QcCpu95Field, altMode: number | null): string {
  const isFiring16 = field.key.startsWith("firingSpec16") || field.key.startsWith("firingActual16");
  if (altMode === 1 && isFiring16) {
    return field.label.replace(/^16/, "8");
  }
  return field.label;
}

/** A blank values bag — every descriptor key set to `""`. Shared by mock data and the create form. */
export function qcCpu95EmptyValues(): Record<string, string> {
  return Object.fromEntries(QC_CPU95_FIELDS.map((f) => [f.key, ""]));
}
