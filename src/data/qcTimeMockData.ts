import type { QcTimeEntry } from "@/types/task";

// =============================================================================
// Sample QC Time Tracking entries for mock mode.
//
// Shaped after the real column set: Week and dates are frequently blank in the
// source CSV, Hours is TEXT (not always a clean number), and a "combo" row
// carries two people in PerformedByPeople because the original cell had two
// names typed into it.
// =============================================================================

const KIM = { displayName: "Kim Tech", email: "kim.tech@altronic-llc.com", lookupId: 61 };
const DAVID = { displayName: "David Bulkley", email: "david.bulkley@altronic-llc.com", lookupId: 24 };
const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 46 };

function d(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export const MOCK_QC_TIME_ENTRIES: QcTimeEntry[] = [
  {
    id: 1,
    project: "DE-4000 Refresh",
    week: 35,
    dateIntoQc: d("2026-08-24"),
    dateStarted: d("2026-08-25"),
    sapNo: "SAP-40021",
    serialNo: "SN-88213",
    performedBy: [KIM],
    performedByRaw: "Kim Tech",
    hoursRaw: "6.5",
    effortType: "New Panel",
    notes: "First article — extra time on wiring checks.",
    createdAt: d("2026-08-25"),
    modifiedAt: d("2026-08-25"),
  },
  {
    id: 2,
    project: "CPU-XL Standard",
    week: 35,
    dateIntoQc: null,
    dateStarted: d("2026-08-26"),
    sapNo: "SAP-40022",
    serialNo: "SN-88214",
    // A combo row — the source cell read "David Bulkley / Sarah Shaffer".
    performedBy: [DAVID, SARAH],
    performedByRaw: "David Bulkley / Sarah Shaffer",
    hoursRaw: "4",
    effortType: "Repeat Panel",
    notes: "",
    createdAt: d("2026-08-26"),
    modifiedAt: d("2026-08-26"),
  },
  {
    id: 3,
    // Sparse row, on purpose: Week, Date into QC and Hours are all blank in
    // real rows from this list, and the screen has to render that plainly.
    project: "Field Return Rework",
    week: null,
    dateIntoQc: null,
    dateStarted: null,
    sapNo: "",
    serialNo: "SN-77002",
    performedBy: [],
    performedByRaw: "",
    hoursRaw: "",
    effortType: "Support",
    notes: "Waiting on customer to ship the unit back.",
    createdAt: d("2026-08-20"),
    modifiedAt: d("2026-08-20"),
  },
  {
    id: 4,
    project: "Gemini Panel Redesign",
    week: 34,
    dateIntoQc: d("2026-08-18"),
    dateStarted: d("2026-08-18"),
    sapNo: "SAP-39990",
    serialNo: "SN-88190",
    performedBy: [KIM],
    performedByRaw: "Kim Tech",
    // A real non-numeric HoursRaw value — the source data has a few of these.
    hoursRaw: "see notes",
    effortType: "Project Work",
    notes: "Split across two days; logged against the project ticket instead.",
    createdAt: d("2026-08-18"),
    modifiedAt: d("2026-08-19"),
  },
];
