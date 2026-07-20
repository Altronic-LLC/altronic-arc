import { graphFetch, graphFetchAll } from "./graph";
import { SP_BUILD_REQUESTS_LIST_ID, SP_SITE_ID, SP_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds, ensurePersonLookupId } from "./siteUsers";
import type { BuildRequest, GraphListItem, Person } from "@/types/task";
import { attachBuildRequestReferences, toBuildRequest } from "@/lib/buildRequestMapper";
import { multiLookupField, multiPersonField } from "@/lib/graphFields";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { listProjects } from "./tasks";
import { listSiteUsers } from "./eirs";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";

// =============================================================================
// Build Request headers API — the "Build Request Tracker" list on the
// Engineering site. Mirrors src/api/eirs.ts in shape (mock + real branches,
// trimmed $select). The child parts live in api/buildRequestItems.ts.
// =============================================================================

const MOCK_STORAGE_KEY = "aets:mock-build-requests-v1";

function loadFromStorage(): BuildRequest[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BuildRequest[];
    return parsed.map((b) => ({
      ...b,
      createdAt: new Date(b.createdAt),
      modifiedAt: new Date(b.modifiedAt),
      quotedShipDate: b.quotedShipDate ? new Date(b.quotedShipDate) : null,
      comments: (b.comments ?? []).map((c) => ({
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

let mockStore: BuildRequest[] = loadFromStorage() ?? [...MOCK_BUILD_REQUESTS];

function delay<T>(value: T, ms = 100): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const BR_FIELD_SELECT = [
  "Title",
  "Product",
  "BRNo_x002e_",
  "BRStatus",
  "BrType0",
  "BlockedReason",
  "RequiredLeadTime",
  "QuotedShipDate",
  "SamplePhase",
  "RequestorLookupId",
  "Requestor",
  "EngineerAssignedLookupId",
  "EngineerAssigned",
  "CustomerName",
  "CustomerPurchaseOrder",
  "RoHS",
  "Watchers",
  "ProjectReference",
  "TaskReferenceLookupId",
  "Communication",
  "Attachments",
].join(",");

export async function listBuildRequests(): Promise<BuildRequest[]> {
  if (USE_MOCK) {
    return delay(mockStore.map((b) => ({ ...b })));
  }

  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUESTS_LIST_ID}` +
    `/items?$expand=fields($select=${BR_FIELD_SELECT})&$top=200`;
  const [items, projects, siteUsers] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listProjects(),
    // Best-effort: resolve Requestor / EngineerAssigned bare LookupIds to
    // display names via the site's User Information List (same limitation
    // and same fix as EIR's Reporter).
    listSiteUsers().catch(() => [] as Person[]),
  ]);
  const usersById = new Map<number, Person>();
  for (const u of siteUsers) {
    if (u.lookupId) usersById.set(u.lookupId, u);
  }
  const brs = items.map(toBuildRequest);
  attachBuildRequestReferences(brs, projects, usersById);
  return brs;
}

export async function getBuildRequest(id: number): Promise<BuildRequest | null> {
  const all = await listBuildRequests();
  return all.find((b) => b.id === id) ?? null;
}

export interface CreateBuildRequestInput {
  title: string;
  /** Pre-computed "BR No." (BR_YYYY-####). Written to the BRNo_x002e_ column. */
  brNo: string;
  product?: string;
  status?: BuildRequest["status"];
  brType?: BuildRequest["brType"];
  requiredLeadTime?: BuildRequest["requiredLeadTime"];
  quotedShipDate?: Date | null;
  samplePhase?: BuildRequest["samplePhase"];
  requestor?: Person | null;
  engineerAssigned?: Person | null;
  customerName?: string;
  customerPO?: string;
  leadFree?: boolean;
  parentProjectLookupIds?: number[];
  watchers?: Person[];
}

export async function createBuildRequest(input: CreateBuildRequestInput): Promise<BuildRequest> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((b) => b.id)) + 1;
    const now = new Date();
    const br: BuildRequest = {
      id: nextId,
      brNo: input.brNo,
      title: input.title,
      product: input.product ?? "",
      status: input.status ?? "Submitted",
      brType: input.brType ?? null,
      blockedReason: null,
      requiredLeadTime: input.requiredLeadTime ?? null,
      quotedShipDate: input.quotedShipDate ?? null,
      samplePhase: input.samplePhase ?? null,
      requestor: input.requestor ?? null,
      engineerAssigned: input.engineerAssigned ?? null,
      customerName: input.customerName ?? "",
      customerPO: input.customerPO ?? "",
      leadFree: input.leadFree ?? false,
      watchers: input.watchers ?? [],
      parentProjects: (input.parentProjectLookupIds ?? []).map((lookupId) => ({
        lookupId,
        title: "",
      })),
      taskReferenceLookupId: null,
      createdAt: now,
      modifiedAt: now,
      author: input.requestor ?? null,
      comments: [],
      hasAttachments: false,
    };
    mockStore = [br, ...mockStore];
    saveToStorage();
    return delay({ ...br });
  }

  // Null/empty fields are omitted on POST — SharePoint rejects nulls,
  // especially for lookups.
  const fields: Record<string, unknown> = { Title: input.title, BRNo_x002e_: input.brNo };
  if (input.product) fields.Product = input.product;
  fields.BRStatus = input.status ?? "Submitted";
  if (input.brType) fields.BrType0 = input.brType;
  if (input.requiredLeadTime) fields.RequiredLeadTime = input.requiredLeadTime;
  if (input.quotedShipDate) fields.QuotedShipDate = input.quotedShipDate.toISOString();
  if (input.samplePhase) fields.SamplePhase = input.samplePhase;
  // Resolve lookupIds (creating on demand) for directory-picked people.
  const requestor = await ensurePersonLookupId(SP_SITE_URL, input.requestor ?? null);
  if (requestor?.lookupId) fields.RequestorLookupId = requestor.lookupId;
  const engineer = await ensurePersonLookupId(SP_SITE_URL, input.engineerAssigned ?? null);
  if (engineer?.lookupId) fields.EngineerAssignedLookupId = engineer.lookupId;
  if (input.customerName) fields.CustomerName = input.customerName;
  if (input.customerPO) fields.CustomerPurchaseOrder = input.customerPO;
  if (input.leadFree != null) fields.RoHS = input.leadFree;
  if (input.parentProjectLookupIds && input.parentProjectLookupIds.length > 0) {
    Object.assign(fields, multiLookupField("ProjectReference", input.parentProjectLookupIds));
  }
  const watchers = input.watchers ? await ensureLookupIds(SP_SITE_URL, input.watchers) : [];
  if (watchers.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUESTS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return toBuildRequest(created);
}

/** Update arbitrary fields on a Build Request header. Returns the updated header. */
export async function updateBuildRequestFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<BuildRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error(`Build request ${id} not found`);

    const next = { ...mockStore[idx] };
    if ("Title" in fields) next.title = fields.Title as string;
    if ("Product" in fields) next.product = fields.Product as string;
    if ("BRStatus" in fields) next.status = fields.BRStatus as BuildRequest["status"];
    if ("BrType0" in fields) next.brType = (fields.BrType0 as BuildRequest["brType"]) || null;
    if ("BlockedReason" in fields) {
      next.blockedReason = (fields.BlockedReason as BuildRequest["blockedReason"]) || null;
    }
    if ("RequiredLeadTime" in fields) {
      next.requiredLeadTime =
        (fields.RequiredLeadTime as BuildRequest["requiredLeadTime"]) || null;
    }
    if ("QuotedShipDate" in fields) {
      const v = fields.QuotedShipDate;
      next.quotedShipDate = v ? new Date(v as string) : null;
    }
    if ("SamplePhase" in fields) {
      next.samplePhase = (fields.SamplePhase as BuildRequest["samplePhase"]) || null;
    }
    if ("CustomerName" in fields) next.customerName = fields.CustomerName as string;
    if ("CustomerPurchaseOrder" in fields) next.customerPO = fields.CustomerPurchaseOrder as string;
    if ("RoHS" in fields) next.leadFree = !!fields.RoHS;
    if ("Communication" in fields) {
      // Comments handled via add/editBuildRequestComment below.
    }
    if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
      next.watchers = fields.Watchers as Person[];
    }
    if ("ProjectReferenceLookupId" in fields && Array.isArray(fields.ProjectReferenceLookupId)) {
      next.parentProjects = (fields.ProjectReferenceLookupId as number[]).map((lookupId) => ({
        lookupId,
        title:
          next.parentProjects.find((p) => p.lookupId === lookupId)?.title ?? "",
      }));
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveToStorage();
    return delay({ ...next });
  }

  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUESTS_LIST_ID}/items/${id}/fields`,
    { method: "PATCH", body: JSON.stringify(fields) },
  );

  const reloaded = await getBuildRequest(id);
  if (!reloaded) throw new Error(`Build request ${id} disappeared after update`);
  return reloaded;
}

/** Set the single-person Requestor field (or clear with null). */
export async function setBuildRequestRequestor(
  id: number,
  person: Person | null,
): Promise<BuildRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error(`Build request ${id} not found`);
    mockStore[idx] = { ...mockStore[idx], requestor: person, modifiedAt: new Date() };
    saveToStorage();
    return delay({ ...mockStore[idx] });
  }
  const ensured = await ensurePersonLookupId(SP_SITE_URL, person);
  return updateBuildRequestFields(id, { RequestorLookupId: ensured?.lookupId ?? null });
}

/** Set the single-person Engineer Assigned field (or clear with null). */
export async function setBuildRequestEngineer(
  id: number,
  person: Person | null,
): Promise<BuildRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error(`Build request ${id} not found`);
    mockStore[idx] = { ...mockStore[idx], engineerAssigned: person, modifiedAt: new Date() };
    saveToStorage();
    return delay({ ...mockStore[idx] });
  }
  const ensured = await ensurePersonLookupId(SP_SITE_URL, person);
  return updateBuildRequestFields(id, { EngineerAssignedLookupId: ensured?.lookupId ?? null });
}

/** Replace the header's project references (multi-lookup). */
export async function setBuildRequestProjects(
  id: number,
  lookupIds: number[],
): Promise<BuildRequest> {
  if (USE_MOCK) {
    return updateBuildRequestFields(id, { ProjectReferenceLookupId: lookupIds });
  }
  return updateBuildRequestFields(id, multiLookupField("ProjectReference", lookupIds));
}

/** Replace the Watchers list on a header. */
export async function setBuildRequestWatchers(
  id: number,
  people: Person[],
): Promise<BuildRequest> {
  if (USE_MOCK) {
    return updateBuildRequestFields(id, { Watchers: people });
  }
  const ensured = await ensureLookupIds(SP_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateBuildRequestFields(id, multiPersonField("Watchers", ensured));
}

/** Append a comment to a header's Communication field. */
export async function addBuildRequestComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<BuildRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error(`Build request ${id} not found`);
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
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUESTS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, comment);
  return updateBuildRequestFields(id, { Communication: newRaw });
}

/** Edit the body of an existing header comment, matched by timestamp + author email. */
export async function editBuildRequestComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<BuildRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error(`Build request ${id} not found`);
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
    `/sites/${SP_SITE_ID}/lists/${SP_BUILD_REQUESTS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  return updateBuildRequestFields(id, { Communication: newRaw });
}
