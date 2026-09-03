import type { PanelQcDefect, PanelQcIssue } from "@/types/task";

export const MOCK_PANEL_QC_DEFECTS: PanelQcDefect[] = [
  "Relay / Contact Failure",
  "LED / Fuse Indicator Failure",
  "Analog Output (AO) Signal Issue",
  "Discrete I/O (DO/DI) Malfunction",
  "Connector / Wiring Issue",
  "PCB Trace / Continuity Fault",
  "Labeling Error",
  "Display / HMI Issue",
  "Firmware / Communication Issue",
  "Other / Miscellaneous",
].map((name, index) => ({ id: index + 1, name }));

/**
 * Demo-only stand-in for the live "Status" choice column. Real mode never
 * uses this — it reads the column's actual configured choices straight off
 * SharePoint (see listPanelQcStatusChoices in api/panelQcIssues.ts) — but
 * mock mode has no live schema to read, so this seeds the picker. Order and
 * text transcribed from the column's own choice editor, 2026-09-03.
 */
export const MOCK_PANEL_QC_STATUS_CHOICES = [
  "Created",
  "Repair In-Process",
  "Repair Completed",
  "Repair Hold",
  "Panels Completed",
  "Repair Received",
];

/**
 * Demo-only stand-in for the live "Repair Defect Category" choice column —
 * same caveat as MOCK_PANEL_QC_STATUS_CHOICES above. A few of these entries
 * were truncated in the column editor screenshot they were transcribed
 * from; real mode is unaffected since it reads SharePoint's own text.
 * "No Problem Found" and "Electrical Damage" added 2026-09-03 to match
 * Ray's addition on the live column.
 */
export const MOCK_PANEL_QC_REPAIR_DEFECT_CHOICES = [
  "Process Solder Defect",
  "AE Solder Defect",
  "AE Wiring Deficiency",
  "AE Wrong or Missing Component",
  "AE Assembly Deficiency",
  "AE Identification Deficiency",
  "Programming/Firmware",
  "Coating/Potting Deficiency",
  "Machine Part Placement Deficiency",
  "Physical Damage",
  "Electrical Damage",
  "NCM Vendor",
  "NCM Internal",
  "No Problem Found",
  "Other",
];

export const MOCK_PANEL_QC_ISSUES: PanelQcIssue[] = [
  {
    id: 1,
    panelSerialNumber: "20442272-300",
    panelPartNumber: "",
    date: new Date("2025-02-25T12:00:00Z"),
    subComponentPartNumber: "1013-1688-00",
    partDescription: "Final ASSY DE-4000 Relay Flex PCB",
    subComponentSerialNumber: "",
    defectCategory: "LED / Fuse Indicator Failure",
    failureReported: "Fuse F5 red LED indicator light did not illuminate while pulled.",
    panelsResolution: "Replaced the board and fully tested the new one with no issues.",
    repairTechnician: "",
    repairDefectCategory: null,
    repairIssueFound: "",
    repairResolution: "",
    status: "Created",
    watchers: [],
    comments: [],
    hasAttachments: false,
    tagNumber: "",
  },
  {
    id: 2,
    panelSerialNumber: "20572122-200",
    panelPartNumber: "",
    date: new Date("2026-02-18T12:00:00Z"),
    subComponentPartNumber: "1002-4148-00",
    partDescription: "Final ASSY Terminal Module DE-4k",
    subComponentSerialNumber: "",
    defectCategory: "Analog Output (AO) Signal Issue",
    failureReported: "Terminal board 1 AO3 bounced from 5.1mA to 5.7mA at 0%.",
    panelsResolution: "Replaced the board and fully tested the new one with no issues.",
    repairTechnician: "Calderone",
    repairDefectCategory: null,
    repairIssueFound: "",
    repairResolution: "",
    status: "Repair Completed",
    watchers: [],
    comments: [],
    hasAttachments: false,
    tagNumber: "",
  },
  {
    id: 3,
    panelSerialNumber: "2119",
    panelPartNumber: "",
    date: new Date("2026-09-01T12:00:00Z"),
    subComponentPartNumber: "",
    partDescription: "AFR-controller AMP-5000",
    subComponentSerialNumber: "",
    defectCategory: "Discrete I/O (DO/DI) Malfunction",
    failureReported: "IN-11 would not get out of a faulted state even with wiring and dip switch correct.",
    panelsResolution: "",
    repairTechnician: "",
    repairDefectCategory: null,
    repairIssueFound: "",
    repairResolution: "",
    status: "Created",
    watchers: [],
    comments: [],
    hasAttachments: false,
    tagNumber: "",
  },
];
