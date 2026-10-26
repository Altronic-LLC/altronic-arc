import { qcFormEmptyValues, type QcFormRecord } from "@/lib/qcFormEngine";
import { QC_GET1_FORM } from "@/lib/qcGet1Form";
import { QC_GET1_BOARDS, QC_GET1_CHECKS } from "@/lib/qcGet1Fields";

// =============================================================================
// Mock data for GET-1 (GE Transportation Log Sheet). Invented serials and work
// orders, shaped like the paper: a signed-off sheet, one with a rework note,
// one part-way through and one just scanned in (In Queue).
// =============================================================================

function record(id: number, overrides: Record<string, string>, daysAgo: number): QcFormRecord {
  const modifiedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id,
    values: { ...qcFormEmptyValues(QC_GET1_FORM), ...overrides },
    createdAt: modifiedAt,
    modifiedAt,
  };
}

/** Every check Yes, except the two USB lines, which the 2025 sheets mark N/A. */
function inspected(): Record<string, string> {
  return Object.fromEntries(
    QC_GET1_CHECKS.map(([key]) => [key, key === "usbSocket" || key === "usbDustCover" ? "N/A" : "Yes"]),
  );
}

/** A work order per board, counting up from `first`. */
function workOrders(first: number): Record<string, string> {
  return Object.fromEntries(QC_GET1_BOARDS.map(([, key], i) => [key, String(first + i * 137)]));
}

export const MOCK_QC_GET1_RECORDS: QcFormRecord[] = [
  record(
    1,
    {
      serialNumber: "FM2601/0001T",
      partNumber: "17FM760D3",
      ...inspected(),
      ...workOrders(600100),
      qcInspector: "JN",
      inspectionDate: "2026-01-12",
      notes: "Tested, SFI",
    },
    40,
  ),
  record(
    2,
    {
      serialNumber: "FM2601/0002T",
      partNumber: "17FM760D3",
      ...inspected(),
      ...workOrders(600400),
      shipFirmwareRevision: "4.2.1",
      qcInspector: "AB",
      inspectionDate: "2026-01-13",
      notes: "Deviation. Replaced main card, retested at -40 °C.",
    },
    39,
  ),
  record(
    3,
    {
      serialNumber: "FM2602/0001T",
      partNumber: "17FM760D2",
      pinInspection: "Yes",
      connectorLabelsScrews: "Yes",
      connectorKeyway: "Yes",
      wo672255: "601233",
      wo672256: "601370",
    },
    2,
  ),
  record(4, { serialNumber: "FM2602/0002T", partNumber: "17FM760D3" }, 1),
];
