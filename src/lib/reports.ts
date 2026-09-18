// =============================================================================
// Reports registry — one entry per fixed KPI dashboard on the Reports landing
// page (`/reports`) AND the kiosk cycle (`/reports/kiosk`, KioskReportsView).
// A new dashboard is a new entry here plus its own view; nothing else is
// shared beyond this list, the landing page, and the kiosk.
//
// Deliberately NOT a dashboard-builder — these are code-defined, fixed
// charts, not something an admin assembles from a config file. See CLAUDE.md
// for the reasoning.
//
// The trend chart and the defect-breakdown donut for one data source are TWO
// entries here, not one report with two charts (Tim, 2026-09-18) — each has
// its own page, its own card on the landing grid, and its own slot in the
// kiosk cycle. They're listed FPY-then-donut, source by source, so the kiosk
// (which just cycles this array in order) alternates trend/breakdown for one
// dataset before moving to the next, rather than grouping all three trend
// charts together and all three donuts together.
//
// `department` is an internal three-letter tag per source (Tim, 2026-09-18) —
// ICT (Teradyne), DIG (Digital QC), IGN (Ignition QC) — so the kiosk can be
// pointed at just one source via `?dept=`. It plays no other role: the
// landing page shows every report regardless, and it isn't a SharePoint
// concept, just a short code for a URL param.
// =============================================================================

export type ReportDepartment = "ICT" | "DIG" | "IGN";

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  route: string;
  department: ReportDepartment;
}

export const REPORTS: ReportDef[] = [
  {
    key: "teradyne-fpy",
    title: "Teradyne Board Test & FPY",
    description:
      "Boards tested, boards failed, and First Pass Yield by month, from the Teradyne Log.",
    route: "/reports/teradyne-fpy",
    department: "ICT",
  },
  {
    key: "teradyne-defects",
    title: "Teradyne Defect Breakdown",
    description: "What failed last month, and how much, from the Teradyne Log.",
    route: "/reports/teradyne-defects",
    department: "ICT",
  },
  {
    key: "digital-qc-fpy",
    title: "Digital QC Board Test & FPY",
    description:
      "Units tested, units failed, and First Pass Yield by month, from the Digital QC Defect Log.",
    route: "/reports/digital-qc-fpy",
    department: "DIG",
  },
  {
    key: "digital-qc-defects",
    title: "Digital QC Defect Breakdown",
    description: "What failed last month, and how much, from the Digital QC Defect Log.",
    route: "/reports/digital-qc-defects",
    department: "DIG",
  },
  {
    key: "ignition-qc-fpy",
    title: "Ignition QC Board Test & FPY",
    description:
      "Units tested, units failed, and First Pass Yield by month, from the Ignition QC Defect Log.",
    route: "/reports/ignition-qc-fpy",
    department: "IGN",
  },
  {
    key: "ignition-qc-defects",
    title: "Ignition QC Defect Breakdown",
    description: "What failed last month, and how much, from the Ignition QC Defect Log.",
    route: "/reports/ignition-qc-defects",
    department: "IGN",
  },
];
