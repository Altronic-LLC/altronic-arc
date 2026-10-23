import type { QcFormSpec, QcValues } from "./qcFormEngine";
import {
  QC_CPU95_FIELDS,
  QC_CPU95_SECTIONS,
  qcCpu95FiringGrid,
  qcCpu95FiringLetter,
  qcCpu95SectionTitle,
  qcCpu95StandardFiringSpecs,
  qcCpu95Variant,
} from "./qcCpu95Fields";
import { QC_CPU95_PART_NUMBER_SUGGESTIONS, qcCpu95Altmode } from "./qcCpu95Mapper";
import {
  QC_CPU95_BLANK_VARIANTS,
  qcCpu95SheetLayout,
  SHEET_CONTENT_BOTTOM,
  SHEET_CONTENT_TOP,
  SHEET_WIDTH,
} from "./qcCpu95Sheet";

// =============================================================================
// QCFRM-012 (CPU-95 Ignition Module Electrical Test and Inspection) as a QC
// form spec — everything the generic engine needs, and nothing more. The
// rules themselves live beside it: descriptors, variants and the firing grid
// in qcCpu95Fields.ts, the Altmode in qcCpu95Mapper.ts, the paper sheet in
// qcCpu95Sheet.ts.
// =============================================================================

const altModeOf = (values: QcValues) => qcCpu95Altmode(values.altronicPartNumber ?? "");
const slotKey = (prefix: string, slot: number) => `${prefix}${String(slot).padStart(2, "0")}`;

export const QC_CPU95_FORM: QcFormSpec = {
  id: "cpu-95",
  formNumber: "QCFRM-012",
  name: "CPU-95 Ignition Module",
  shortName: "CPU-95",
  description: "Electrical test and inspection — covers the CPU-95, CPU-95C, Varispark, and EVS paper variants.",
  pageDescription: "Electrical test and inspection — CPU-95, CPU-95C and EVS units.",
  noun: "test sheet",
  fields: QC_CPU95_FIELDS,
  sections: QC_CPU95_SECTIONS,
  unitOf(values) {
    const altMode = altModeOf(values);
    return {
      variant: qcCpu95Variant(altMode, values.altronicPartNumber ?? ""),
      slots: qcCpu95FiringGrid(altMode).cylinders,
    };
  },
  sectionTitle: (section, values) =>
    qcCpu95SectionTitle(section as (typeof QC_CPU95_SECTIONS)[number], values ? altModeOf(values) : null),
  serialKey: "serialNumber",
  partNumberKey: "altronicPartNumber",
  partNumberSuggestions: QC_CPU95_PART_NUMBER_SUGGESTIONS,
  status: {
    completeKeys: ["finalInspectionBy", "finalInspectionDate"],
    repairKey: "inRepair",
    dateKey: "dateTested",
  },
  list: {
    columns: [
      { key: "serialNumber", label: "Serial / Unit #" },
      { key: "altronicPartNumber", label: "Altronic Part #" },
      { key: "customer", label: "Customer" },
      { key: "testStandNumber", label: "Test Stand #", kind: "numeric-text" },
      { key: "dateTested", label: "Date Tested", kind: "date" },
      { key: "finalTestBy", label: "Final Test By" },
      { key: "finalInspectionDate", label: "Final Inspection Date", kind: "date" },
    ],
    searchKeys: [
      "serialNumber",
      "altronicPartNumber",
      "customer",
      "testStandNumber",
      "testMemoryNumber",
      "finalTestBy",
      "finalInspectionBy",
      "comments",
    ],
    searchPlaceholder: "Search serial#, part#, customer, test stand, tester…",
  },
  firingGrid: {
    section: "Firing Angles",
    atSpecKey: "firingActualsAtSpec",
    specKey: (slot) => slotKey("firingSpec", slot),
    actualKey: (slot) => slotKey("firingActual", slot),
    letter: (slot, values) => qcCpu95FiringLetter(slot, values ? altModeOf(values) : null),
    standardSpecs: (values) => qcCpu95StandardFiringSpecs(values.altronicPartNumber ?? "", altModeOf(values)),
  },
  sheet: {
    width: SHEET_WIDTH,
    contentTop: SHEET_CONTENT_TOP,
    contentBottom: SHEET_CONTENT_BOTTOM,
    layout: qcCpu95SheetLayout,
    blankVariants: QC_CPU95_BLANK_VARIANTS,
    blankVariantsEmptyLabel: "Every variant (all lines)",
  },
};
