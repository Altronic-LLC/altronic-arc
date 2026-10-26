import type { QcFormRecord, QcFormSpec } from "./qcFormEngine";
import { QC_GET1_BOARDS, QC_GET1_CHECKS, QC_GET1_FIELDS, QC_GET1_PART_NUMBERS, QC_GET1_SECTIONS } from "./qcGet1Fields";
import {
  GE_SHEET_CONTENT_BOTTOM,
  GE_SHEET_CONTENT_TOP,
  GE_SHEET_WIDTH,
  geLogSheetLayout,
  type GeLogSheetDef,
} from "./qcGeLogSheet";

// =============================================================================
// GET-1 (GE Transportation Log Sheet — Quality Control Inspection) as a QC
// form spec. The descriptors are in qcGet1Fields.ts; the paper is the shared
// GE log sheet (qcGeLogSheet.ts), described here by GET-1's own text.
// =============================================================================

/** GET-1 Rev 3's paper, as the GE log sheet draws it. */
export const QC_GET1_SHEET: GeLogSheetDef = {
  title: "GE Transportation Log Sheet",
  subtitle: "Quality Control Inspection",
  partNumber: { label: "Part Number (ECU)", key: "partNumber" },
  serial: { label: "Serial Number", key: "serialNumber" },
  checks: QC_GET1_CHECKS.map(([key, , label]) =>
    key === "shipFirmwareVerified"
      ? { key, text: label, blank: { key: "shipFirmwareRevision", x1: 425, x2: 745 } }
      : { key, text: label },
  ),
  boards: {
    heading: "Record Work Order numbers for following boards:  (2 WO#’s per board)",
    rows: QC_GET1_BOARDS.map(([board, key]) => ({ label: `${board} WO#`, key })),
  },
  inspector: { label: "QC Inspector", key: "qcInspector" },
  date: { label: "Date", key: "inspectionDate" },
  notes: { label: "Notes/Comments:", key: "notes" },
  footer: ["GET-1", "Page 1 of 1", "Rev 3, 10-May-2016"],
  noun: "log sheet",
};

export const QC_GET1_FORM: QcFormSpec = {
  id: "get-1",
  formNumber: "GET-1",
  name: "GE Transportation ECU",
  shortName: "GE ECU",
  description: "GE Transportation log sheet — quality control inspection of the ECU, with its board work orders.",
  pageDescription: "Quality control inspection of the GE Transportation ECU (17FM760D3), one log sheet per unit.",
  noun: "log sheet",
  fields: QC_GET1_FIELDS,
  sections: QC_GET1_SECTIONS,
  // One sheet for every unit.
  unitOf: () => ({ variant: "base" }),
  serialKey: "serialNumber",
  partNumberKey: "partNumber",
  partNumberSuggestions: QC_GET1_PART_NUMBERS,
  status: {
    completeKeys: ["qcInspector", "inspectionDate"],
    dateKey: "inspectionDate",
  },
  list: {
    columns: [
      { key: "serialNumber", label: "Serial Number" },
      { key: "partNumber", label: "Part Number (ECU)" },
      { key: "shipFirmwareRevision", label: "Firmware Rev" },
      { key: "qcInspector", label: "QC Inspector" },
      { key: "inspectionDate", label: "Inspection Date", kind: "date" },
    ],
    // A board's work order is searchable: "which units carry WO 508123?"
    searchKeys: [
      "serialNumber",
      "partNumber",
      "shipFirmwareRevision",
      "qcInspector",
      "notes",
      ...QC_GET1_BOARDS.map(([, key]) => key),
    ],
    searchPlaceholder: "Search serial#, part#, board WO#, inspector, notes…",
  },
  sheet: {
    width: GE_SHEET_WIDTH,
    contentTop: GE_SHEET_CONTENT_TOP,
    contentBottom: GE_SHEET_CONTENT_BOTTOM,
    layout: (record: QcFormRecord | null, exportedOn: string) =>
      geLogSheetLayout(QC_GET1_SHEET, QC_GET1_FIELDS, record, exportedOn),
  },
};
