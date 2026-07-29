import type { DrawingChange, DrawingLogEntry, DrawingLogKind } from "@/types/task";

// =============================================================================
// Demo fixtures for the drawing registers.
//
// Modelled on real rows captured during discovery — CAD's separate drawing
// number and CAD number, CCC/CEC part numbers and revisions, sketches with a
// SK_Num and no change log — with invented content.
//
// Deliberately includes the cases the change-log code has to survive: several
// entries, SPARSE slots (01 and 03 used, 02 empty), a full 16-slot log, and rows
// with no changes at all.
// =============================================================================

const d = (iso: string) => new Date(iso);

function entry(
  kind: DrawingLogKind,
  id: number,
  values: Record<string, string | number | Date | null>,
  changes: DrawingChange[] = [],
): DrawingLogEntry {
  return {
    id,
    kind,
    values,
    changes,
    createdAt: new Date("2020-01-06T10:00:00Z"),
    modifiedAt: new Date("2026-06-02T11:30:00Z"),
  };
}

export const MOCK_DRAWING_LOGS: DrawingLogEntry[] = [
  // ---- CAD: drawing number and CAD number are DIFFERENT values -------------
  entry(
    "cad",
    401,
    {
      drawingNo: "501 505",
      cadNumber: "501505",
      drawingTitle: "CAPACITOR 66µF, 250VDC",
      size: "B",
      newRevision: "2",
      dateCompleted: d("2025-12-30T12:00:00Z"),
      drawingDate: d("2025-12-30T12:00:00Z"),
      logBookDate: null,
      newDrawing: "",
      software: "",
      legacyId: 17832,
    },
    [
      { slot: 1, date: d("2010-04-23T12:00:00Z"), ecn: "100027", rev: "1" },
      { slot: 2, date: d("2025-12-30T12:00:00Z"), ecn: "250112", rev: "2" },
    ],
  ),
  entry("cad", 402, {
    drawingNo: "504 535",
    cadNumber: "504535",
    drawingTitle: "CONNECTOR - 48-PIN MALE, 1/4-20 TAP",
    size: "B",
    newRevision: "0",
    dateCompleted: d("2026-03-13T12:00:00Z"),
    drawingDate: d("2026-03-13T12:00:00Z"),
    logBookDate: null,
    newDrawing: "",
    software: "",
    legacyId: 17846,
  }),
  entry("cad", 403, {
    drawingNo: "515 043",
    cadNumber: "515043",
    drawingTitle: "MACHINING, TOP, DUAL OUTPUTS, EZRAIL SYSTEM",
    size: "C",
    newRevision: "0",
    dateCompleted: d("2026-04-14T12:00:00Z"),
    drawingDate: d("2026-04-20T12:00:00Z"),
    logBookDate: null,
    newDrawing: "",
    software: "SolidWorks",
    legacyId: 17858,
  }),

  // ---- CCC ----------------------------------------------------------------
  entry(
    "ccc",
    501,
    {
      drawingNo: "50100008",
      partNo: "50100008",
      description: "ASSEMBLY, EXPLODED, AGV10",
      size: "D",
      revNo: "C",
      dateStarted: d("2002-01-15T12:00:00Z"),
      dateRevised: d("2024-03-11T12:00:00Z"),
      legacyId: 1,
    },
    [
      { slot: 1, date: d("2003-02-13T12:00:00Z"), ecn: "ECN-0142", rev: "B" },
      { slot: 2, date: d("2024-03-11T12:00:00Z"), ecn: "ECN-1187", rev: "C" },
    ],
  ),
  entry("ccc", 502, {
    drawingNo: "50100028",
    partNo: "50100028",
    description: "ASSEMBLY, BASIC SERVICE, AGV10",
    size: "C",
    revNo: "B",
    dateStarted: d("2002-07-17T12:00:00Z"),
    dateRevised: null,
    legacyId: 2,
  }),

  // ---- CEC: one sparse change log, one full one ---------------------------
  entry(
    "cec",
    601,
    {
      drawingNo: "EC09002",
      partNo: "501500",
      description: "PICK-UP / DISC INSTALLATION EVEN FIRING ENGINE FOR ECIS 601",
      size: "B",
      revNo: "2",
      dateStarted: d("1989-10-25T12:00:00Z"),
      dateRevised: d("1994-06-08T12:00:00Z"),
      legacyId: 1,
    },
    // Slots 1 and 3 used, 2 left empty — the next free slot is 2.
    [
      { slot: 1, date: d("1990-01-12T12:00:00Z"), ecn: "ECN-0007", rev: "1" },
      { slot: 3, date: d("1994-06-08T12:00:00Z"), ecn: "ECN-0031", rev: "2" },
    ],
  ),
  entry(
    "cec",
    602,
    {
      drawingNo: "EC09003",
      partNo: "EC09 003",
      description: "PICK-UP / DISC INSTALLATION EVEN FIRING ENGINES FOR ECIS 801 IGNITION",
      size: "B",
      revNo: "P",
      dateStarted: d("1989-10-25T12:00:00Z"),
      dateRevised: d("2015-09-01T12:00:00Z"),
      legacyId: 2,
    },
    // All sixteen slots used — appending must refuse rather than overwrite.
    Array.from({ length: 16 }, (_, i) => ({
      slot: i + 1,
      date: d(`${1991 + i}-04-02T12:00:00Z`),
      ecn: `ECN-${String(100 + i).padStart(4, "0")}`,
      rev: String.fromCharCode(65 + i),
    })),
  ),

  // ---- Sketches: own columns, never a change log --------------------------
  entry("sketches", 701, {
    title: "WARTSILLA RUBBER ELEMENT (DAMPER)",
    sketchNumber: 2274,
    size: "B",
    ventura: "",
    dateStarted: d("2024-01-24T12:00:00Z"),
    dateRevised: null,
    vCode: 12,
    legacyId: 3286,
  }),
  entry("sketches", 702, {
    title: "GGT0065C + PLENUM ASSEMBLY 2 OUTLET",
    sketchNumber: 2286,
    size: "D",
    ventura: "GGT",
    dateStarted: d("2025-10-22T12:00:00Z"),
    dateRevised: d("2025-10-22T12:00:00Z"),
    vCode: null,
    legacyId: 3300,
  }),
];
