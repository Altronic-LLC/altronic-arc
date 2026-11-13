import { qcFormEmptyValues, type QcFormRecord } from "@/lib/qcFormEngine";
import { QC_CPU95_FORM } from "@/lib/qcCpu95Form";

// =============================================================================
// Mock data for QCFRM-012 (CPU-95). A handful of fixtures spanning the unit
// variants (see qcCpu95Fields.ts) so the demo shows the standard 16-cyl form,
// the 791962/52-18 high-voltage unit, the 20-cyl sheet, a CPU-95C and an EVS.
// =============================================================================

function record(id: number, overrides: Record<string, string>, daysAgo: number): QcFormRecord {
  const modifiedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id,
    values: { ...qcFormEmptyValues(QC_CPU95_FORM), ...overrides },
    createdAt: modifiedAt,
    modifiedAt,
  };
}

/** Spec angles in slot order, e.g. 0/45/90 … for a 16-cyl unit. */
function specs(angles: number[]): Record<string, string> {
  return Object.fromEntries(angles.map((a, i) => [`firingSpec${String(i + 1).padStart(2, "0")}`, String(a)]));
}

const SIXTEEN = [0, 45, 90, 135, 180, 225, 270, 315, 0, 45, 90, 135, 180, 225, 270, 315];

export const MOCK_QC_CPU95_RECORDS: QcFormRecord[] = [
  // 791950-16 — the standard unit, 16-cylinder firing, every actual at spec.
  record(
    1,
    {
      serialNumber: "25564",
      altronicPartNumber: "791950-16",
      sapNumber: "1000-7760-00",
      logicBoardDateCode: "2414-03",
      powerBoardDateCode: "2417-06",
      invoiceNumber: "1001214118",
      microDateCode: "1/1/99",
      testMemoryNumber: "P4A180.FD",
      testRpm: "1200",
      testStandNumber: "1",
      dateTested: "2026-05-13",
      ovenOn: "2026-05-13T15:30",
      ovenOff: "2026-05-14T07:15",
      startup20vE1: "137",
      startup24vE1: "139",
      startup20vE2: "159",
      startup24vE2: "159",
      startup20vE3: "179",
      startup24vE3: "179",
      startup20vE3Current: "1.8",
      startup24vE3Current: "1.6",
      startupAlarmLedOff: "Yes",
      startupUnitProgram: "Yes",
      startupVerifyACountSetup: "Yes",
      startupLowSpeedOperation: "Yes",
      finalE1_20v: "133",
      finalE1_24v: "135",
      finalE2_20v: "153",
      finalE2_24v: "153",
      finalE3_20v: "177",
      finalE3_24v: "177",
      finalE3Current_20v: "1.8",
      finalE3Current_24v: "1.6",
      finalGndGLead: "Yes",
      finalEachOutputFiring: "Yes",
      finalMultiFire: "Yes",
      finalInternal4Leds: "Yes",
      final2032VoltInput: "Yes",
      finalCheckGlobalTiming: "Yes",
      finalVerifyOneStep: "Yes",
      finalVerifyOverspeed: "Yes",
      finalVerifyTestMode: "Yes",
      finalProgramOrBlankMemory: "N/A",
      finalVerifyNoChecksum: "Yes",
      finalTriacLeakage: "Yes",
      finalDiodeLeakage: "Yes",
      firingActualsAtSpec: "Yes",
      ...specs(SIXTEEN),
      inspLabelMatches: "Yes",
      inspGasket: "Yes",
      inspCoverBoard: "Yes",
      inspClean: "Yes",
      finalTestBy: "JN",
      finalTestDate: "2026-05-13",
      finalInspectionBy: "JN",
      finalInspectionDate: "2026-05-14",
    },
    3,
  ),

  // 791962-18 — the high-voltage unit, 18-cylinder firing, one cylinder off.
  record(
    2,
    {
      serialNumber: "25567",
      altronicPartNumber: "791962-18",
      memoryNumber: "L4P180.FS539#001",
      logicBoardDateCode: "2413-02",
      powerBoardDateCode: "2417-01",
      invoiceNumber: "10012114116",
      microDateCode: "9-15-09",
      testMemoryNumber: "T4P180",
      testRpm: "1200",
      testStandNumber: "1",
      dateTested: "2026-05-16",
      startup20vE1: "144",
      startup24vE1: "145",
      startup20vE2: "164",
      startup24vE2: "165",
      startup20vE3: "185",
      startup24vE3: "182",
      startup20vE3Current: "2.1",
      startup24vE3Current: "1.9",
      finalE1_20v: "142",
      finalE1_24v: "141",
      finalE2_20v: "160",
      finalE2_24v: "160",
      finalE3_20v: "182",
      finalE3_24v: "180",
      finalE3Current_20v: "2",
      finalE3Current_24v: "1.8",
      finalGndGLead: "N/A",
      firingActualsAtSpec: "No",
      ...specs([0, 50, 80, 130, 160, 210, 240, 290, 320, 10, 40, 90, 120, 170, 200, 250, 280, 330]),
      firingActual03: "81.5",
      finalTestBy: "AB",
      finalTestDate: "2026-05-16",
      finalInspectionBy: "JN",
      finalInspectionDate: "2026-05-16",
    },
    6,
  ),

  // 791962-20 — the multi-application 20-cylinder sheet.
  record(
    3,
    {
      serialNumber: "25713",
      altronicPartNumber: "791962-20",
      logicBoardDateCode: "2430-02",
      powerBoardDateCode: "2434-02",
      invoiceNumber: "10013949459",
      microDateCode: "9-15-9",
      testMemoryNumber: "t4p180",
      testRpm: "1200",
      testStandNumber: "1",
      dateTested: "2026-10-09",
      startup20vE1: "135",
      startup24vE1: "135",
      ...specs([0, 55, 72, 127, 144, 199, 216, 271, 288, 343, 360, 55, 72, 127, 144, 199, 216, 271, 288, 343]),
      firingActualsAtSpec: "Yes",
      finalTestBy: "jn",
      finalTestDate: "2026-10-10",
      finalInspectionBy: "jn",
      finalInspectionDate: "2026-10-15",
      comments: "708939",
    },
    1,
  ),

  // In repair, with an NCM flag — exercises the Defects / NCM card. Status
  // LED: red (In Repair checked, not yet signed off).
  record(
    4,
    {
      serialNumber: "26097",
      altronicPartNumber: "791950-16",
      testStandNumber: "1",
      dateTested: "2026-09-12",
      inRepair: "Yes",
      ncmVendor: "Yes",
      comments: "Gear tooth fault at startup — missing J1B jumper.",
      finalTestBy: "JN",
      finalTestDate: "2026-09-13",
    },
    10,
  ),

  // On the test stand, nothing signed off yet — status LED: yellow (In Process).
  record(
    5,
    {
      serialNumber: "26301",
      altronicPartNumber: "791950-16",
      testStandNumber: "2",
      dateTested: "2026-09-16",
      ovenOn: "2026-09-16T14:05",
      startup20vE1: "137",
      startupAlarmLedOff: "Yes",
    },
    0,
  ),

  // Just scanned in — Serial Number and Altronic Part Number only, nothing
  // from the actual test yet. Status LED: blue (In Queue).
  record(
    6,
    {
      serialNumber: "26305",
      altronicPartNumber: "791950-18",
    },
    0,
  ),

  // CPU-95C (791955-16) — its own checks, Application in place of Memory No.
  record(
    7,
    {
      serialNumber: "90120",
      altronicPartNumber: "791955-16",
      application: "3516",
      testStandNumber: "3",
      dateTested: "2026-09-20",
      startup20vE1: "134",
      startup24vE1: "135",
      startupGndGProgram: "Yes",
      startupDisplayReady: "Yes",
      startupUnitProgram: "Yes",
      finalCatFirePulses: "Yes",
      finalHDisconnect: "Yes",
      finalModeMessage: "Yes",
      finalMagCal: "Yes",
      finalTiming110Rpm: "Yes",
      ...specs([0, 60, 90, 150, 180, 240, 270, 330, 0, 60, 90, 150, 180, 240, 270, 330]),
      firingActualsAtSpec: "Yes",
      finalTestBy: "JN",
      finalTestDate: "2026-09-21",
    },
    2,
  ),

  // CPU-95 EVS (791963-16A) — E1 single supply current, CAVG, six energy levels.
  record(
    8,
    {
      serialNumber: "90133",
      altronicPartNumber: "791963-16A",
      testStandNumber: "4",
      dateTested: "2026-09-24",
      startupE1SupplyCurrent: "1.4",
      startupCountAOutput: "109",
      startupEavg: "110",
      finalE1SupplyCurrent: "1.5",
      finalSixEnergyLevels: "Yes",
      ...specs(SIXTEEN),
      firingActualsAtSpec: "Yes",
      finalTestBy: "AB",
      finalTestDate: "2026-09-25",
    },
    2,
  ),
];
