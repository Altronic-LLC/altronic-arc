// =============================================================================
// FAIT — the columns, as DATA.
//
// First Article Inspection Test: a new or changed part arrives from a
// supplier, quality inspects it, and SQE, Engineering and the KAM each sign
// off. Fifty-one editable columns spanning four teams' parts of one workflow,
// so they're declared once here and the mapper, write payload, `$select`,
// detail cards and create form all run off it — the same arrangement as the
// gray market and ECN registers.
//
// Column names come from the live list — scripts/fait-schema.json, captured
// 2026-08-20. Unlike the ECN list, these names say what they mean; the thing
// that bites here is the sheer number of Yes/No flags (nineteen), which is why
// the detail page groups them rather than listing them.
//
// Two columns were added for ARC on 2026-08-20: `Communication` (the comment
// thread) and `Watchers`. Everything else predates the app.
// =============================================================================

/** The card a field belongs to on the detail page. */
export type FaitSection = "Part" | "Request" | "Inspection" | "Results" | "Sign-off";

export const FAIT_SECTIONS: FaitSection[] = [
  "Part",
  "Request",
  "Inspection",
  "Results",
  "Sign-off",
];

/**
 * How a field is stored and rendered.
 *
 *  - `text`      single-line
 *  - `multiline` a longer free-text box
 *  - `boolean`   a real SharePoint Yes/No column, carried in `values` as
 *                "Yes" / "" so the record stays one shape
 *  - `choice`    a SharePoint choice column
 *  - `date`      date-only; midday-UTC on write (see spDates)
 */
export type FaitFieldKind = "text" | "multiline" | "boolean" | "choice" | "date";

export interface FaitField {
  /** Domain key, used in `Fait.values`. */
  key: string;
  /** SharePoint internal column name. */
  column: string;
  label: string;
  kind: FaitFieldKind;
  section: FaitSection;
  choices?: readonly string[];
  hint?: string;
}

