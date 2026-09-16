// =============================================================================
// Cross-Functional ECN Checklist - Form# MFGFRM-038, Rev 0.
//
// The 84 checklist items as DATA, transcribed VERBATIM from the controlled
// workbook (MFGFRM-038_Rev 0.xlsx). Same descriptor pattern as
// `ecnFields.ts` / `grayMarketFields.ts` / `drawingLogFields.ts` - the
// template drives the UI, the progress maths and the stored answer shape.
//
// THE TEMPLATE LIVES HERE, NOT IN SHAREPOINT. Three of the workbook's four
// per-item columns never vary by ECN:
//
//   A  "On ECN"                      -> `onEcn`          (43 of 84)
//   B  "Review Steps"                -> `text`
//   D  "Requires a review w/depts"   -> `requiresReview` (26 of 84)
//
// Only column C ("Findings/Comments") and the Complete tick are the
// engineer's, and those two values are what a checklist row stores per item.
// Putting A/B/D in SharePoint would be 84 copies of the same constants on
// every one of 1,800+ ECNs.
//
// **`key` is the contract and must NEVER be reused or reassigned.** A stored
// answer references `s3-new-chemicals`, not row 25 - which is what lets a
// Rev 1 of this form add, reword or reorder items without orphaning answers
// already given. A stored key this template no longer declares is surfaced
// as a retired item rather than silently vanishing (see `ecnChecklist.ts`).
//
// The RACI matrix from the same workbook is deliberately NOT here - it is
// static reference material shown in a modal, and lives in
// `ecnChecklistRaci.ts`.
// =============================================================================

/** The revision of MFGFRM-038 these items were transcribed from. */
export const ECN_CHECKLIST_TEMPLATE_REVISION = "0";

export interface EcnChecklistSection {
  /** Section number as printed on the form (1-10). */
  number: number;
  /** Section title, as printed. */
  title: string;
}

export interface EcnChecklistItem {
  /** Stable identity. NEVER reuse or reassign - stored answers point at it. */
  key: string;
  /** Which section of the form it sits in. */
  section: number;
  /** The "Review Steps" text, verbatim from the form. */
  text: string;
  /** Column A - details MUST be on the ECN when true. */
  onEcn: boolean;
  /** Column D - needs a department review before the ECN is released. */
  requiresReview: boolean;
}

/** The ten sections of the form, in order. */
export const ECN_CHECKLIST_SECTIONS: EcnChecklistSection[] = [
  { number: 1, title: "ECN Header" },
  { number: 2, title: "Drawings or Parts Effected" },
  { number: 3, title: "Description of Change - On SharePoint" },
  { number: 4, title: "Reason For Change - On SharePoint" },
  { number: 5, title: "Requirements" },
  { number: 6, title: "Incorporate Into" },
  { number: 7, title: "Field Returns and Warranty - On SharePoint" },
  { number: 8, title: "In House Stock - On Sharepoint" },
  { number: 9, title: "Emergency ECN's, Drawing Markup Requirements, and Firmware Release Notes" },
  { number: 10, title: "Close Out ECN  (Not limited to items listed)" },
];

