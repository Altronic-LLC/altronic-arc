// =============================================================================
// QCFRM-035 (Series X Controller GE Transportation Log Sheet — Quality
// Control Inspection, Rev 0) — field descriptors. The second GE log sheet in
// QC Forms Phase 1 (docs/QC-FORMS-ROADMAP.md), and by volume the bigger one:
// 542 scanned pages in 2024 and 441 in 2025, against GET-1's ~210.
//
// One sheet per Series X controller (17FM850A1, 17FM850A2): the part number
// and serial, the fifteen GE controller checks (word for word GET-1's, so
// shared — qcGeControllerChecks.ts), the ship firmware revision, a work order
// for each of eleven boards, then the QC inspector, date and notes. No
// variants.
//
// The columns are DATA, the CPU-95 rule. The list's layout is
// scripts/data/qc-series-x-columns.json, which builds it;
// `qcSeriesXFields.test.ts` fails if a `column` below isn't there or the
// types disagree.
//
// Read off the 2024–2025 scans (2026-10-28):
// - The paper prints "681 105-2 WO#". Sheets up to early 2025 write against
//   it as printed; by mid-2025 operators correct it to 105-3 by hand, as on
//   GET-1. ARC records 105-3, the board fitted now (GET-1's call, Tim,
//   2026-10-26).
// - The right-hand column's fourth row is printed "No populated VD board." —
//   there is no blank and no field; the export prints the words.
// - 672 005-1 is sometimes a dash; that's a blank work order, not a value.
// - The Part Number line's box is ticked on some sheets and not others; it
//   isn't a check here (the export still prints the box), the GET-1 call.
// - "Turbo CC Test", "Tested", "SFI" and the circled F go in Notes.
// =============================================================================

import type { QcFormField } from "./qcFormEngine";
import { QC_GE_CONTROLLER_CHECKS } from "./qcGeControllerChecks";

export const QC_SERIES_X_SECTIONS = ["Unit", "Inspection", "Board Work Orders", "Sign-off"] as const;
export type QcSeriesXSection = (typeof QC_SERIES_X_SECTIONS)[number];

export type QcSeriesXField = QcFormField<string, QcSeriesXSection>;

/** The Series X part numbers seen on the 2024–2025 sheets — offered, never enforced. */
export const QC_SERIES_X_PART_NUMBERS = ["17FM850A1", "17FM850A2"] as const;

/** The inspection checks — the GE controller checks, which Series X shares with GET-1. */
export const QC_SERIES_X_CHECKS = QC_GE_CONTROLLER_CHECKS;

/**
 * The boards in the paper's two columns: left 672-series, right 681-series.
 * "681 105-3" is printed 105-2 on Rev 0 — see the header. The paper's
 * "No populated VD board." line has no board, so it isn't here; the sheet
 * layout (qcSeriesXForm.ts) prints it in its place.
 */
export const QC_SERIES_X_BOARDS: ReadonlyArray<readonly [board: string, key: string, column: string]> = [
  ["672 255-1", "wo672255", "WO672255_1"],
  ["672 007-1", "wo672007", "WO672007_1"],
  ["672 257-1", "wo672257", "WO672257_1"],
  ["672 005-1", "wo672005", "WO672005_1"],
  ["672 259-1", "wo672259", "WO672259_1"],
  ["672 265-2", "wo672265", "WO672265_2"],
  ["681 100-1", "wo681100", "WO681100_1"],
  ["681 138-1", "wo681138", "WO681138_1"],
  ["681 102-1", "wo681102", "WO681102_1"],
  ["681 104-1", "wo681104", "WO681104_1"],
  ["681 105-3", "wo681105", "WO681105_3"],
];

export const QC_SERIES_X_FIELDS: QcSeriesXField[] = [
  // ---- Unit: scanned first, serial then part number ------------------------
  { key: "serialNumber", column: "Title", label: "Serial Number", kind: "text", section: "Unit" },
  { key: "partNumber", column: "PartNumber", label: "Part Number (ECU)", kind: "text", section: "Unit" },

  // ---- Inspection ------------------------------------------------------------
  ...QC_SERIES_X_CHECKS.map(
    ([key, column, label]): QcSeriesXField => ({ key, column, label, kind: "check", section: "Inspection" }),
  ),
  { key: "shipFirmwareRevision", column: "ShipFirmwareRevision", label: "Ship Firmware Revision", kind: "text", section: "Inspection" },

  // ---- Board work orders -----------------------------------------------------
  ...QC_SERIES_X_BOARDS.map(([board, key, column]): QcSeriesXField => ({
    key,
    column,
    label: `${board} WO#`,
    kind: "text",
    section: "Board Work Orders",
  })),

  // ---- Sign-off --------------------------------------------------------------
  { key: "qcInspector", column: "QCInspector", label: "QC Inspector", kind: "text", section: "Sign-off" },
  { key: "inspectionDate", column: "InspectionDate", label: "Inspection Date", kind: "date", section: "Sign-off" },
  { key: "notes", column: "Notes", label: "Notes / Comments", kind: "multiline", section: "Sign-off" },
];
