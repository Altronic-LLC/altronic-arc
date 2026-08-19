// =============================================================================
// Gray Market Request — the columns, as DATA.
//
// This list has thirty-odd editable columns spanning four teams' parts of one
// workflow. Hand-writing an input per column in both the form and the detail
// view would be sixty blocks of near-identical JSX, and the next column added
// in SharePoint would need editing in both. So the columns are declared once
// here and the mapper, the write payload, the $select, the detail sections and
// the form are all driven from it — the same arrangement as the drawing-log
// registers (see drawingLogFields.ts).
//
// Column names come from the live list (scripts/gray-market-request-schema.json,
// captured 2026-08-19). Several of them do NOT say what they mean, which is the
// main reason this table exists:
//
//   QANotes                          → labelled "Inspection Flag" (Yes/Pending)
//   QtyofPartsforW_x002e_O_x002e_    → labelled "Qty of Parts for BR"
//   InCircuitPCBW_x002e_O_x002e__x00 → TRUNCATED internal name, "In Circuit PCB W.O. #"
//   FinalAssemblyW_x002e_O_x002e__x0 → TRUNCATED internal name, "Final Assembly W.O.#"
//   Parts_x0020_Location             → a PERSON column, despite the name
//   Title                            → the Altronic assembly number
//
// Guessing any of those from the label would write to a column that doesn't
// exist, which SharePoint accepts silently on some paths and 400s on others.
// =============================================================================

/** The workflow stage a field belongs to — one card each on the detail page. */
export type GrayMarketSection =
  | "Request"
  | "Purchasing"
  | "Engineering"
  | "Inspection"
  | "Production";

export const GRAY_MARKET_SECTIONS: GrayMarketSection[] = [
  "Request",
  "Purchasing",
  "Engineering",
  "Inspection",
  "Production",
];

export type GrayMarketFieldKind = "text" | "multiline" | "richText" | "choice";

export interface GrayMarketField {
  /** Domain key, used in `GrayMarketRequest.values`. */
  key: string;
  /** SharePoint internal column name — the thing that must be exact. */
  column: string;
  /** The list's own display name. */
  label: string;
  kind: GrayMarketFieldKind;
  section: GrayMarketSection;
  choices?: readonly string[];
}

/**
 * Every string-valued column, in the order it appears on the detail page.
 *
 * Title, Log No., Request Status, the two dates and the two person columns are
 * NOT here — they're named fields on the domain type because they need their
 * own handling (numbering, pills, date-only parsing, person envelopes).
 */
