import { graphFetch, graphFetchAll } from "./graph";
import { SP_BUILD_REQUEST_ITEMS_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";
import type { BuildRequestItem, GraphListItem, Person } from "@/types/task";
import { toBuildRequestItem } from "@/lib/buildRequestMapper";
import { ALL_CHECKLIST_FIELDS } from "@/lib/buildRequestChecklist";
import { multiPersonField } from "@/lib/graphFields";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { MOCK_BUILD_REQUEST_ITEMS } from "@/data/buildRequestMockData";

// =============================================================================
// Build Request Items API — the parts list. Every item joins to a header in
// the Build Request Tracker via `BuildRequestNoLookupId`. Callers group the
// flat list per header client-side (useBuildRequestItems + a groupBy in the
// views). Multi-choice Assembly / Operations / Testing write as PLAIN string
// arrays (multiChoiceField shape — no @odata.type annotation).
// =============================================================================

const MOCK_STORAGE_KEY = "aets:mock-build-request-items-v1";

function loadFromStorage(): BuildRequestItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BuildRequestItem[];
    return parsed.map((i) => ({
      ...i,
      createdAt: new Date(i.createdAt),
      modifiedAt: new Date(i.modifiedAt),
      comments: (i.comments ?? []).map((c) => ({
        ...c,
        timestamp: new Date(c.timestamp),
        attachments: c.attachments ?? [],
      })),
    }));
  } catch {
    return null;
  }
}

function saveToStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockStore));
  } catch {
    // Quota / private mode — non-fatal.
  }
}

let mockStore: BuildRequestItem[] = loadFromStorage() ?? [...MOCK_BUILD_REQUEST_ITEMS];

function delay<T>(value: T, ms = 100): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const ITEM_FIELD_SELECT = [
  "Title",
  "BuildRequestNoLookupId",
  "ProjectReferenceLookupId",
  "PartDesc",
  "DrawingNo",
  "DrawingRev",
  "Qty",
  "WONo_x002e_",
  "SpecialInstructions",
  "TestPlan",
  "OPSummary",
  "SerialNos",
  "RevisionDate",
  "PartType",
  "Part_x0020_Status",
  "Disposition",
  "Assembly",
  "Operations",
  "Testing",
  "Task_x0020_RefLookupId",
  "Watchers",
  "Communication",
  "Attachments",
  ...ALL_CHECKLIST_FIELDS.map((d) => d.field),
].join(",");