export const FAIT_FIELDS: FaitField[] = [
  // ---- Part ---------------------------------------------------------------
  { key: "sapPartNumber", column: "SAPPartNumber", label: "SAP Part Number", kind: "text", section: "Part" },
  { key: "description", column: "Description", label: "Description", kind: "text", section: "Part" },
  { key: "drawingNumber", column: "DrawingNumber", label: "Drawing Number", kind: "text", section: "Part" },
  { key: "revLevel", column: "RevLevel", label: "Rev Level", kind: "text", section: "Part" },
  { key: "supplierName", column: "SupplierName", label: "Supplier Name", kind: "text", section: "Part" },
  { key: "purchaseOrderNum", column: "PurchaseOrderNum", label: "Purchase Order Number", kind: "text", section: "Part" },

  // ---- Request ------------------------------------------------------------
  { key: "newPart", column: "NewPart", label: "New Part", kind: "boolean", section: "Request" },
  { key: "revisedProductionPart", column: "RevisedProductionPart", label: "Revised Production Part", kind: "boolean", section: "Request" },
  { key: "newSupplierQualification", column: "NewSupplierQualification", label: "New Supplier Qualification", kind: "boolean", section: "Request" },
  { key: "reqInSapPo", column: "ReqinSAPPO", label: "Req in SAP PO", kind: "boolean", section: "Request" },
  { key: "oemImpact", column: "OEMImpact", label: "OEM Impact", kind: "boolean", section: "Request" },
  { key: "requestCmmReport", column: "RequestCMMReport", label: "Request CMM Report", kind: "boolean", section: "Request" },
  {
    key: "additionalRequestedPerformanceBy",
    column: "AdditionalRequestedPerformanceBy",
    label: "Additional Requested Performance By",
    kind: "choice",
    choices: ["Quality only", "Engineering and Quality", "Engineering only"],
    section: "Request",
  },

  // ---- Inspection ---------------------------------------------------------
  { key: "fullDimensionalCheck", column: "FullDimensionalCheck", label: "Full Dimensional Check", kind: "boolean", section: "Inspection" },
  { key: "visualAttributes", column: "VisualAttributes", label: "Visual Attributes", kind: "boolean", section: "Inspection" },
  { key: "functionalCheck", column: "FunctionalCheck", label: "Functional Check", kind: "boolean", section: "Inspection" },
  { key: "additionalTests", column: "AdditionalTests", label: "Additional Tests", kind: "boolean", section: "Inspection" },
  { key: "turnOnReceivingInspection", column: "TurnOnReceivingInspection", label: "Turn On Receiving Inspection", kind: "boolean", section: "Inspection" },
  { key: "selectInspectionFrequencySap", column: "SelectInspectionFrequencySAP", label: "Select Inspection Frequency SAP", kind: "boolean", section: "Inspection" },
  { key: "updateNotesInstructions", column: "UpdateNotesInstructions", label: "Update Notes Instructions", kind: "boolean", section: "Inspection" },
  { key: "testDocumentNumber", column: "TestDocumentNumber", label: "Test Document Number", kind: "text", section: "Inspection" },

  // ---- Results ------------------------------------------------------------
  { key: "meetsFirstPass", column: "MeetsFirstPass", label: "Meets First Pass", kind: "boolean", section: "Results" },
  { key: "failedFirstPass", column: "FailedFirstPass", label: "Failed First Pass", kind: "boolean", section: "Results" },
  { key: "failedFirstPassDate", column: "FailedFirstPassDate", label: "Failed First Pass Date", kind: "date", section: "Results" },
  { key: "failedReason", column: "FailedReason", label: "Failed Reason", kind: "multiline", section: "Results" },
  { key: "failureResolved", column: "FailureResolved", label: "Failure Resolved", kind: "boolean", section: "Results" },
  {
    key: "acceptedWithInternalModification",
    column: "AcceptedWithInternalModification",
    label: "Accepted With Internal Modification / Deviation",
    kind: "boolean",
    section: "Results",
  },
  { key: "waived", column: "Waived", label: "Waived Additional", kind: "boolean", section: "Results" },
  { key: "waivedDate", column: "WaivedDate", label: "Waived Date", kind: "date", section: "Results" },
  { key: "waivedReason", column: "WaivedReason", label: "Waived Reason", kind: "multiline", section: "Results" },
  {
    key: "waivedAdditionalEngineering",
    column: "WaivedAdditionalEngineering",
    label: "Waived Additional Engineering",
    kind: "multiline",
    section: "Results",
  },
  {
    key: "sampleDisposition",
    column: "SampleDisposition",
    label: "Sample Disposition",
    kind: "choice",
    choices: ["Return to Vendor", "Purchased Sample"],
    section: "Results",
  },

  // ---- Sign-off -----------------------------------------------------------
  {
    key: "sqeSignOff",
    column: "SQESignOff",
    label: "SQE Sign Off",
    kind: "choice",
    choices: ["Approved", "Pending", "Failed"],
    section: "Sign-off",
  },
  { key: "sqeInitials", column: "SQEINITIALS", label: "SQE Initials", kind: "text", section: "Sign-off" },
  { key: "sqeApprovalNotes", column: "SQEApprovalNotes", label: "SQE Approval Notes", kind: "multiline", section: "Sign-off" },
  {
    key: "engSignOff",
    column: "EngSignOff",
    label: "Eng Sign Off",
    kind: "choice",
    // The list offers only "Approved" — there is no rejection value, which is
    // why the pills carry a Not set option to undo one.
    choices: ["Approved"],
    section: "Sign-off",
  },
  { key: "engInitials", column: "EngInitials", label: "Eng Initials", kind: "text", section: "Sign-off" },
  { key: "engApprovalNotes", column: "EngApprovalNotes", label: "Eng Approval Notes", kind: "multiline", section: "Sign-off" },
  {
    key: "kamSignOff",
    column: "KAMSignOff",
    label: "KAM Sign Off",
    kind: "choice",
    choices: ["Approved"],
    section: "Sign-off",
  },
  { key: "kamInitials", column: "KAMINITIALS", label: "KAM Initials", kind: "text", section: "Sign-off" },
  { key: "kamApprovalNotes", column: "KAMApprovalNotes", label: "KAM Approval Notes", kind: "multiline", section: "Sign-off" },
  { key: "notifyInitiator", column: "NotifyInitiator", label: "Notify Initiator", kind: "boolean", section: "Sign-off" },
  { key: "notes", column: "Notes", label: "Notes", kind: "multiline", section: "Sign-off" },
];

export const FAIT_FIELD_BY_KEY: Record<string, FaitField> = Object.fromEntries(
  FAIT_FIELDS.map((f) => [f.key, f]),
);

export function faitFieldsInSection(section: FaitSection): FaitField[] {
  return FAIT_FIELDS.filter((f) => f.section === section);
}

/** `Status` — drives the pills on the list view. */
export const FAIT_STATUSES = [
  "Open",
  "FAIT Part Received",
  "This is with SQE",
  "This is with ENG",
  "This is with KAM",
  "Closed",
] as const;

/** Anything that isn't Closed is still live work. */
export function isFaitOpen(status: string): boolean {
  return (status ?? "").trim().toLowerCase() !== "closed";
}

/**
 * The `$select` for a read — descriptor columns plus the named ones.
 *
 * `Title` is deliberately included even though every sampled row has it empty:
 * the column exists, someone may start using it, and leaving it out would make
 * that invisible. The list view leads with SAP Part Number instead.
 */
export const FAIT_SELECT = [
  "Title",
  "Status",
  "ProjectReferenceLookupId",
  "EIR_x0020_ReferenceLookupId",
  "TestDocumentReferenceLookupId",
  // Both halves of every single-person column. Graph hands a single-value
  // person column back as a BARE `<Name>LookupId` — no display name, no
  // email — so selecting only the friendly name reads every one of these as
  // nobody. The ids are resolved to people against the site's User
  // Information List in `listFaits` (see resolveFaitPeople).
  "AssignedEngineer",
  "AssignedEngineerLookupId",
  "Initiator",
  "InitiatorLookupId",
  "KAM",
  "KAMLookupId",
  "Communication",
  "Watchers",
  "Attachments",
  "Created",
  "Modified",
  ...FAIT_FIELDS.map((f) => f.column),
].join(",");