export const GRAY_MARKET_FIELDS: GrayMarketField[] = [
  // ---- Request ------------------------------------------------------------
  { key: "aiPartNo", column: "AIPartNo_x002e_", label: "AI Part No.", kind: "text", section: "Request" },
  { key: "partDescription", column: "PartDescription", label: "Part Description", kind: "text", section: "Request" },
  { key: "mfgPartNo", column: "MFG_x002e_PartNo_x002e_", label: "MFG. Part No.", kind: "text", section: "Request" },
  { key: "whereUsed", column: "WhereUsed", label: "Where Used", kind: "richText", section: "Request" },
  { key: "eirNo", column: "EIRNO_x002e_", label: "EIR No.", kind: "text", section: "Request" },

  // ---- Purchasing ---------------------------------------------------------
  { key: "vendor", column: "Vendor", label: "Vendor", kind: "text", section: "Purchasing" },
  { key: "qtyPurchased", column: "Qty_x002e_Purchased", label: "Qty. Purchased", kind: "text", section: "Purchasing" },
  { key: "poNo", column: "PONo_x002e_", label: "PO No.", kind: "text", section: "Purchasing" },
  { key: "purComments", column: "PurComments", label: "Pur Comments", kind: "multiline", section: "Purchasing" },

  // ---- Engineering --------------------------------------------------------
  { key: "qtyForBuildRequest", column: "QtyofPartsforW_x002e_O_x002e_", label: "Qty of Parts for BR", kind: "text", section: "Engineering" },
  { key: "buildRequestNo", column: "Build_x0020_Request_x0020_No", label: "Build Request No", kind: "text", section: "Engineering" },
  { key: "testComments", column: "TestComments", label: "Test Comments", kind: "multiline", section: "Engineering" },
  { key: "failedTestComments", column: "Failed_x0020_Test_x0020_Comments", label: "Failed Test Comments", kind: "multiline", section: "Engineering" },
  { key: "engineeringInitials", column: "EngineeringInitials", label: "Engineering Initials", kind: "text", section: "Engineering" },

  // ---- Inspection ---------------------------------------------------------
  {
    key: "inspectionFlag",
    column: "QANotes", // NOT a notes field — the label is "Inspection Flag".
    label: "Inspection Flag",
    kind: "choice",
    choices: ["Yes", "Pending"],
    section: "Inspection",
  },
  { key: "qtyReceived", column: "QtyReceived", label: "Qty Received", kind: "text", section: "Inspection" },
  { key: "qtyReleased", column: "QtyReleased", label: "Qty Released", kind: "text", section: "Inspection" },
  { key: "inspLotNo", column: "InspLotNo_x002e_", label: "Insp Lot No.", kind: "text", section: "Inspection" },
  { key: "dateCodes", column: "DateCodes", label: "Date Codes", kind: "multiline", section: "Inspection" },
  { key: "inspSummary", column: "InspSummary", label: "Insp Summary", kind: "multiline", section: "Inspection" },
  { key: "qaInitials", column: "QAInitials", label: "QA Initials", kind: "text", section: "Inspection" },
  {
    key: "inspectionFlagUpdated",
    column: "InspectionFlagUpdated",
    label: "Inspection Flag Updated",
    kind: "choice",
    choices: ["Yes", "No"],
    section: "Inspection",
  },
  {
    key: "gmNotesRemoved",
    column: "GMNotesRemoved",
    label: "GM Notes Removed",
    kind: "choice",
    choices: ["Yes", "No"],
    section: "Inspection",
  },
  { key: "supplierQualityInitials", column: "SupplierQualityInitials", label: "Supplier Quality Initials", kind: "text", section: "Inspection" },

  // ---- Production ---------------------------------------------------------
  { key: "inCircuitWo", column: "InCircuitPCBW_x002e_O_x002e__x00", label: "In Circuit PCB W.O. #", kind: "text", section: "Production" },
  {
    key: "inCircuitResults",
    column: "InCircuitResults",
    label: "In Circuit Results",
    kind: "choice",
    choices: ["Pass", "Fail"],
    section: "Production",
  },
  { key: "finalAssemblyWo", column: "FinalAssemblyW_x002e_O_x002e__x0", label: "Final Assembly W.O. #", kind: "text", section: "Production" },
  {
    key: "finalAssyResults",
    column: "FinalAssyResults",
    label: "Final Assy Results",
    kind: "choice",
    choices: ["Pass", "Fail"],
    section: "Production",
  },
  { key: "serialNo", column: "SerialNo", label: "Serial No", kind: "multiline", section: "Production" },
  { key: "productionComments", column: "ProductionComments", label: "Production Comments", kind: "multiline", section: "Production" },
  { key: "productionInitials", column: "ProductionInitials", label: "Production Initials", kind: "text", section: "Production" },
  { key: "signOffStatus", column: "Sign_x002d_off_x0020_status", label: "Sign-off status", kind: "text", section: "Production" },
];

export function fieldsInSection(section: GrayMarketSection): GrayMarketField[] {
  return GRAY_MARKET_FIELDS.filter((f) => f.section === section);
}

/** The `$select` for a read — descriptor columns plus the named ones. */
export const GRAY_MARKET_SELECT = [
  "Title",
  "LogNo_x002e_Raw",
  "RequestStatus",
  "TodaysDate",
  "DateCompleted",
  "ProductionTest",
  "Requestor",
  "Parts_x0020_Location",
  "Watchers",
  "Communication",
  "Attachments",
  "Created",
  "Modified",
  ...GRAY_MARKET_FIELDS.map((f) => f.column),
].join(",");

/** Request Status choices — drives the status pills. */
export const GRAY_MARKET_STATUSES = ["Open", "Complete"] as const;

/** "Testing Required" (`ProductionTest`) — required by the list. */
export const GRAY_MARKET_TESTING_REQUIRED = ["In Process", "Yes", "No"] as const;
