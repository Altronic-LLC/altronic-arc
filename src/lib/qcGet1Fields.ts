// =============================================================================
// GET-1 (GE Transportation Log Sheet — Quality Control Inspection, Rev 3,
// 10-May-2016) — field descriptors. The QC Forms Phase 1 pilot: the first
// template-B checklist on the form engine (docs/QC-FORMS-ROADMAP.md).
//
// One sheet per GE ECU (17FM760D3, a few 17FM760D2): the part number and
// serial, fifteen inspection checks, the ship firmware revision, a work order
// for each of twelve boards, then the QC inspector, date and notes. Every unit
// is inspected on the same sheet, so there are no variants.
//
// The columns are DATA, the CPU-95 rule. The list's layout is
// scripts/data/qc-get1-columns.json, which built it; `qcGet1Fields.test.ts`
// fails if a `column` below isn't there or the types disagree.
//
// Three calls from the 2025 scans (Tim, 2026-10-26):
// - The paper prints "681 105-2 WO#" and operators correct it to 105-3 by
//   hand on nearly every sheet, so ARC's field is 681 105-3.
// - The Part Number line has a tick box nobody ticks; it's not a check here
//   (the export still prints the box).
// - The circled D (Deviation, Flange), F, "Tested" and "SFI" marks go in
//   Notes, not fields of their own.
// =============================================================================

import type { QcFormField } from "./qcFormEngine";
import { QC_GE_CONTROLLER_CHECKS } from "./qcGeControllerChecks";

export const QC_GET1_SECTIONS = ["Unit", "Inspection", "Board Work Orders", "Sign-off"] as const;
export type QcGet1Section = (typeof QC_GET1_SECTIONS)[number];

export type QcGet1Field = QcFormField<string, QcGet1Section>;

/** The GE part numbers seen on the 2025 sheets — offered, never enforced. */
export const QC_GET1_PART_NUMBERS = ["17FM760D3", "17FM760D2"] as const;

/** The inspection checks, in the paper's order — shared with Series X, whose wording is the same. */
export const QC_GET1_CHECKS = QC_GE_CONTROLLER_CHECKS;

/**
 * The boards, two columns as on the paper: left 672-series, right 681-series.
 * "681 105-3" is printed 105-2 on Rev 3 — see the header.
 */
export const QC_GET1_BOARDS: ReadonlyArray<readonly [board: string, key: string, column: string]> = [
  ["672 255-1", "wo672255", "WO672255_1"],
  ["672 256-1", "wo672256", "WO672256_1"],
  ["672 257-1", "wo672257", "WO672257_1"],
  ["672 258-1", "wo672258", "WO672258_1"],
  ["672 259-1", "wo672259", "WO672259_1"],
  ["672 265-2", "wo672265", "WO672265_2"],
  ["681 100-1", "wo681100", "WO681100_1"],
  ["681 101-1", "wo681101", "WO681101_1"],
  ["681 102-1", "wo681102", "WO681102_1"],
  ["681 103-1", "wo681103", "WO681103_1"],
  ["681 104-1", "wo681104", "WO681104_1"],
  ["681 105-3", "wo681105", "WO681105_3"],
];

export const QC_GET1_FIELDS: QcGet1Field[] = [
  // ---- Unit: scanned first, serial then part number ------------------------
  { key: "serialNumber", column: "Title", label: "Serial Number", kind: "text", section: "Unit" },
  { key: "partNumber", column: "PartNumber", label: "Part Number (ECU)", kind: "text", section: "Unit" },

  // ---- Inspection ------------------------------------------------------------
  ...QC_GET1_CHECKS.map(([key, column, label]): QcGet1Field => ({ key, column, label, kind: "check", section: "Inspection" })),
  { key: "shipFirmwareRevision", column: "ShipFirmwareRevision", label: "Ship Firmware Revision", kind: "text", section: "Inspection" },

  // ---- Board work orders -----------------------------------------------------
  ...QC_GET1_BOARDS.map(([board, key, column]): QcGet1Field => ({
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
