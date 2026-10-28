import type { QcFormRecord, QcFormSpec } from "./qcFormEngine";
import {
  QC_SERIES_X_BOARDS,
  QC_SERIES_X_CHECKS,
  QC_SERIES_X_FIELDS,
  QC_SERIES_X_PART_NUMBERS,
  QC_SERIES_X_SECTIONS,
} from "./qcSeriesXFields";
import {
  GE_SHEET_CONTENT_BOTTOM,
  GE_SHEET_CONTENT_TOP,
  GE_SHEET_WIDTH,
  geLogSheetLayout,
  type GeLogSheetBoardRow,
  type GeLogSheetDef,
} from "./qcGeLogSheet";

// =============================================================================
// QCFRM-035 (Series X Controller GE Transportation Log Sheet) as a QC form
// spec. The descriptors are in qcSeriesXFields.ts; the paper is the shared GE
// log sheet (qcGeLogSheet.ts), described here by QCFRM-035's own text.
// =============================================================================

const board = (key: string): GeLogSheetBoardRow => {
  const [label] = QC_SERIES_X_BOARDS.find(([, k]) => k === key)!;
  return { label: `${label} WO#`, key };
};

/** QCFRM-035 Rev 0's paper, as the GE log sheet draws it. */
export const QC_SERIES_X_SHEET: GeLogSheetDef = {
  title: ["Series X Controller GE Transportation", "Log Sheet"],
  subtitle: "Quality Control Inspection",
  partNumber: { label: "Part Number (ECU)", key: "partNumber" },
  serial: { label: "Serial Number", key: "serialNumber" },
  checks: QC_SERIES_X_CHECKS.map(([key, , label]) =>
    key === "shipFirmwareVerified"
      ? { key, text: label, blank: { key: "shipFirmwareRevision", x1: 425, x2: 745 } }
      : { key, text: label },
  ),
  boards: {
    heading: "Record Work Order numbers for following boards:  (2 WO#’s per board)",
    // Left column then right, six each; the right column's fourth line is
    // printed text with no blank.
    rows: [
      board("wo672255"),
      board("wo672007"),
      board("wo672257"),
      board("wo672005"),
      board("wo672259"),
      board("wo672265"),
      board("wo681100"),
      board("wo681138"),
      board("wo681102"),
      { label: "No populated VD board." },
      board("wo681104"),
      board("wo681105"),
    ],
  },
  inspector: { label: "QC Inspector", key: "qcInspector" },
  date: { label: "Date", key: "inspectionDate" },
  notes: { label: "Notes/Comments:", key: "notes" },
  footer: ["QCFRM 035 Rev 0", "Page 1 of 1"],
  noun: "log sheet",
  // Measured off the 2025 scans: a two-line title, and rows a little tighter
  // than GET-1's.
  spacing: {
    subtitleGap: 32,
    headerGap: 33,
    checkGap: 34,
    checkStep: 33.1,
    boardsGap: 61,
    boardRowGap: 30,
    boardStep: 32.4,
    signOffStep: 32,
  },
};

export const QC_SERIES_X_FORM: QcFormSpec = {
  id: "series-x",
  formNumber: "QCFRM-035",
  name: "Series X Controller",
  shortName: "Series X",
  description: "Series X controller GE Transportation log sheet — quality control inspection, with its board work orders.",
  pageDescription: "Quality control inspection of the Series X controller (17FM850A1, 17FM850A2), one log sheet per unit.",
  noun: "log sheet",
  fields: QC_SERIES_X_FIELDS,
  sections: QC_SERIES_X_SECTIONS,
  // One sheet for every unit.
  unitOf: () => ({ variant: "base" }),
  serialKey: "serialNumber",
  partNumberKey: "partNumber",
  partNumberSuggestions: QC_SERIES_X_PART_NUMBERS,
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
    // A board's work order is searchable: "which units carry WO 1738702?"
    searchKeys: [
      "serialNumber",
      "partNumber",
      "shipFirmwareRevision",
      "qcInspector",
      "notes",
      ...QC_SERIES_X_BOARDS.map(([, key]) => key),
    ],
    searchPlaceholder: "Search serial#, part#, board WO#, inspector, notes…",
  },
  sheet: {
    width: GE_SHEET_WIDTH,
    contentTop: GE_SHEET_CONTENT_TOP,
    contentBottom: GE_SHEET_CONTENT_BOTTOM,
    layout: (record: QcFormRecord | null, exportedOn: string) =>
      geLogSheetLayout(QC_SERIES_X_SHEET, QC_SERIES_X_FIELDS, record, exportedOn),
  },
};
