import type { DrawingLogEntry } from "@/types/task";

// =============================================================================
// Demo fixtures for the drawing registers. Modelled on the real rows captured
// during discovery — CCC/CEC drawing numbers with part numbers and revisions,
// sketches with SK_Num and no change log — with invented content.
//
// Deliberately includes: a drawing with several change entries, one with SPARSE
// slots (01 and 03 filled, 02 empty), one with a full 16-slot log, and drawings
// with none at all. Those are the cases the change-log code has to survive.
// =============================================================================

function entry(partial: Omit<DrawingLogEntry, "createdAt" | "modifiedAt">): DrawingLogEntry {
  return {
    ...partial,
    createdAt: new Date("2020-01-06T10:00:00Z"),
    modifiedAt: new Date("2026-06-02T11:30:00Z"),
  };
}

const d = (iso: string) => new Date(iso);

export const MOCK_DRAWING_LOGS: DrawingLogEntry[] = [
  entry({
    id: 401,
    kind: "cad",
    title: "691201-1",
    partNo: "691201-1",
    description: "PCB ASSEMBLY, DSG-1201 IGNITION",
    dateStarted: d("2015-04-09T12:00:00Z"),
    dateRevised: d("2026-02-18T12:00:00Z"),
    size: "D",
    revNo: "E",
    changes: [
      { slot: 1, date: d("2018-11-02T12:00:00Z"), ecn: "ECN-0688", rev: "B" },
      { slot: 2, date: d("2021-05-14T12:00:00Z"), ecn: "ECN-0912", rev: "C" },
      { slot: 3, date: d("2026-02-18T12:00:00Z"), ecn: "ECN-1240", rev: "E" },
    ],
    legacyId: 812,
    sketchNumber: null,
    vCode: null,
    ventura: "",
  }),
  entry({
    id: 402,
    kind: "cad",
    title: "672337-1",
    partNo: "672337-1",
    description: "DISPLAY BEZEL, EX-4000",
    dateStarted: d("2019-08-21T12:00:00Z"),
    dateRevised: null,
    size: "B",
    revNo: "0",
    changes: [],
    legacyId: 903,
    sketchNumber: null,
    vCode: null,
    ventura: "",
  }),
  entry({
    id: 501,
    kind: "ccc",
    title: "50100008",
    partNo: "50100008",
    description: "ASSEMBLY, EXPLODED, AGV10",
    dateStarted: d("2002-01-15T12:00:00Z"),
    dateRevised: d("2024-03-11T12:00:00Z"),
    size: "D",
    revNo: "C",
    changes: [
      { slot: 1, date: d("2003-02-13T12:00:00Z"), ecn: "ECN-0142", rev: "B" },
      { slot: 2, date: d("2024-03-11T12:00:00Z"), ecn: "ECN-1187", rev: "C" },
    ],
    legacyId: 1,
    sketchNumber: null,
    vCode: null,
    ventura: "",
  }),
  entry({
    id: 502,
    kind: "ccc",
    title: "50100028",
    partNo: "50100028",
    description: "ASSEMBLY, BASIC SERVICE, AGV10",
    dateStarted: d("2002-07-17T12:00:00Z"),
    dateRevised: null,
    size: "C",
    revNo: "B",
    // No change entries at all — the common case in the real data.
    changes: [],
    legacyId: 2,
    sketchNumber: null,
    vCode: null,
    ventura: "",
  }),
  entry({
    id: 601,
    kind: "cec",
    title: "EC09002",
    partNo: "501500",
    description: "PICK-UP / DISC INSTALLATION EVEN FIRING ENGINE FOR ECIS 601",
    dateStarted: d("1989-10-25T12:00:00Z"),
    dateRevised: d("1994-06-08T12:00:00Z"),
    size: "B",
    revNo: "2",
    // Sparse slots: 1 and 3 used, 2 left empty. The next free slot is 2.
    changes: [
      { slot: 1, date: d("1990-01-12T12:00:00Z"), ecn: "ECN-0007", rev: "1" },
      { slot: 3, date: d("1994-06-08T12:00:00Z"), ecn: "ECN-0031", rev: "2" },
    ],
    legacyId: 1,
    sketchNumber: null,
    vCode: null,
    ventura: "",
  }),
  entry({
    id: 602,
    kind: "cec",
    title: "EC09003",
    partNo: "EC09 003",
    description: "PICK-UP / DISC INSTALLATION EVEN FIRING ENGINES FOR ECIS 801 IGNITION",
    dateStarted: d("1989-10-25T12:00:00Z"),
    dateRevised: d("2015-09-01T12:00:00Z"),
    size: "B",
    revNo: "P",
    // All sixteen slots used — appending must refuse rather than overwrite.
    changes: Array.from({ length: 16 }, (_, i) => ({
      slot: i + 1,
      date: d(`${1991 + i}-04-02T12:00:00Z`),
      ecn: `ECN-${String(100 + i).padStart(4, "0")}`,
      rev: String.fromCharCode(65 + i),
    })),
    legacyId: 2,
    sketchNumber: null,
    vCode: null,
    ventura: "",
  }),
  entry({
    id: 701,
    kind: "sketches",
    title: "WARTSILLA RUBBER ELEMENT (DAMPER)",
    partNo: "",
    description: "",
    dateStarted: d("2024-01-24T12:00:00Z"),
    dateRevised: null,
    size: "B",
    revNo: "",
    changes: [],
    legacyId: 3286,
    sketchNumber: 2274,
    vCode: 12,
    ventura: "",
  }),
  entry({
    id: 702,
    kind: "sketches",
    title: "GGT0065C + PLENUM ASSEMBLY 2 OUTLET",
    partNo: "",
    description: "",
    dateStarted: d("2025-10-22T12:00:00Z"),
    dateRevised: d("2025-10-22T12:00:00Z"),
    size: "D",
    revNo: "",
    changes: [],
    legacyId: 3300,
    sketchNumber: 2286,
    vCode: null,
    ventura: "GGT",
  }),
];
