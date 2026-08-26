import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PMO_SITE_URL, SP_SUPPLIER_ISSUES_LIST_ID, USE_MOCK } from "./config";
import { ensureLookupIds } from "./siteUsers";
import type { GraphListItem, Person, SupplierIssue, SupplierIssueInput } from "@/types/task";
import {
  buildSupplierIssueCreateFields,
  compareSupplierIssues,
  supplierIssueFieldPatch,
  toSupplierIssue,
} from "@/lib/supplierIssueMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { MOCK_SUPPLIER_ISSUES } from "@/data/srmMockData";

// =============================================================================
// "Supplier Issue Tracker" — one row per quality/delivery issue against a
// supplier, on the PMO site. Near-empty (1 row at discovery); fetched whole
// and scoped to one supplier client-side, same as Supplier Contacts.
//
// `Status` and `Severity` are UNCONFIGURED placeholder choices in the live
// list — see the note on the consts in types/task.ts.
//
// No delete — an issue is a record that something happened, closed by
// resolving it rather than removing it, the same call as Gray Market
// Requests and FAITs. `supplierIssues.test.ts` asserts the module exports
// nothing matching /delete|remove/.
// =============================================================================

let mockStore: SupplierIssue[] = MOCK_SUPPLIER_ISSUES.map((i) => ({ ...i }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_SUPPLIER_ISSUES_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_SUPPLIER_ISSUES_LIST_ID is not set.`);
  }
  return SP_SUPPLIER_ISSUES_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.pmo}/lists/${requireListId("reach the issue")}/items/${id}`;
}

const SELECT =
  "Title,BPReference,Description,Status,Resolution,Severity,Communication,Watchers,Attachments,Created,Modified";

export async function listSupplierIssues(): Promise<SupplierIssue[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareSupplierIssues).map((i) => ({ ...i })));
  }
  const listId = requireListId("load supplier issues");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items?$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toSupplierIssue).sort(compareSupplierIssues);
}

export async function createSupplierIssue(input: SupplierIssueInput): Promise<SupplierIssue> {
  const watchers = await ensureLookupIds(SP_PMO_SITE_URL, input.watchers);

  if (USE_MOCK) {
    const now = new Date();
    const issue: SupplierIssue = {
      id: Math.max(0, ...mockStore.map((i) => i.id)) + 1,
      title: input.title.trim(),
      supplierId: input.supplierId,
      description: input.description.trim(),
      status: input.status,
      resolution: "",
      severity: input.severity,
      comments: [],
      watchers,
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [issue, ...mockStore];
    return delay(issue);
  }
  const listId = requireListId("create the issue");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildSupplierIssueCreateFields(input, { watchers }) }) },
  );
  const item = await graphFetch<GraphListItem>(`${itemPath(parseInt(created.id, 10))}?$expand=fields($select=${SELECT})`);
  return toSupplierIssue(item);
}

export async function updateSupplierIssueFields(
  id: number,
  changed: Parameters<typeof supplierIssueFieldPatch>[0],
): Promise<SupplierIssue> {
  return updateFields(id, supplierIssueFieldPatch(changed));
}

export async function setSupplierIssueWatchers(id: number, people: Person[]): Promise<SupplierIssue> {
  if (USE_MOCK) {
    return updateFields(id, { Watchers: people });
  }
  const ensured = await ensureLookupIds(SP_PMO_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateFields(id, multiPersonField("Watchers", ensured));
}

async function updateFields(id: number, fields: Record<string, unknown>): Promise<SupplierIssue> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`Issue ${id} not found`);
    const next: SupplierIssue = { ...mockStore[idx], modifiedAt: new Date() };
    applyMockFields(next, fields);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const item = await graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${SELECT})`);
  return toSupplierIssue(item);
}

function applyMockFields(next: SupplierIssue, fields: Record<string, unknown>) {
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("Description" in fields) next.description = String(fields.Description ?? "");
  if ("Status" in fields) next.status = (fields.Status as SupplierIssue["status"]) ?? null;
  if ("Severity" in fields) next.severity = (fields.Severity as SupplierIssue["severity"]) ?? null;
  if ("Resolution" in fields) next.resolution = String(fields.Resolution ?? "");
  if (Array.isArray(fields.Watchers)) {
    next.watchers = fields.Watchers as Person[];
  } else {
    const watcherIds = fields["WatchersLookupId"];
    if (Array.isArray(watcherIds)) {
      next.watchers = watcherIds.map((lookupId: number) => ({ displayName: "", lookupId }));
    }
  }
}

export async function addSupplierIssueComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<SupplierIssue> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`Issue ${id} not found`);
    const next: SupplierIssue = {
      ...mockStore[idx],
      comments: [
        { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
        ...mockStore[idx].comments,
      ],
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateFields(id, { Communication: appendComment(existingRaw, comment) });
}

export async function editSupplierIssueComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<SupplierIssue> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`Issue ${id} not found`);
    const next: SupplierIssue = {
      ...mockStore[idx],
      comments: mockStore[idx].comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateFields(id, { Communication: replaceComment(existingRaw, target, newBodyHtml) });
}