export async function listBuildRequestItems(): Promise<BuildRequestItem[]> {
  if (USE_MOCK) {
    return delay(mockStore.map((i) => ({ ...i })));
  }

  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUEST_ITEMS_LIST_ID}` +
    `/items?$expand=fields($select=${ITEM_FIELD_SELECT})&$top=500`;
  const items = await graphFetchAll<GraphListItem>(path);
  return items.map(toBuildRequestItem);
}

export interface CreateBuildRequestItemInput {
  partNumber: string;
  buildRequestLookupId: number;
  partDesc?: string;
  drawingNo?: string;
  drawingRev?: string;
  qty?: number | null;
  partType?: BuildRequestItem["partType"];
  disposition?: BuildRequestItem["disposition"];
  specialInstructions?: string;
  revisionDate?: string;
  projectRefLookupId?: number | null;
  watchers?: Person[];
}

export async function createBuildRequestItem(
  input: CreateBuildRequestItemInput,
): Promise<BuildRequestItem> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((i) => i.id)) + 1;
    const now = new Date();
    const item: BuildRequestItem = {
      id: nextId,
      partNumber: input.partNumber,
      buildRequestLookupId: input.buildRequestLookupId,
      projectRef: input.projectRefLookupId
        ? { lookupId: input.projectRefLookupId, title: "" }
        : null,
      partDesc: input.partDesc ?? "",
      drawingNo: input.drawingNo ?? "",
      drawingRev: input.drawingRev ?? "",
      qty: input.qty ?? null,
      woNo: "",
      specialInstructions: input.specialInstructions ?? "",
      testPlan: "",
      opSummary: "",
      serialNos: "",
      revisionDate: input.revisionDate ?? "",
      partType: input.partType ?? null,
      partStatus: null,
      disposition: input.disposition ?? null,
      assembly: [],
      operations: [],
      testing: [],
      checklist: {},
      taskRefLookupId: null,
      watchers: input.watchers ?? [],
      createdAt: now,
      modifiedAt: now,
      author: null,
      comments: [],
      hasAttachments: false,
    };
    mockStore = [item, ...mockStore];
    saveToStorage();
    return delay({ ...item });
  }

  const fields: Record<string, unknown> = {
    Title: input.partNumber,
    BuildRequestNoLookupId: input.buildRequestLookupId,
  };
  if (input.partDesc) fields.PartDesc = input.partDesc;
  if (input.drawingNo) fields.DrawingNo = input.drawingNo;
  if (input.drawingRev) fields.DrawingRev = input.drawingRev;
  if (input.qty != null) fields.Qty = input.qty;
  if (input.partType) fields.PartType = input.partType;
  if (input.disposition) fields.Disposition = input.disposition;
  if (input.specialInstructions) fields.SpecialInstructions = input.specialInstructions;
  if (input.revisionDate) fields.RevisionDate = input.revisionDate;
  if (input.projectRefLookupId) fields.ProjectReferenceLookupId = input.projectRefLookupId;
  if (input.watchers?.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", input.watchers));
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUEST_ITEMS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return toBuildRequestItem(created);
}

/**
 * Update arbitrary fields on an item — covers checklist boolean toggles,
 * multi-choice arrays (pass plain string arrays for Assembly / Operations /
 * Testing), Part Status, WO No, etc. Returns the updated item.
 */
export async function updateBuildRequestItemFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<BuildRequestItem> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`Build request item ${id} not found`);

    const next = { ...mockStore[idx], checklist: { ...mockStore[idx].checklist } };
    if ("Title" in fields) next.partNumber = fields.Title as string;
    if ("PartDesc" in fields) next.partDesc = fields.PartDesc as string;
    if ("DrawingNo" in fields) next.drawingNo = fields.DrawingNo as string;
    if ("DrawingRev" in fields) next.drawingRev = fields.DrawingRev as string;
    if ("Qty" in fields) next.qty = (fields.Qty as number | null) ?? null;
    if ("WONo_x002e_" in fields) next.woNo = fields.WONo_x002e_ as string;
    if ("SpecialInstructions" in fields) next.specialInstructions = fields.SpecialInstructions as string;
    if ("TestPlan" in fields) next.testPlan = fields.TestPlan as string;
    if ("OPSummary" in fields) next.opSummary = fields.OPSummary as string;
    if ("SerialNos" in fields) next.serialNos = fields.SerialNos as string;
    if ("RevisionDate" in fields) next.revisionDate = fields.RevisionDate as string;
    if ("PartType" in fields) next.partType = (fields.PartType as BuildRequestItem["partType"]) || null;
    if ("Part_x0020_Status" in fields) {
      next.partStatus = (fields.Part_x0020_Status as BuildRequestItem["partStatus"]) || null;
    }
    if ("Disposition" in fields) {
      next.disposition = (fields.Disposition as BuildRequestItem["disposition"]) || null;
    }
    if ("Assembly" in fields) next.assembly = (fields.Assembly as string[]) ?? [];
    if ("Operations" in fields) next.operations = (fields.Operations as string[]) ?? [];
    if ("Testing" in fields) next.testing = (fields.Testing as string[]) ?? [];
    if ("ProjectReferenceLookupId" in fields) {
      const v = fields.ProjectReferenceLookupId;
      next.projectRef = v ? { lookupId: Number(v), title: next.projectRef?.title ?? "" } : null;
    }
    if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
      next.watchers = fields.Watchers as Person[];
    }
    for (const def of ALL_CHECKLIST_FIELDS) {
      if (def.field in fields) next.checklist[def.field] = !!fields[def.field];
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveToStorage();
    return delay({ ...next });
  }

  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUEST_ITEMS_LIST_ID}/items/${id}/fields`,
    { method: "PATCH", body: JSON.stringify(fields) },
  );

  const all = await listBuildRequestItems();
  const reloaded = all.find((i) => i.id === id);
  if (!reloaded) throw new Error(`Build request item ${id} disappeared after update`);
  return reloaded;
}

/** Delete a part from its build request. */
export async function deleteBuildRequestItem(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((i) => i.id !== id);
    saveToStorage();
    await delay(null);
    return;
  }
  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUEST_ITEMS_LIST_ID}/items/${id}`,
    { method: "DELETE" },
  );
}

/** Replace an item's Watchers list. */
export async function setBuildRequestItemWatchers(
  id: number,
  people: Person[],
): Promise<BuildRequestItem> {
  if (USE_MOCK) {
    return updateBuildRequestItemFields(id, { Watchers: people });
  }
  const resolved = people.filter((p) => !!p.lookupId);
  if (people.length > 0 && resolved.length === 0) {
    throw new Error(
      "Cannot update Watchers: none of the watchers had a resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updateBuildRequestItemFields(id, multiPersonField("Watchers", people));
}

/** Append a comment to an ITEM's own Communication thread. */
export async function addBuildRequestItemComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<BuildRequestItem> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`Build request item ${id} not found`);
    const next = { ...mockStore[idx] };
    next.comments = [
      {
        timestamp: new Date(),
        authorName: comment.authorName,
        authorEmail: comment.authorEmail,
        bodyHtml: comment.bodyHtml,
        attachments: [],
      },
      ...next.comments,
    ];
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveToStorage();
    return delay({ ...next });
  }

  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUEST_ITEMS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, comment);
  return updateBuildRequestItemFields(id, { Communication: newRaw });
}

/** Edit the body of an existing ITEM comment, matched by timestamp + author email. */
export async function editBuildRequestItemComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<BuildRequestItem> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`Build request item ${id} not found`);
    const next = { ...mockStore[idx] };
    const targetEmail = target.authorEmail.toLowerCase();
    next.comments = next.comments.map((c) =>
      c.timestamp.getTime() === target.timestamp.getTime() &&
      c.authorEmail.toLowerCase() === targetEmail
        ? { ...c, bodyHtml: newBodyHtml }
        : c,
    );
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveToStorage();
    return delay({ ...next });
  }

  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUEST_ITEMS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  return updateBuildRequestItemFields(id, { Communication: newRaw });
}
