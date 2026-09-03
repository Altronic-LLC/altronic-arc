import type { Fait } from "@/types/task";

// =============================================================================
// Sample FAITs for mock mode.
//
// Shaped after the real rows (scripts/fait-schema.json): Title is empty —
// as it is on every row the live list holds — so the identifiers are the SAP
// part number and description, and the project lookup is set on only some,
// mirroring a list where it exists but has barely been used.
//
// Project lookupIds are real ones from MOCK_PROJECTS, so the dashboard's
// project filter has something to match.
// =============================================================================

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

/** Every boolean and date key, so a fixture only names what it sets. */
const BLANK: Record<string, string> = {
  newPart: "",
  revisedProductionPart: "",
  newSupplierQualification: "",
  reqInSapPo: "",
  oemImpact: "",
  requestCmmReport: "",
  additionalRequestedPerformanceBy: "",
  fullDimensionalCheck: "",
  visualAttributes: "",
  functionalCheck: "",
  additionalTests: "",
  turnOnReceivingInspection: "",
  selectInspectionFrequencySap: "",
  updateNotesInstructions: "",
  testDocumentNumber: "",
  meetsFirstPass: "",
  failedFirstPass: "",
  failedFirstPassDate: "",
  failedReason: "",
  failureResolved: "",
  acceptedWithInternalModification: "",
  waived: "",
  waivedDate: "",
  waivedReason: "",
  waivedAdditionalEngineering: "",
  sampleDisposition: "",
  sqeSignOff: "",
  sqeInitials: "",
  sqeApprovalNotes: "",
  engSignOff: "",
  engInitials: "",
  engApprovalNotes: "",
  kamSignOff: "",
  kamInitials: "",
  kamApprovalNotes: "",
  notifyInitiator: "",
  notes: "",
  sapPartNumber: "",
  description: "",
  drawingNumber: "",
  revLevel: "",
  supplierName: "",
  purchaseOrderNum: "",
};

const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" };
const JERROD = { displayName: "Jerrod Waldron", email: "jerrod.waldron@altronic-llc.com" };
const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

