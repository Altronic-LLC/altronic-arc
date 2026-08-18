import type { GraphListItem, VisitReport, VisitReportInput } from "@/types/task";
import { VISIT_RM_NAMES } from "@/types/task";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";

// =============================================================================
// Graph item → VisitReport, and back.
//
// Field names come from the live list (scripts/visit-reports-schema.json,
// 2026-08-18). Two of them are not what you would guess:
//
//   Title  → Customer Name   (the list repurposes Title, as CSA Listings does)
//   City0  → City            (…and State0 → State: the trailing zero is real)
//
// Month / Year / Day / Cal Title are CALCULATED columns. They're read-only and
// derived from Visit Date, so this module ignores them on read and never sends
// them on write — anything the UI needs (the year filter, the row's month) is
// computed from `visitDate` instead. Writing one is a 400.
// =============================================================================

/** Columns worth fetching — the calculated and system ones are left out. */
export const VISIT_REPORT_SELECT =
  "Title,RMName,ReasonForVisit,VisitSummary,ActionItems,VisitDate," +
  "CustomerStatus,Product,City0,State0,Attachments,Created,Modified";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function toVisitReport(item: GraphListItem): VisitReport {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    customerName: text(f.Title),
    rmName: text(f.RMName),
    reasonForVisit: text(f.ReasonForVisit),
    visitSummary: typeof f.VisitSummary === "string" ? f.VisitSummary : "",
    actionItems: typeof f.ActionItems === "string" ? f.ActionItems : "",
    // Date-only, and most rows were written by SharePoint at local
    // midnight (22:00Z) — parseSpDateOnly snaps to the day the list
    // view shows. See lib/spDates.ts.
    visitDate: parseSpDateOnly(f.VisitDate),
    customerStatus: text(f.CustomerStatus),
    product: text(f.Product),
    city: text(f.City0),
    state: text(f.State0),
    hasAttachments: f.Attachments === true,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** A stored report back as form input — for editing, and for diffing writes. */
export function visitReportInput(report: VisitReport): VisitReportInput {
  return {
    customerName: report.customerName,
    rmName: report.rmName,
    reasonForVisit: report.reasonForVisit,
    visitSummary: report.visitSummary,
    actionItems: report.actionItems,
    visitDate: report.visitDate,
    customerStatus: report.customerStatus,
    product: report.product,
    city: report.city,
    state: report.state,
  };
}

/**
 * Domain input → SharePoint fields payload.
 *
 * Visit Date is written at midday UTC (`toSpDateOnly`), which lands on the
 * right day whichever side of UTC the site sits on. Reading is the asymmetric
 * half — see `parseSpDateOnly`.
 *
 * Pass `previous` on an EDIT and only the columns that actually changed are
 * sent. That isn't just tidiness: **RM Name, Customer Status, Reason and State
 * are choice columns whose stored data has drifted outside their choice
 * lists** — managers who have left, one manager spelled two ways. Re-sending
 * such a value would have SharePoint reject the whole PATCH with "value is not
 * a valid choice", so correcting a typo on a 2022 report would fail for a
 * reason that has nothing to do with the typo. Untouched columns are simply
 * not mentioned, and keep whatever they hold.
 */
export function buildVisitReportFields(
  input: VisitReportInput,
  previous?: VisitReport,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.customerName.trim(),
    RMName: input.rmName,
    ReasonForVisit: input.reasonForVisit,
    VisitSummary: input.visitSummary.trim(),
    ActionItems: input.actionItems.trim(),
    VisitDate: toSpDateOnly(input.visitDate),
    CustomerStatus: input.customerStatus,
    Product: input.product.trim(),
    City0: input.city.trim(),
    State0: input.state,
  };
  if (!previous) return fields;

  const before = buildVisitReportFields(visitReportInput(previous));
  for (const key of Object.keys(fields)) {
    if (fields[key] === before[key]) delete fields[key];
  }
  return fields;
}

/** Newest visit first; undated reports sink to the bottom. */
export function compareVisitReports(a: VisitReport, b: VisitReport): number {
  const at = a.visitDate?.getTime() ?? -Infinity;
  const bt = b.visitDate?.getTime() ?? -Infinity;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

/** The visit's year, as the calculated `Year` column would give it. */
export function visitYear(report: VisitReport): string {
  return report.visitDate ? String(report.visitDate.getUTCFullYear()) : "";
}

/**
 * Regional managers to OFFER in a picker: the column's current choices plus
 * anyone the data already holds.
 *
 * The two lists disagree, and will keep disagreeing — reports go back to 2022,
 * managers leave, and one person is stored under two spellings ("Paul McHenry"
 * and "Paul Mchenry"). Offering only the column's choices would make an old
 * report un-editable without silently reassigning it to someone else, and
 * filtering on choices alone would hide reports that plainly exist.
 */
export function rmNameOptions(reports: VisitReport[]): string[] {
  const seen = new Map<string, string>();
  for (const name of VISIT_RM_NAMES) seen.set(name.toLowerCase(), name);
  for (const report of reports) {
    const name = report.rmName.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Distinct years present in the data, newest first — drives the year filter. */
export function visitYearOptions(reports: VisitReport[]): string[] {
  const years = new Set<string>();
  for (const report of reports) {
    const year = visitYear(report);
    if (year) years.add(year);
  }
  return [...years].sort((a, b) => b.localeCompare(a));
}
