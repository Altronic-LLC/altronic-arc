import type { VisitReport } from "@/types/task";

// =============================================================================
// Sample visit reports for mock mode.
//
// Shaped after the real data (scripts/visit-reports-schema.json): a customer
// name in Title, one of the RM Name choices, a date-only visit date, and the
// summary/action-items pair that carries most of the content.
//
// Two of these are deliberate awkward cases, because the live list has both:
//   - a report by a regional manager who is NOT in the column's current choice
//     list (people leave; the reports stay), and
//   - one with no city/state and no action items, since only Customer Name,
//     RM Name, Reason, Summary, Visit Date and Status are required.
// =============================================================================

/**
 * A visit date as the app holds it: midday UTC, whatever time-of-day the row
 * was stored with. `parseSpDateOnly` normalises the real list's 22:00Z rows to
 * this same shape on read — see lib/spDates.ts.
 */
function visitDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export const MOCK_VISIT_REPORTS: VisitReport[] = [
  {
    id: 1,
    customerName: "CSI Compressco",
    rmName: "Curtis Ward",
    reasonForVisit: "Site Visit",
    visitSummary:
      "Walked the Midland yard with their maintenance lead. Two DE-4000 panels " +
      "are in service and running clean; a third is waiting on a wiring harness. " +
      "They asked about upgrading the older CPU-XL units next year.",
    actionItems: "Send DE-4000 install manual and quote the harness.",
    visitDate: visitDate("2026-08-11"),
    customerStatus: "Satisfied",
    product: "DE-4000, CPU-XL",
    city: "Midland",
    state: "Texas",
    hasAttachments: true,
    createdAt: new Date("2026-08-11T18:04:00Z"),
    modifiedAt: new Date("2026-08-12T13:22:00Z"),
  },
  {
    id: 2,
    customerName: "AGES Energy Services",
    rmName: "Wes Wagner",
    reasonForVisit: "Sales Call",
    visitSummary:
      "First meeting with their new operations manager. They run 14 units across " +
      "three sites and are unhappy with the current ignition supplier's lead times.",
    actionItems:
      "Pricing for 14 CPU95 retrofits by the 20th.\nIntroduce them to Dave for the service agreement.",
    visitDate: visitDate("2026-08-04"),
    customerStatus: "Quote Request",
    product: "CPU95",
    city: "Oklahoma City",
    state: "Oklahoma",
    hasAttachments: false,
    createdAt: new Date("2026-08-04T22:10:00Z"),
    modifiedAt: new Date("2026-08-04T22:10:00Z"),
  },
  {
    id: 3,
    customerName: "Bluestem Midstream",
    rmName: "Chad Tucker",
    reasonForVisit: "General Visit",
    visitSummary:
      "Follow-up on the annunciator faults reported in June. Root cause was a " +
      "loose ground on the panel, fixed on site. Customer wants training for two " +
      "new technicians.",
    actionItems: "Book a training day in September.",
    visitDate: visitDate("2026-07-29"),
    customerStatus: "Needs Attention",
    product: "Annunciators",
    city: "Wichita",
    state: "Kansas",
    hasAttachments: false,
    createdAt: new Date("2026-07-29T20:41:00Z"),
    modifiedAt: new Date("2026-07-30T14:05:00Z"),
  },
  {
    id: 4,
    customerName: "Permian Gathering Co.",
    rmName: "Gregg Grubbs",
    reasonForVisit: "Training",
    visitSummary:
      "Half-day EPC-10X training for six technicians. Good session. They raised a " +
      "recurring nuisance shutdown on unit 4 that we could not reproduce.",
    actionItems: "",
    visitDate: visitDate("2026-07-15"),
    customerStatus: "Issue",
    product: "EPC-10X",
    city: "",
    state: "",
    hasAttachments: false,
    createdAt: new Date("2026-07-15T23:02:00Z"),
    modifiedAt: new Date("2026-07-15T23:02:00Z"),
  },
  {
    id: 5,
    customerName: "Northern Plains Compression",
    // Not in the column's current choice list — he left in 2024, the report
    // stayed. The picker folds him in rather than blanking the field.
    rmName: "Neal Keeton",
    reasonForVisit: "Home Office",
    visitSummary:
      "Phone review of the 2024 spares order. Nothing outstanding; they are happy " +
      "with delivery times since the Q2 change.",
    actionItems: "",
    visitDate: visitDate("2024-11-06"),
    customerStatus: "N/A",
    product: "",
    city: "Bismarck",
    state: "North Dakota",
    hasAttachments: false,
    createdAt: new Date("2024-11-06T19:15:00Z"),
    modifiedAt: new Date("2024-11-06T19:15:00Z"),
  },
  {
    id: 6,
    customerName: "Gulf Coast Pipeline Partners",
    rmName: "Michael Young",
    reasonForVisit: "Sales Call",
    visitSummary:
      "Introductory visit at their Houston office. They are specifying controls " +
      "for two new stations and asked for a comparison against their incumbent.",
    actionItems: "Send the comparison sheet and follow up in two weeks.",
    visitDate: visitDate("2026-06-18"),
    customerStatus: "Potential New Customer",
    product: "DE-4000",
    city: "Houston",
    state: "Texas",
    hasAttachments: true,
    createdAt: new Date("2026-06-18T21:30:00Z"),
    modifiedAt: new Date("2026-06-19T15:47:00Z"),
  },
];
