import type { QcCpu95Record } from "@/types/task";
import { qcCpu95EmptyValues } from "@/lib/qcCpu95Fields";

// =============================================================================
// Mock data for QCFRM-012 (CPU-95). A handful of fixtures spanning several
// Altmodes (see qcCpu95Mapper.ts) so the demo shows the standard 16-cyl form,
// the 791962/52-18 variant, and the 20-cyl multi-application sheet.
// =============================================================================

function record(id: number, overrides: Record<string, string>, daysAgo: number): QcCpu95Record {
  const modifiedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id,
    values: { ...qcCpu95EmptyValues(), ...overrides },
    createdAt: modifiedAt,
    modifiedAt,
  };
}

export const MOCK_QC_CPU95_RECORDS: QcCpu95Record[] = [
  // Altmode 2 — standard 791950-16, 16-cylinder firing angles.
  record(
    1,
    {
      serialNumber: "25564",
      altronicPartNumber: "791950-16",
      logicBoardDateCode: "2414-03",
      powerBoardDateCode: "2417-06",
      invoiceNumber: "1001214118",
      microDateCode: "1/1/99",
      testMemoryNumber: "P4A180.FD",
      testRpm: "1200",
      testStandNumber: "1",
      dateTested: "2026-05-13",
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
      finalEachOutputFiring: "Yes",
      finalMultiFire: "Yes",
      finalInternal4Leds: "Yes",
      final2032VoltInput: "Yes",
      finalCheckGlobalTiming: "Yes",
      finalVerifyOneStep: "Yes",
      finalVerifyOverspeed: "Yes",
      finalVerifyTestMode: "Yes",
      finalProgramOrBlankMemory: "Yes",
      finalVerifyNoChecksum: "Yes",
      finalTriacLeakage: "Yes",
      finalDiodeLeakage: "Yes",
      firingSpec16A: "0", firingSpec16B: "45", firingSpec16C: "90", firingSpec16D: "135",
      firingActual16A: "0", firingActual16B: "45", firingActual16C: "90", firingActual16D: "135",
      finalTestBy: "JN",
      finalTestDate: "2026-05-13",
      finalInspectionBy: "JN",
      finalInspectionDate: "2026-05-13",
    },
    3,
  ),

  // Altmode 6 — 791962-18, the 791962/52-18 voltage variant, 18-cylinder firing.
  record(
    2,
    {
      serialNumber: "25567",
      altronicPartNumber: "791962-18",
      logicBoardDateCode: "2413-02",
      powerBoardDateCode: "2417-01",
      invoiceNumber: "10012114116",
      microDateCode: "9-15-09",
      testMemoryNumber: "T4P180",
      testRpm: "1200",
      testStandNumber: "1",
      dateTested: "2026-05-16",
      startup20vE1Alt: "137",
      startup24vE1Alt: "135",
      startup20vE2Alt: "157",
      startup24vE2Alt: "157",
      startup20vE3Alt: "174",
      startup24vE3Alt: "176",
      startup20vE3CurrentAlt: "2.3",
      startup24vE3CurrentAlt: "1.8",
      final791956Timing: "Yes",
      final791956LossOfLoop: "Yes",
      final791956Below250Rpm: "Yes",
      final791956CanComm: "Yes",
      finalE1Alt_20v: "132",
      finalE1Alt_24v: "133",
      finalE2Alt_20v: "150",
      finalE2Alt_24v: "151",
      finalE3Alt_20v: "170",
      finalE3Alt_24v: "172",
      finalE3CurrentAlt_20v: "2.1",
      finalE3CurrentAlt_24v: "1.8",
      firingSpec18A: "0", firingSpec18B: "45", firingSpec18C: "90",
      firingActual18A: "0", firingActual18B: "55", firingActual18C: "72",
      finalTestBy: "JN",
      finalTestDate: "2026-05-16",
      finalInspectionBy: "JN",
      finalInspectionDate: "2026-05-16",
    },
    6,
  ),

  // Altmode 3 — 791950-20 / 791962-20, the multi-application 20-cylinder sheet.
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
      startup20vE1Alt: "135",
      startup24vE1Alt: "135",
      firingSpec20AL: "0", firingSpec20AR: "55", firingSpec20BL: "72",
      firingActual20AL: "0", firingActual20AR: "55", firingActual20BL: "72",
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
];