export const MOCK_FAITS: Fait[] = [
  {
    id: 1,
    title: "",
    status: "Open",
    parentProject: { lookupId: 501, title: "" },
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: SARAH,
    assignedEngineer: null,
    kam: null,
    watchers: [SARAH],
    comments: [],
    hasAttachments: false,
    values: {
      ...BLANK,
      sapPartNumber: "1000-9542-00",
      description: "FLANGE, ALUM 6013",
      drawingNumber: "720-0010",
      revLevel: "REV A",
      supplierName: "PR MACHINE - 1 SAMPLES",
      newPart: "Yes",
      newSupplierQualification: "Yes",
      oemImpact: "Yes",
      notifyInitiator: "Yes",
      additionalRequestedPerformanceBy: "Quality only",
    },
    createdAt: daysAgo(3),
    modifiedAt: daysAgo(1),
  },
  {
    id: 2,
    title: "",
    status: "This is with SQE",
    parentProject: { lookupId: 501, title: "" },
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: SARAH,
    assignedEngineer: JERROD,
    kam: RAY,
    watchers: [SARAH, JERROD],
    comments: [
      {
        timestamp: daysAgo(2),
        authorName: "Jerrod Waldron",
        authorEmail: "jerrod.waldron@altronic-llc.com",
        bodyHtml: "<p>Dimensional check is done — waiting on the CMM report before sign-off.</p>",
        attachments: [],
      },
    ],
    hasAttachments: true,
    values: {
      ...BLANK,
      sapPartNumber: "710213",
      description: "CASTING, ENCLOSURE WCD-10",
      drawingNumber: "710213",
      supplierName: "MIDWEST CASTING",
      purchaseOrderNum: "4500475605 (1 SAMPLE ORDERED)",
      reqInSapPo: "Yes",
      newSupplierQualification: "Yes",
      oemImpact: "Yes",
      fullDimensionalCheck: "Yes",
      meetsFirstPass: "Yes",
      requestCmmReport: "Yes",
      sqeSignOff: "Pending",
      additionalRequestedPerformanceBy: "Engineering and Quality",
    },
    createdAt: daysAgo(14),
    modifiedAt: daysAgo(2),
  },
  {
    id: 3,
    title: "",
    status: "Closed",
    parentProject: null,
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: JERROD,
    assignedEngineer: JERROD,
    kam: null,
    watchers: [JERROD],
    comments: [],
    hasAttachments: false,
    values: {
      ...BLANK,
      sapPartNumber: "601491",
      description: "PCB, DRIVER BOARD",
      drawingNumber: "601491",
      revLevel: "REV 4",
      supplierName: "ADVANCED CIRCUITS",
      fullDimensionalCheck: "Yes",
      visualAttributes: "Yes",
      functionalCheck: "Yes",
      meetsFirstPass: "Yes",
      turnOnReceivingInspection: "Yes",
      sqeSignOff: "Approved",
      sqeInitials: "jw",
      engSignOff: "Approved",
      engInitials: "js",
      sampleDisposition: "Purchased Sample",
    },
    createdAt: daysAgo(60),
    modifiedAt: daysAgo(40),
  },
  {
    id: 4,
    title: "",
    status: "FAIT Part Received",
    parentProject: { lookupId: 412, title: "" },
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: RAY,
    assignedEngineer: null,
    kam: null,
    watchers: [RAY],
    comments: [],
    hasAttachments: false,
    values: {
      ...BLANK,
      sapPartNumber: "691760",
      description: "HARNESS, DE-4000",
      drawingNumber: "691760",
      supplierName: "CABLE ASSEMBLIES INC",
      revisedProductionPart: "Yes",
      failedFirstPass: "Yes",
      failedFirstPassDate: daysAgo(5).toISOString(),
      failedReason: "Two conductors transposed at the connector.",
      failureResolved: "",
    },
    createdAt: daysAgo(21),
    modifiedAt: daysAgo(5),
  },
  {
    id: 5,
    title: "",
    // Fully signed off (SQE + Engineering + KAM, since one is assigned) but
    // NOT yet Closed — the one shape the other fixtures don't cover, needed
    // to test that checking Notify Initiator actually closes a FAIT once
    // it's genuinely done (Ray, 2026-09-03).
    status: "This is with KAM",
    parentProject: { lookupId: 501, title: "" },
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: SARAH,
    assignedEngineer: JERROD,
    kam: RAY,
    watchers: [SARAH, JERROD, RAY],
    comments: [],
    hasAttachments: false,
    values: {
      ...BLANK,
      sapPartNumber: "812204",
      description: "GASKET, HEAD COVER",
      drawingNumber: "812204",
      supplierName: "PRECISION SEALS LLC",
      fullDimensionalCheck: "Yes",
      meetsFirstPass: "Yes",
      // A KAM is genuinely owed here — OEM Impact must be Yes, or
      // kamNeeded() (lib/faitSignOff.ts) hides KAM regardless of the KAM
      // being assigned/approved below (Ray, 2026-09-03: no OEM impact hides
      // the KAM sign-off entirely).
      oemImpact: "Yes",
      sqeSignOff: "Approved",
      sqeInitials: "jw",
      engSignOff: "Approved",
      engInitials: "js",
      kamSignOff: "Approved",
      kamInitials: "rw",
    },
    createdAt: daysAgo(10),
    modifiedAt: daysAgo(1),
  },
  {
    id: 6,
    title: "",
    // NOT fully signed off — SQE Pending, and a KAM is assigned so one is
    // owed but hasn't signed. Exists so a test can rely on a FAIT that stays
    // un-closeable regardless of what other tests in the same file do to
    // FAITs 1-4 (the mock store is a shared module-level array with no
    // per-test reset, so an id used elsewhere for a "close this" test isn't
    // safe to reuse for "this must NOT be closeable").
    status: "This is with SQE",
    parentProject: { lookupId: 501, title: "" },
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: SARAH,
    assignedEngineer: JERROD,
    kam: RAY,
    watchers: [SARAH, JERROD, RAY],
    comments: [],
    hasAttachments: false,
    values: {
      ...BLANK,
      sapPartNumber: "915330",
      description: "BRACKET, MOUNTING",
      drawingNumber: "915330",
      supplierName: "MIDWEST STAMPING",
      fullDimensionalCheck: "Yes",
      // Consistent with "a KAM is assigned so one is owed" above — see the
      // note on fixture 5.
      oemImpact: "Yes",
      sqeSignOff: "Pending",
    },
    createdAt: daysAgo(6),
    modifiedAt: daysAgo(1),
  },
];