/** All 84 items, in form order. */
export const ECN_CHECKLIST_ITEMS: EcnChecklistItem[] = [
  // --- Section 1 - ECN Header
  {
    key: "s1-ensure-ecn-is-not",
    section: 1,
    text: "Ensure ECN is not duplicated",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s1-product-product-line-example",
    section: 1,
    text: "Product - Product line (example: ALT III, NGI-5000, etc) - On SharePoint as the title",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s1-final-assembly-part-numbers",
    section: 1,
    text: "Final assembly part numbers - include full part numbers with dashes - On SharePoint",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s1-date-initiated",
    section: 1,
    text: "Date Initiated",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s1-approved",
    section: 1,
    text: "Approved",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s1-originated-by",
    section: 1,
    text: "Originated By",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s1-priority-i-2-days",
    section: 1,
    text: "Priority - I =2 days, II = 10 days, III = 30 days, IV = 60 days (guidance from EWI-014)",
    onEcn: true,
    requiresReview: false,
  },

  // --- Section 2 - Drawings or Parts Effected
  {
    key: "s2-drawings-affected-current-revision",
    section: 2,
    text: "Drawings affected, current revision, and date - firmware/software changes must include the final assembly",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s2-list-new-drawings-along",
    section: 2,
    text: "List new drawings along with changed drawings",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s2-list-schematic-on-ecn",
    section: 2,
    text: "List schematic on ECN for all bom changes and new PCB revisions ",
    onEcn: true,
    requiresReview: false,
  },

  // --- Section 3 - Description of Change - On SharePoint
  {
    key: "s3-list-designators-quantities-changing",
    section: 3,
    text: "List designators, quantities changing, and part numbers for all components being adjusted on each drawing / schematic ",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s3-removing-boms-of-products",
    section: 3,
    text: "Removing boms of products that are changed from make to buy - or adding boms for buy to make",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s3-detailed-name-and-or",
    section: 3,
    text: "Detailed name and / or part number of Firmware / Terminal Program / Software changes",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s3-software-firmware-impacted-with",
    section: 3,
    text: "Software/Firmware impacted with a technical summary of changes for testing and flashing procedure impacts.",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s3-list-dimensional-text-color",
    section: 3,
    text: "List dimensional, text, color, coating, machining, testing, views, note changes, or any other guidance needed",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s3-list-pcb-changes",
    section: 3,
    text: "List PCB changes",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s3-new-chemicals-include-msds",
    section: 3,
    text: "New Chemicals - include MSDS with ECN and note to update the books on the floor",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s3-review-whether-a-part",
    section: 3,
    text: "Review whether a part being removed from a bom is single use & how to proceed if so in the \"In House Stock\" section",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-inform-sap-analyst-of",
    section: 3,
    text: "Inform SAP Analyst of correct status and procurement type (phase out, obsolescence, make to buy, buy to make, etc.)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-blocking-mpn-s-of",
    section: 3,
    text: "Blocking MPN's of that are no longer available in the market (obsolete), no longer used in a design due to buy-to-make change, not usable in design due to some characteristic of mfg pn, etc.",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-obsolescence-of-a-product",
    section: 3,
    text: "Obsolescence of a product, material, or manufacturer's part number (possible kick off SCN process) Example is ACM-4000; new drawings added but no direction on fate of legacy product.  Had to reach out to Sales and Engineering so we all knew what to do.",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-safety-stock-adjustments-to",
    section: 3,
    text: "Safety Stock adjustments to E and F parts (including make to buy, buy to make)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-material-group-affected-make",
    section: 3,
    text: "Material Group affected? (make to buy, buy to make, new process, etc.)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-rounding-values-lot-sizes",
    section: 3,
    text: "Rounding values, lot sizes, and costing lot size adjustments",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-impacts-in-compliance-and",
    section: 3,
    text: "Impacts in Compliance and/or compliance work instructions - Consult with compliance",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-hts-affected-consult-with",
    section: 3,
    text: "HTS affected?- Consult with compliance",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-eccn-affected-consult-with",
    section: 3,
    text: "ECCN affected? - Consult with Compliance",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-weight-affected-consult-with",
    section: 3,
    text: "Weight affected?- Consult with compliance",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-country-of-origin-affected",
    section: 3,
    text: "Country of Origin affected? - Consult with compliance",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-product-packaging-affected-consult",
    section: 3,
    text: "Product packaging affected? - Consult with logistics",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-are-there-any-notifications",
    section: 3,
    text: "Are there any notifications need  manufacturing engineering needs to be consulted with if a build request was not done; adjustments that may be needed for AOI, In circuit, and intermediate/end of line testers (parts moving, changing, electrical changes, etc.)",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-adjustments-to-manufacturing-quality",
    section: 3,
    text: "Adjustments to manufacturing, quality work instructions, QC forms, and general posted instructions",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-new-jigs-or-tooling",
    section: 3,
    text: "New jigs or tooling required due to form/fit changes?",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-does-the-description-in",
    section: 3,
    text: "Does the description in SAP need updated due to the change?",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-does-the-csa-file",
    section: 3,
    text: "Does the CSA file need updated? Consult with VP Engineering",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-price-control-make-to",
    section: 3,
    text: "Price control, make to buy, buy to make - controlled by accounting.  BOM updates costed.  Accounting will need ECN distribution -- NEW, is not happening on all ECN's",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s3-source-files-impacts-pic",
    section: 3,
    text: "Source Files impacts (Pic'n'place, In-circuit, .stp files, .ai [label image files], etc.) Engineering should be providing clean new revisions and MFG engineering not just strictly completing updates to the program.",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s3-impact-to-receiving-and",
    section: 3,
    text: "Impact to receiving and inspection plans purchased and outside processes",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s3-check-if-sil-products",
    section: 3,
    text: "Check if SIL products are affected.  Currently EX4000 D&A, eSuppressor SCB and EBB boards; however, components may be shared with other products so SIL must be considered if the part is used on one of these devices.",
    onEcn: false,
    requiresReview: false,
  },

  // --- Section 4 - Reason For Change - On SharePoint
  {
    key: "s4-detailed-reason-for-change",
    section: 4,
    text: "Detailed reason for change which includes why it changed and what drove the change (customer, obsolescence, design change, design deficiency, drawing error, improvement, etc.)",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s4-defined-location-on-ecn",
    section: 4,
    text: "Defined location on ECN for EIR / ECR / Task#",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s4-impacts-for-customer-s",
    section: 4,
    text: "Impacts for customer/s - OEM products may require notification - Keith uses the \"Reason for Change\" so details need to be specific.  Checkbox by Sales to determine if customer needs to be notified.  Check with Sales prior to release of ECN and use checkbox in the \"Incorporate Into\" section, if required by Sales.",
    onEcn: true,
    requiresReview: true,
  },

  // --- Section 5 - Requirements
  {
    key: "s5-list-drawings-that-need",
    section: 5,
    text: "List drawings that need bom updates",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s5-if-a-drawing-is",
    section: 5,
    text: "If a drawing is added or removed from an assembly - update drawing tree",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s5-do-new-components-require",
    section: 5,
    text: "Do new components require different handling or cleaning processes?",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s5-changes-that-affect-the",
    section: 5,
    text: "Changes that affect the amount of a chemical, battery, and/or magnet (Environmentally Flagged Materials) that is used in the process considering the expiration date and quantity in stock (EMPFRM-001)",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s5-she-process-information-changes",
    section: 5,
    text: "SHE process information changes (PPE, chemicals, waste, etc.) -> EMPFRM-001 and PPE Evaluation Form",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s5-new-firmware-feature-or",
    section: 5,
    text: "New Firmware Feature or Bug Addressment for Software/Firmware",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s5-product-certification-compliance-impact",
    section: 5,
    text: "Product Certification Compliance Impact (CSA, IECEx, Marine, ATEX, etc.)",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s5-drafting-updates-required",
    section: 5,
    text: "Drafting Updates Required",
    onEcn: true,
    requiresReview: false,
  },

  // --- Section 6 - Incorporate Into
  {
    key: "s6-new-pcb-revision-starting",
    section: 6,
    text: "New PCB Revision starting Revision #",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s6-serial-number-management-multiple",
    section: 6,
    text: "Serial Number management - multiple products, variations, timelines, etc. - assuring that the product is actually serialized.  Further, for label changes, a special process needs implemented (discuss in meeting). OEM products with OEM part number as the \"old PN\". A discussion with manufacturing on a process they kick off prior to release of ECN. - On SharePoint",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s6-impacts-to-altronic-documentation",
    section: 6,
    text: "Impacts to Altronic documentation, firmware on website, price list, bulletin requirement, etc.  Must be consulted with Commercial team prior to ECN release.",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s6-any-change-in-appearance",
    section: 6,
    text: "Any change in appearance of labels, paint, etc. not necessarily function. Commercial team must be notified and consulted prior to changes to manage customers.",
    onEcn: false,
    requiresReview: true,
  },
  {
    key: "s6-in-house-stock-affected",
    section: 6,
    text: "In House Stock affected - Panels included",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s6-field-returns-affected",
    section: 6,
    text: "Field Returns affected",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s6-if-a-change-is",
    section: 6,
    text: "If a change is only for a series of serial numbers (x serial number to x serial number)",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s6-current-pcb-s-revisions",
    section: 6,
    text: "Current PCB's revisions",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s6-future-material-purchases",
    section: 6,
    text: "Future Material purchases",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s6-notify-customer",
    section: 6,
    text: "Notify Customer",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s6-export-compliance-review-completed",
    section: 6,
    text: "Export Compliance Review Completed",
    onEcn: true,
    requiresReview: true,
  },

  // --- Section 7 - Field Returns and Warranty - On SharePoint
  {
    key: "s7-detailed-instructions-for-affected",
    section: 7,
    text: "Detailed instructions for affected field returns and repairs",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s7-no-action-modify-existing",
    section: 7,
    text: "No action, modify existing product, exchange board, update software and any special information",
    onEcn: true,
    requiresReview: false,
  },

  // --- Section 8 - In House Stock - On Sharepoint
  {
    key: "s8-detailed-instructions-for-affected",
    section: 8,
    text: "Detailed instructions for affected in house inventory (components, sub-assemblies, final assemblies, in process, repair department, panel plant also needs notified if changes affect product in CP02) - Suggestion to have each department listed on the ECN form with n/a or action for inventory",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s8-no-action-modify-existing",
    section: 8,
    text: "No action, modify existing product, exchange board, update software and any special information",
    onEcn: true,
    requiresReview: false,
  },
  {
    key: "s8-stock-management-on-bom",
    section: 8,
    text: "Stock management on bom changes (use up, scrap, etc.). Obsolete part being used up on certain products being detailed in ECN (i.e. ECN 250035).  If there needs to have inventory management, this needs decided prior to release of the ECN.  Handled prior, reported on ECN.",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s8-timing-for-change-over",
    section: 8,
    text: "Timing for change over of changes -  per product if necessary - multiple changes may require multiple ECN's to track the serial number of each change (discuss in meeting) --- IF A PART (LABEL, PCB, ETC) IS BEING CHANGED AND WE WANT NEW PARTS ORDERED, IT MUST BE ON THE ECN, OTHERWISE PURCHASING WILL NOT ORDER UNTIL MRP RUNS AND PRODUCTION ALSO NEEDS NOTIFIED IF THEY SHOULD SAVE SOME PARTS, IN ISOLATION, TO USE UNTIL NEW PRODUCT IS DELIVERED. If there needs to be inventory management, this needs decided prior to release of the ECN.  Handled prior, reported on ECN. MRP won't drive new parts (or new revision) until stock falls below SS.  If I want to drive a new item, consult with purchasing.",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s8-impacts-of-make-to",
    section: 8,
    text: "Impacts of make to buy, or buy to make for previous bom/purchasing data (Connector example:  Make to buy, what happens to material remaining on make part if not used elsewhere - scrap, keep in stock, etc.) list in \"In House Stock\" section.",
    onEcn: false,
    requiresReview: false,
  },

  // --- Section 9 - Emergency ECN's, Drawing Markup Requirements, and Firmware Release Notes
  {
    key: "s9-for-emergency-changes-that",
    section: 9,
    text: "For emergency changes that need to happen before a drawing can be revised according to the priority level on the ECN; a red line is issued electronically on SharePoint, and on paper for production use, with the date of expiration listed on the ECN (define responsibility on who manages issuing new redlines, if required).  This is required for purchased or make parts, alike.  This could be included in the drawings section as a column for the expiration date.",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s9-red-lines-digital-or",
    section: 9,
    text: "Red-lines Digital or Paper (File Location or pages or attached to ECN Task in Engineering Database) for all ECN's",
    onEcn: true,
    requiresReview: true,
  },
  {
    key: "s9-copy-of-firmware-release",
    section: 9,
    text: "Copy of Firmware Release Notes associated with the release attached to ECN for Software/Firmware",
    onEcn: true,
    requiresReview: true,
  },

  // --- Section 10 - Close Out ECN  (Not limited to items listed)
  {
    key: "s10-confirm-that-the-information",
    section: 10,
    text: "Confirm that the information on the ECN effectively replaces the drawing/s until the time the drawings can be revised (refererence QMP-4.3, section 4.5)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-engineering-has-completed",
    section: 10,
    text: "Confirm Engineering has completed drawings & distribution completed in time period indicated on priority",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-engineering-sap-tasks",
    section: 10,
    text: "Confirm Engineering SAP tasks are completed (descriptions / E&F / status / MPN's / weight / boms / drawings",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-serial-numbers-returned",
    section: 10,
    text: "Confirm Serial Numbers returned to Engineering",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-production-tasks-completed",
    section: 10,
    text: "Confirm production tasks completed (machine / process / handling / tester / firmware / floor stock / work instructions / tooling / jigs / in- house stock / serial numbers returned to Engineering / rounding values / lot sizes / safety stock)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-logistics-tasks-completed",
    section: 10,
    text: "Confirm Logistics tasks completed (handling / packaging / work instructions / stock movements)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-purchasing-tasks-completed",
    section: 10,
    text: "Confirm Purchasing tasks completed (buying new parts / receiving & inspection plans / material group / rounding values / safety stock)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-sales-tasks-customer",
    section: 10,
    text: "Confirm Sales tasks (customer notifications / web site / price list / documentation)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-compliance-tasks-htsus",
    section: 10,
    text: "Confirm Compliance tasks (HTSUS / weight / country of origin / ECCN)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-she-tasks-complete",
    section: 10,
    text: "Confirm SHE tasks complete (MSDS / procedures / handling / stock age)",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-kick-off-scn",
    section: 10,
    text: "Confirm kick-off SCN process for obsolete assemblies or components",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-csa-update-in",
    section: 10,
    text: "Confirm CSA update in process, if required",
    onEcn: false,
    requiresReview: false,
  },
  {
    key: "s10-confirm-that-panel-plant",
    section: 10,
    text: "Confirm that panel plant has updated inventory ",
    onEcn: false,
    requiresReview: false,
  },
];

/** Every item in one section, in form order. */
export function itemsInSection(section: number): EcnChecklistItem[] {
  return ECN_CHECKLIST_ITEMS.filter((i) => i.section === section);
}

/** The item a stored answer key refers to, or null if the template dropped it. */
export function itemByKey(key: string): EcnChecklistItem | null {
  return ECN_CHECKLIST_ITEMS.find((i) => i.key === key) ?? null;
}
