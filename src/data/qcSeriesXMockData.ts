import { qcFormEmptyValues, type QcFormRecord } from "@/lib/qcFormEngine";
import { QC_SERIES_X_FORM } from "@/lib/qcSeriesXForm";
import { QC_SERIES_X_BOARDS, QC_SERIES_X_CHECKS } from "@/lib/qcSeriesXFields";

// =============================================================================
// Mock data for QCFRM-035 (Series X Controller log sheet). Invented serials
// and work orders, shaped like the paper: two signed-off sheets (one with no
// 672 005-1 board recorded), one part-way through and one just scanned in
// (In Queue).
// =============================================================================

function record(id: number, overrides: Record<string, string>, daysAgo: number): QcFormRecord {
  const modifiedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id,
    values: { ...qcFormEmptyValues(QC_SERIES_X_FORM), ...overrides },
    createdAt: modifiedAt,
    modifiedAt,
  };
}

/** Every check Yes, except the two USB lines, which the 2025 sheets mark N/A. */
function inspected(): Record<string, string> {
  return Object.fromEntries(
    QC_SERIES_X_CHECKS.map(([key]) => [key, key === "usbSocket" || key === "usbDustCover" ? "N/A" : "Yes"]),
  );
}

/** A work order per board, counting up from `first`. */
function workOrders(first: number): Record<string, string> {
  return Object.fromEntries(QC_SERIES_X_BOARDS.map(([, key], i) => [key, String(first + i * 211)]));
}

export const MOCK_QC_SERIES_X_RECORDS: QcFormRecord[] = [
  record(
    1,
    {
      serialNumber: "FM2601/0101T",
      partNumber: "17FM850A1",
      ...inspected(),
      ...workOrders(700100),
      qcInspector: "JN",
      inspectionDate: "2026-01-14",
      notes: "Turbo CC test. Tested, SFI",
    },
    38,
  ),
  record(
    2,
    {
      serialNumber: "FM2601/0102T",
      partNumber: "17FM850A2",
      ...inspected(),
      ...workOrders(700500),
      wo672005: "",
      qcInspector: "AB",
      inspectionDate: "2026-01-15",
      notes: "Turbo CC test",
    },
    37,
  ),
  record(
    3,
    {
      serialNumber: "FM2602/0101T",
      partNumber: "17FM850A1",
      pinInspection: "Yes",
      connectorLabelsScrews: "Yes",
      wo672255: "701210",
      wo672007: "701421",
    },
    2,
  ),
  record(4, { serialNumber: "FM2602/0102T", partNumber: "17FM850A2" }, 1),
];
