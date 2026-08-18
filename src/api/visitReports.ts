import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_VISIT_REPORTS_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, VisitReport, VisitReportInput } from "@/types/task";
import {
  buildVisitReportFields,
  compareVisitReports,
  toVisitReport,
  VISIT_REPORT_SELECT,
} from "@/lib/visitReportMapper";
import { MOCK_VISIT_REPORTS } from "@/data/visitReportMockData";

// =============================================================================
// Visit Reports API — Customer Service / Sales, on the ALTRONICSALESTEAM site.
//
// A regional manager's record of a customer visit: who they saw, why, what
// happened, and what needs doing next.
//
// **There is no delete.** Not hidden in the UI — absent from this module, so a
// future screen or bulk action can't quietly acquire one (Ray, 2026-08-18). A
// visit report is a record of something that happened; correcting one is an
// edit, and removing one is a deliberate trip to SharePoint.
//
// Volume: ~1,000 rows and growing by a handful a week. That's comfortably
// under SharePoint's 5,000-item list-view threshold, so the whole list is
// fetched (paged by graphFetchAll) and filtered in the browser — no
// server-side filter to be refused, unlike the Teradyne log. Revisit if this
// ever approaches 5,000: the shape to copy is `listTeradyneLog`'s year scope,
// and `VisitDate` would need indexing first.
// =============================================================================

let mockStore: VisitReport[] = MOCK_VISIT_REPORTS.map((r) => ({ ...r }));

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_VISIT_REPORTS_LIST_ID) {
    throw new Error(
      `Cannot ${action}: VITE_SP_VISIT_REPORTS_LIST_ID is not set.`,
    );
  }
  return SP_VISIT_REPORTS_LIST_ID;
}

/** Every visit report, newest visit first. */
export async function listVisitReports(): Promise<VisitReport[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareVisitReports).map((r) => ({ ...r })));
  }

  const listId = requireListId("load visit reports");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.salesTeam}/lists/${listId}/items` +
      `?$expand=fields($select=${VISIT_REPORT_SELECT})&$top=999`,
  );
  return items.map(toVisitReport).sort(compareVisitReports);
}

/** One visit report by id, or null when it isn't there. */
export async function getVisitReport(id: number): Promise<VisitReport | null> {
  if (USE_MOCK) {
    const found = mockStore.find((r) => r.id === id);
    return delay(found ? { ...found } : null);
  }

  const listId = requireListId("load the visit report");
  try {
    const item = await graphFetch<GraphListItem>(
      `/sites/${SITES.salesTeam}/lists/${listId}/items/${id}` +
        `?$expand=fields($select=${VISIT_REPORT_SELECT})`,
    );
    return toVisitReport(item);
  } catch {
    return null;
  }
}

export async function createVisitReport(
  input: VisitReportInput,
): Promise<VisitReport> {
  if (USE_MOCK) {
    const now = new Date();
    const report: VisitReport = {
      id: Math.max(0, ...mockStore.map((r) => r.id)) + 1,
      customerName: input.customerName.trim(),
      rmName: input.rmName,
      reasonForVisit: input.reasonForVisit,
      visitSummary: input.visitSummary.trim(),
      actionItems: input.actionItems.trim(),
      visitDate: input.visitDate,
      customerStatus: input.customerStatus,
      product: input.product.trim(),
      city: input.city.trim(),
      state: input.state,
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [report, ...mockStore];
    return delay(report);
  }

  const listId = requireListId("create the visit report");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.salesTeam}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildVisitReportFields(input) }) },
  );
  // The create response doesn't expand the fields we selected, so read the row
  // back — the list and detail views both render from the returned object.
  return (await getVisitReport(parseInt(created.id, 10))) ?? toVisitReport(created);
}

/**
 * Patch one or more columns on a visit report.
 *
 * Takes SharePoint field names (not domain names) so the detail view's inline
 * editors can write a single column each, the same way the task and EIR detail
 * views do.
 */
export async function updateVisitReportFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<VisitReport> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`Visit report ${id} not found`);
    const next: VisitReport = { ...mockStore[idx], modifiedAt: new Date() };
    if ("Title" in fields) next.customerName = String(fields.Title ?? "");
    if ("RMName" in fields) next.rmName = String(fields.RMName ?? "");
    if ("ReasonForVisit" in fields) next.reasonForVisit = String(fields.ReasonForVisit ?? "");
    if ("VisitSummary" in fields) next.visitSummary = String(fields.VisitSummary ?? "");
    if ("ActionItems" in fields) next.actionItems = String(fields.ActionItems ?? "");
    if ("CustomerStatus" in fields) next.customerStatus = String(fields.CustomerStatus ?? "");
    if ("Product" in fields) next.product = String(fields.Product ?? "");
    if ("City0" in fields) next.city = String(fields.City0 ?? "");
    if ("State0" in fields) next.state = String(fields.State0 ?? "");
    if ("VisitDate" in fields) {
      const raw = fields.VisitDate;
      next.visitDate = raw ? new Date(String(raw)) : null;
    }
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(next);
  }

  const listId = requireListId("save the visit report");
  await graphFetch(
    `/sites/${SITES.salesTeam}/lists/${listId}/items/${id}/fields`,
    { method: "PATCH", body: JSON.stringify(fields) },
  );
  const updated = await getVisitReport(id);
  if (!updated) throw new Error(`Visit report ${id} disappeared after update`);
  return updated;
}

/**
 * Save the edit form.
 *
 * `previous` is the report as it was, so only the columns the user actually
 * changed are sent — see buildVisitReportFields for why that matters on this
 * list's choice columns. With nothing changed there is nothing to write.
 */
export async function updateVisitReport(
  id: number,
  input: VisitReportInput,
  previous?: VisitReport,
): Promise<VisitReport> {
  const fields = buildVisitReportFields(input, previous);
  if (Object.keys(fields).length === 0) {
    const unchanged = await getVisitReport(id);
    if (!unchanged) throw new Error(`Visit report ${id} not found`);
    return unchanged;
  }
  return updateVisitReportFields(id, fields);
}
