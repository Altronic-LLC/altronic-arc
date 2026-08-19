import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_GRAY_MARKET_LIST_ID, SP_PMO_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds, ensurePersonLookupId } from "./siteUsers";
import type {
  GrayMarketRequest,
  GrayMarketRequestInput,
  GraphListItem,
  Person,
} from "@/types/task";
import {
  buildGrayMarketCreateFields,
  compareGrayMarketRequests,
  toGrayMarketRequest,
} from "@/lib/grayMarketMapper";
import { GRAY_MARKET_FIELDS, GRAY_MARKET_SELECT } from "@/lib/grayMarketFields";
import { nextGrayMarketLogNo } from "@/lib/grayMarketNumber";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { MOCK_GRAY_MARKET_REQUESTS } from "@/data/grayMarketMockData";

// =============================================================================
// Gray Market Requests API — a part bought outside normal distribution,
// tracked from request through purchasing, engineering test, inspection and
// production sign-off.
//
// Lives on the **PMO site** (SITES.pmo), not a Supply Chain site — that's where
// the list has always been, and the grant already covers it. Supply Chain and
// Engineering both work in it.
//
// **There is no delete**, in the UI or here (Ray, 2026-08-19) — a request is a
// record of a part that was bought. Correcting one is an edit.
//
// 199 rows and growing slowly, so the list is fetched whole and filtered in the
// browser.
// =============================================================================

let mockStore: GrayMarketRequest[] = MOCK_GRAY_MARKET_REQUESTS.map((r) => ({ ...r }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_GRAY_MARKET_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_GRAY_MARKET_LIST_ID is not set.`);
  }
  return SP_GRAY_MARKET_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.pmo}/lists/${requireListId("reach the request")}/items/${id}`;
}

/** Every request, newest first. */
export async function listGrayMarketRequests(): Promise<GrayMarketRequest[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareGrayMarketRequests).map((r) => ({ ...r })));
  }
  const listId = requireListId("load gray market requests");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items` +
      `?$expand=fields($select=${GRAY_MARKET_SELECT})&$top=999`,
  );
  return items.map(toGrayMarketRequest).sort(compareGrayMarketRequests);
}

export async function getGrayMarketRequest(
  id: number,
): Promise<GrayMarketRequest | null> {
  if (USE_MOCK) {
    const found = mockStore.find((r) => r.id === id);
    return delay(found ? { ...found } : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(
      `${itemPath(id)}?$expand=fields($select=${GRAY_MARKET_SELECT})`,
    );
    return toGrayMarketRequest(item);
  } catch {
    return null;
  }
}

export async function createGrayMarketRequest(
  input: GrayMarketRequestInput,
  /** Existing requests, for the next log number. */
  existing: GrayMarketRequest[],
): Promise<GrayMarketRequest> {
  const logNo = nextGrayMarketLogNo(existing);

  if (USE_MOCK) {
    const now = new Date();
    const request: GrayMarketRequest = {
      id: Math.max(0, ...mockStore.map((r) => r.id)) + 1,
      title: input.title.trim(),
      logNo,
      status: input.status,
      requestDate: input.requestDate,
      dateCompleted: null,
      testingRequired: input.testingRequired,
      requestor: input.requestor,
      partsLocation: null,
      // Whoever raises a request watches it — the same rule as everywhere
      // else, applied here so mock mode behaves like the real thing.
      watchers: input.requestor ? [input.requestor] : [],
      comments: [],
      hasAttachments: false,
      values: { ...input.values },
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [request, ...mockStore];
    return delay(request);
  }

  const listId = requireListId("create the request");
  const fields = buildGrayMarketCreateFields(input, logNo);

  const requestor = await ensurePersonLookupId(SP_PMO_SITE_URL, input.requestor ?? null);
  if (requestor?.lookupId) fields.RequestorLookupId = requestor.lookupId;
  // The requestor watches their own request.
  const watchers = await ensureLookupIds(SP_PMO_SITE_URL, input.requestor ? [input.requestor] : []);
  if (watchers.some((p) => p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return (
    (await getGrayMarketRequest(parseInt(created.id, 10))) ?? toGrayMarketRequest(created)
  );
}

/**
 * Patch columns by their SharePoint names — the detail page's inline editors
 * each own one column, and `patch` on the hook side keeps the cache in step.
 */
export async function updateGrayMarketFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<GrayMarketRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`Gray market request ${id} not found`);
    const next: GrayMarketRequest = {
      ...mockStore[idx],
      values: { ...mockStore[idx].values },
      modifiedAt: new Date(),
    };
    applyMockFields(next, fields);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const updated = await getGrayMarketRequest(id);
  if (!updated) throw new Error(`Gray market request ${id} disappeared after update`);
  return updated;
}

/** Mock-mode equivalent of the PATCH — mirrors the real column names. */
function applyMockFields(next: GrayMarketRequest, fields: Record<string, unknown>) {
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("RequestStatus" in fields) next.status = String(fields.RequestStatus ?? "");
  if ("ProductionTest" in fields) next.testingRequired = String(fields.ProductionTest ?? "");
  if ("TodaysDate" in fields) {
    next.requestDate = fields.TodaysDate ? new Date(String(fields.TodaysDate)) : null;
  }
  if ("DateCompleted" in fields) {
    next.dateCompleted = fields.DateCompleted ? new Date(String(fields.DateCompleted)) : null;
  }
  if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
    next.watchers = fields.Watchers as Person[];
  }
  if ("Requestor" in fields) next.requestor = (fields.Requestor as Person) ?? null;
  if ("Parts_x0020_Location" in fields) {
    next.partsLocation = (fields.Parts_x0020_Location as Person) ?? null;
  }
  // Everything else is a descriptor column, stored by its domain key.
  for (const [column, value] of Object.entries(fields)) {
    const field = GRAY_MARKET_COLUMN_KEYS[column];
    if (field) next.values[field] = String(value ?? "");
  }
}

/** column → domain key, for the mock branch. */
const GRAY_MARKET_COLUMN_KEYS: Record<string, string> = Object.fromEntries(
  GRAY_MARKET_FIELDS.map((f) => [f.column, f.key]),
);

/** Replace the Watchers list. */
export async function setGrayMarketWatchers(
  id: number,
  people: Person[],
): Promise<GrayMarketRequest> {
  if (USE_MOCK) {
    return updateGrayMarketFields(id, { Watchers: people });
  }
  const ensured = await ensureLookupIds(SP_PMO_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateGrayMarketFields(id, multiPersonField("Watchers", ensured));
}

/** Append a comment to the request's Communication field. */
export async function addGrayMarketComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<GrayMarketRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`Gray market request ${id} not found`);
    const next: GrayMarketRequest = {
      ...mockStore[idx],
      comments: [
        {
          timestamp: new Date(),
          authorName: comment.authorName,
          authorEmail: comment.authorEmail,
          bodyHtml: comment.bodyHtml,
          attachments: [],
        },
        ...mockStore[idx].comments,
      ],
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  // Read-modify-write on one field, the same as every other comment thread —
  // the whole Communication value is rewritten, so a comment posted between
  // the read and the write would be lost. Same window the other five live with.
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateGrayMarketFields(id, {
    Communication: appendComment(existingRaw, comment),
  });
}

/** Edit one existing comment, matched on its timestamp + author. */
export async function editGrayMarketComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<GrayMarketRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`Gray market request ${id} not found`);
    const next: GrayMarketRequest = {
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
  return updateGrayMarketFields(id, {
    Communication: replaceComment(existingRaw, target, newBodyHtml),
  });
}
