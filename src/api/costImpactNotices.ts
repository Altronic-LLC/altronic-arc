import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_COST_IMPACT_NOTICES_LIST_ID, USE_MOCK } from "./config";
import type { CostImpactNotice, CostImpactNoticeInput, GraphListItem } from "@/types/task";
import {
  buildCostImpactNoticeCreateFields,
  compareCostImpactNotices,
  toCostImpactNotice,
} from "@/lib/costImpactNoticeMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { toStoredRichText } from "@/lib/richText";
import { MOCK_COST_IMPACT_NOTICES } from "@/data/costImpactMockData";

// =============================================================================
// "Cost Impact Portal" — Supply Chain's notice that a purchased part's cost
// has changed, on the ALTRONICSALESTEAM site (SITES.salesTeam).
//
// No delete: a notice is a record that a cost changed and who was told about
// it — a superseded one is a new notice, not a correction to the old one,
// the same call as ECNs and Gray Market Requests. `costImpactNotices.test.ts`
// asserts this module exports nothing matching /delete|remove/.
//
// 31 rows at discovery, so the list is fetched whole and filtered/sorted in
// the browser, same as ECNs and Supplier lists at this size.
// =============================================================================

let mockStore: CostImpactNotice[] = MOCK_COST_IMPACT_NOTICES.map((n) => ({ ...n }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_COST_IMPACT_NOTICES_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_COST_IMPACT_NOTICES_LIST_ID is not set.`);
  }
  return SP_COST_IMPACT_NOTICES_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.salesTeam}/lists/${requireListId("reach the cost impact notice")}/items/${id}`;
}

/** Item-level properties worth carrying — `createdBy` is the submitter, same as ECNs. */
const ITEM_SELECT = "id,createdBy,createdDateTime,lastModifiedDateTime";

const SELECT =
  "Title,Supplier,SAPNumber,OldPartNumber,MPN,OriginalCost,NewCost,Delta_x0020_Cost," +
  "TimeofImpact,Panels,WhereUsed,EAU,BPReference,Comments,Year_x0020_Issued," +
  "Communication,Attachments,Created,Modified";

export async function listCostImpactNotices(): Promise<CostImpactNotice[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareCostImpactNotices).map((n) => ({ ...n })));
  }
  const listId = requireListId("load cost impact notices");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.salesTeam}/lists/${listId}/items` +
      `?$select=${ITEM_SELECT}&$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toCostImpactNotice).sort(compareCostImpactNotices);
}

export async function getCostImpactNotice(id: number): Promise<CostImpactNotice | null> {
  if (USE_MOCK) {
    const found = mockStore.find((n) => n.id === id);
    return delay(found ? { ...found } : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(
      `${itemPath(id)}?$select=${ITEM_SELECT}&$expand=fields($select=${SELECT})`,
    );
    return toCostImpactNotice(item);
  } catch {
    return null;
  }
}

export async function createCostImpactNotice(
  input: CostImpactNoticeInput,
  actor?: { displayName: string; email?: string },
): Promise<CostImpactNotice> {
  if (USE_MOCK) {
    const now = new Date();
    const notice: CostImpactNotice = {
      id: Math.max(0, ...mockStore.map((n) => n.id)) + 1,
      title: input.title.trim(),
      supplier: input.supplier.trim(),
      sapNumber: input.sapNumber.trim(),
      oldPartNumber: input.oldPartNumber.trim(),
      mpn: input.mpn.trim(),
      originalCost: input.originalCost.trim(),
      newCost: input.newCost.trim(),
      deltaCost: deltaOf(input.originalCost, input.newCost),
      timeOfImpact: input.timeOfImpact,
      usedOnPanels: input.usedOnPanels,
      whereUsed: input.whereUsed,
      eau: input.eau.trim(),
      bpReference: input.bpReference.trim(),
      notes: input.notes.trim(),
      yearIssued: String(now.getFullYear()),
      submittedBy: actor ? { displayName: actor.displayName, email: actor.email } : null,
      comments: [],
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [notice, ...mockStore];
    return delay(notice);
  }

  const listId = requireListId("raise the cost impact notice");
  const created = await graphFetch<GraphListItem>(`/sites/${SITES.salesTeam}/lists/${listId}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: buildCostImpactNoticeCreateFields(input) }),
  });
  return (await getCostImpactNotice(parseInt(created.id, 10))) ?? toCostImpactNotice(created);
}

/** Mock-only: mirror SharePoint's `=[New Cost]-[Original Cost]` calculated column. */
function deltaOf(originalCost: string, newCost: string): number | null {
  const original = parseFloat(originalCost);
  const next = parseFloat(newCost);
  return Number.isFinite(original) && Number.isFinite(next) ? next - original : null;
}

/**
 * Patch columns by their SharePoint names — the detail page's card Edit
 * modals each own a set of columns.
 */
export async function updateCostImpactNoticeFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<CostImpactNotice> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((n) => n.id === id);
    if (idx < 0) throw new Error(`Cost impact notice ${id} not found`);
    const next: CostImpactNotice = { ...mockStore[idx], modifiedAt: new Date() };
    applyMockFields(next, fields);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const updated = await getCostImpactNotice(id);
  if (!updated) throw new Error(`Cost impact notice ${id} disappeared after update`);
  return updated;
}

function applyMockFields(next: CostImpactNotice, fields: Record<string, unknown>) {
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("Supplier" in fields) next.supplier = String(fields.Supplier ?? "");
  if ("SAPNumber" in fields) next.sapNumber = String(fields.SAPNumber ?? "");
  if ("OldPartNumber" in fields) next.oldPartNumber = String(fields.OldPartNumber ?? "");
  if ("MPN" in fields) next.mpn = String(fields.MPN ?? "");
  if ("EAU" in fields) next.eau = String(fields.EAU ?? "");
  if ("BPReference" in fields) next.bpReference = String(fields.BPReference ?? "");
  if ("Comments" in fields) next.notes = String(fields.Comments ?? "");
  if ("TimeofImpact" in fields)
    next.timeOfImpact = (fields.TimeofImpact as CostImpactNotice["timeOfImpact"]) ?? null;
  if ("Panels" in fields) next.usedOnPanels = (fields.Panels as CostImpactNotice["usedOnPanels"]) ?? null;
  if ("WhereUsed" in fields) next.whereUsed = String(fields.WhereUsed ?? "");
  if ("OriginalCost" in fields || "NewCost" in fields) {
    if ("OriginalCost" in fields) next.originalCost = String(fields.OriginalCost ?? "");
    if ("NewCost" in fields) next.newCost = String(fields.NewCost ?? "");
    next.deltaCost = deltaOf(next.originalCost, next.newCost);
  }
}

/** Append a comment to the notice's Communication field. */
export async function addCostImpactNoticeComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<CostImpactNotice> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((n) => n.id === id);
    if (idx < 0) throw new Error(`Cost impact notice ${id} not found`);
    const next: CostImpactNotice = {
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
  return updateCostImpactNoticeFields(id, { Communication: appendComment(existingRaw, comment) });
}

export async function editCostImpactNoticeComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<CostImpactNotice> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((n) => n.id === id);
    if (idx < 0) throw new Error(`Cost impact notice ${id} not found`);
    const next: CostImpactNotice = {
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
  return updateCostImpactNoticeFields(id, {
    Communication: replaceComment(existingRaw, target, newBodyHtml),
  });
}

/** `WhereUsed` is rich text — the caller hands over plain text; this converts on the way out. */
export function whereUsedPatch(plainText: string): Record<string, unknown> {
  return { WhereUsed: toStoredRichText(plainText) };
}
