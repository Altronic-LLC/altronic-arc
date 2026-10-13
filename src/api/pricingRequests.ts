import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PRICING_REQUESTS_LIST_ID, SP_SALESTEAM_SITE_URL, USE_MOCK } from "./config";
import { listSiteUserDirectory, resolvePeopleLookupIds, resolveSiteUserLookupId } from "./siteUsers";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, Person } from "@/types/task";
import type { PricingRequest, PricingRequestStatus } from "@/types/pricing";
import {
  PRICING_ITEM_LEVEL_SELECT,
  PRICING_REQUEST_SELECT,
  applyPricingRequestPatch,
  attachPricingPeople,
  buildPricingRequestCreateFields,
  buildPricingRequestUpdateFields,
  compareRequests,
  toPricingRequest,
  type PricingRequestPatch,
} from "@/lib/pricingMapper";
import { nextPricingNumber } from "@/lib/pricingNumber";
import { isUniqueValueRejection, mockUniqueRejection } from "@/lib/quoteMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { isEditConflict } from "@/lib/listWriteErrors";
import { multiPersonField } from "@/lib/graphFields";
import { nextPricingMockId, pricingMockClone, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// Pricing Requests — ALTRONICSALESTEAM. Every pricing role reads this list, so
// it holds the request and its FINAL price only; cost and margin live on
// Pricing History (api/pricingHistory.ts), which requesters can't open.
//
// **No delete**: a request records what was asked and what was decided. One
// that no longer applies is Cancelled.
//
// NUMBERING: PR-YYYY-####, computed from a FRESH read of every Title just
// before the POST. `Title` is unique, so two creates in the same second get
// one refusal; that refusal ONLY re-reads, renumbers and retries once.
//
// PEOPLE: RequestedBy, PricedBy and AddedToSapBy are SINGLE-person columns —
// both halves selected, names filled from the site's user directory, written
// as a bare integer, and a person that can't be resolved REFUSES the write
// rather than clearing the column. Every person is resolved against THIS site
// collection: a lookupId is valid on one site only, and `useCurrentUser()`
// carries the Engineering one.
// =============================================================================

function listPath(): string {
  return `/sites/${SITES.salesTeam}/lists/${SP_PRICING_REQUESTS_LIST_ID}/items`;
}

const READ = `?$select=${PRICING_ITEM_LEVEL_SELECT}&$expand=fields($select=${PRICING_REQUEST_SELECT})`;

function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 404 || /\b404\b|itemNotFound/i.test(err instanceof Error ? err.message : String(err));
}

/** A person's lookupId on the Sales site. 0 when neither route can answer. */
export function resolveSalesTeamSiteUserLookupId(email: string): Promise<number> {
  return resolveSiteUserLookupId(SITES.salesTeam, SP_SALESTEAM_SITE_URL, email);
}

async function requireLookupId(person: Person, column: string): Promise<number> {
  const id = person.email ? await resolveSalesTeamSiteUserLookupId(person.email) : (person.lookupId ?? 0);
  if (!id) {
    throw new Error(
      `Couldn't set ${column}: ${person.displayName || person.email || "that person"} isn't a SharePoint user ` +
        "on the Sales site yet.",
    );
  }
  return id;
}

/** Pauses between attempts on a `409 resourceModified`. */
const CONFLICT_RETRY_DELAYS_MS = [400, 1200] as const;

async function withConflictRetry<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      const delay = CONFLICT_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isEditConflict(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/** Every request, newest first. */
export async function listPricingRequests(): Promise<PricingRequest[]> {
  if (USE_MOCK) return mockDelay(pricingMockClone(pricingMockDb.requests).sort(compareRequests));
  const [items, siteUsers] = await Promise.all([
    graphFetchAll<GraphListItem>(`${listPath()}${READ}&$top=999`),
    // Best-effort: a failed directory read degrades names to "User #n".
    listSiteUserDirectory(SITES.salesTeam).catch(() => new Map<number, Person>()),
  ]);
  const requests = items.map(toPricingRequest).sort(compareRequests);
  attachPricingPeople(requests, siteUsers);
  return requests;
}

/** One request. A 404 reads as null; anything else propagates. */
export async function getPricingRequest(id: number): Promise<PricingRequest | null> {
  if (USE_MOCK) {
    const found = pricingMockDb.requests.find((r) => r.id === id);
    return mockDelay(found ? pricingMockClone(found) : null);
  }
  const [item, siteUsers] = await Promise.all([
    graphFetch<GraphListItem>(`${listPath()}/${id}${READ}`).catch((err: unknown) => {
      if (isNotFound(err)) return null;
      throw err;
    }),
    listSiteUserDirectory(SITES.salesTeam).catch(() => new Map<number, Person>()),
  ]);
  if (!item) return null;
  const request = toPricingRequest(item);
  attachPricingPeople([request], siteUsers);
  return request;
}

async function listTitles(): Promise<string[]> {
  if (USE_MOCK) return pricingMockDb.requests.map((r) => r.requestNumber);
  const items = await graphFetchAll<GraphListItem>(`${listPath()}?$expand=fields($select=Title)&$top=999`);
  return items.map((i) => String(i.fields?.Title ?? ""));
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface PricingRequestCreateInput {
  status: Extract<PricingRequestStatus, "Submitted" | "Awaiting SAP">;
  altronicPartNumber: string;
  sapPartNumber: string;
  requestedDescription: string;
  /** SAP's description when the part was found, else what was typed. */
  description: string;
  mpg: string;
  requestedBy: Person;
  notes: string;
  customerSoldTo: string;
  customerName: string;
  customerGroup: string;
  /** The caller adds the requester; resolved against the Sales site here. */
  watchers: Person[];
}

async function postRequest(requestNumber: string, input: PricingRequestCreateInput): Promise<PricingRequest> {
  if (USE_MOCK) {
    if (pricingMockDb.requests.some((r) => r.requestNumber === requestNumber)) {
      await mockDelay();
      throw mockUniqueRejection("Title", requestNumber);
    }
    const now = new Date().toISOString();
    const row: PricingRequest = {
      id: nextPricingMockId(pricingMockDb.requests),
      requestNumber,
      status: input.status,
      altronicPartNumber: input.altronicPartNumber.trim(),
      sapPartNumber: input.sapPartNumber.trim(),
      requestedDescription: input.requestedDescription,
      description: input.description,
      mpg: input.mpg,
      requestedBy: { ...input.requestedBy },
      notes: input.notes,
      customerSoldTo: input.customerSoldTo.trim(),
      customerName: input.customerName.trim(),
      customerGroup: input.customerGroup.trim(),
      listPrice: null,
      customerDiscountPct: null,
      customerPrice: null,
      pricedBy: null,
      pricedAt: null,
      addedToSapBy: null,
      addedToSapAt: null,
      cancelReason: "",
      comments: [],
      watchers: input.watchers.map((p) => ({ ...p })),
      hasAttachments: false,
      createdBy: { ...input.requestedBy },
      createdAt: now,
      modifiedAt: now,
    };
    pricingMockDb.requests.push(row);
    return mockDelay(pricingMockClone(row));
  }

  const requestedByLookupId = await requireLookupId(input.requestedBy, "Requested By");
  const watchers = await resolvePeopleLookupIds(SITES.salesTeam, SP_SALESTEAM_SITE_URL, input.watchers);
  const fields = {
    ...buildPricingRequestCreateFields({ ...input, requestNumber, requestedByLookupId }),
    ...multiPersonField("Watchers", watchers),
  };
  const created = await graphFetch<GraphListItem>(listPath(), { method: "POST", body: JSON.stringify({ fields }) });
  return (await getPricingRequest(parseInt(created.id, 10))) ?? toPricingRequest(created);
}

/**
 * Raise a request, numbered PR-<this year>-#### from a fresh read. On a
 * unique-value refusal ONLY: re-read, renumber, retry ONCE — and only when the
 * fresh number differs. Any other failure surfaces unchanged.
 */
export async function createPricingRequest(
  input: PricingRequestCreateInput,
  now: Date = new Date(),
): Promise<PricingRequest> {
  const year = now.getFullYear();
  const first = nextPricingNumber("PR", year, await listTitles());
  try {
    return await postRequest(first, input);
  } catch (err) {
    if (!isUniqueValueRejection(err)) throw err;
    const second = nextPricingNumber("PR", year, await listTitles());
    if (second === first) throw err;
    return postRequest(second, input);
  }
}

// -----------------------------------------------------------------------------
// Updates
// -----------------------------------------------------------------------------

/** The single-person columns a write may set alongside its fields. `null` clears. */
export interface PricingRequestPeople {
  pricedBy?: Person | null;
  addedToSapBy?: Person | null;
}

function mockReplace(id: number, update: (r: PricingRequest) => PricingRequest): Promise<PricingRequest> {
  const idx = pricingMockDb.requests.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error(`Request ${id} not found`);
  const next = { ...update(pricingMockClone(pricingMockDb.requests[idx])), modifiedAt: new Date().toISOString() };
  pricingMockDb.requests[idx] = next;
  return mockDelay(pricingMockClone(next));
}

async function patchColumns(id: number, fields: Record<string, unknown>): Promise<PricingRequest> {
  await withConflictRetry(() =>
    graphFetch(`${listPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) }),
  );
  const updated = await getPricingRequest(id);
  if (!updated) throw new Error(`Request ${id} disappeared after update`);
  return updated;
}

/**
 * Edit a request, DIFFED against `previous`: only changed columns travel, and
 * nothing is sent when nothing changed. People travel in the SAME PATCH as
 * the fields — "Priced" and who priced it must never disagree.
 */
export async function updatePricingRequest(
  id: number,
  changes: PricingRequestPatch,
  previous: PricingRequest,
  people: PricingRequestPeople = {},
): Promise<PricingRequest> {
  if (USE_MOCK) {
    return mockReplace(id, (r) => ({
      ...applyPricingRequestPatch(r, changes),
      ...(people.pricedBy !== undefined && { pricedBy: people.pricedBy ? { ...people.pricedBy } : null }),
      ...(people.addedToSapBy !== undefined && {
        addedToSapBy: people.addedToSapBy ? { ...people.addedToSapBy } : null,
      }),
    }));
  }
  const fields = buildPricingRequestUpdateFields(changes, previous);
  if (people.pricedBy !== undefined) {
    fields.PricedByLookupId = people.pricedBy ? await requireLookupId(people.pricedBy, "Priced By") : null;
  }
  if (people.addedToSapBy !== undefined) {
    fields.AddedToSapByLookupId = people.addedToSapBy
      ? await requireLookupId(people.addedToSapBy, "Added to SAP By")
      : null;
  }
  if (Object.keys(fields).length === 0) return previous;
  return patchColumns(id, fields);
}

/** Replace the Watchers list. Refused when nobody in a non-empty list resolves. */
export async function setPricingRequestWatchers(id: number, people: Person[]): Promise<PricingRequest> {
  if (USE_MOCK) return mockReplace(id, (r) => ({ ...r, watchers: people.map((p) => ({ ...p })) }));
  const resolved = await resolvePeopleLookupIds(SITES.salesTeam, SP_SALESTEAM_SITE_URL, people);
  if (people.length > 0 && !resolved.some((p) => p.lookupId)) {
    throw new Error("Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.");
  }
  return patchColumns(id, multiPersonField("Watchers", resolved));
}

// -----------------------------------------------------------------------------
// Comments — the standard Communication thread.
// -----------------------------------------------------------------------------

export interface PricingCommentInput {
  authorName: string;
  authorEmail: string;
  bodyHtml: string;
}

/** Re-read Communication on EVERY attempt, so a retry never re-sends a stale thread. */
async function rewriteCommunication(id: number, change: (raw: string) => string): Promise<PricingRequest> {
  await withConflictRetry(async () => {
    const existing = await graphFetch<GraphListItem>(`${listPath()}/${id}?$expand=fields($select=Communication)`);
    const raw = (existing.fields?.Communication as string | undefined) ?? "";
    await graphFetch(`${listPath()}/${id}/fields`, {
      method: "PATCH",
      body: JSON.stringify({ Communication: change(raw) }),
    });
  });
  const updated = await getPricingRequest(id);
  if (!updated) throw new Error(`Request ${id} disappeared after update`);
  return updated;
}

export async function addPricingRequestComment(id: number, comment: PricingCommentInput): Promise<PricingRequest> {
  const timestamp = new Date();
  if (USE_MOCK) {
    return mockReplace(id, (r) => ({ ...r, comments: [{ ...comment, timestamp, attachments: [] }, ...r.comments] }));
  }
  return rewriteCommunication(id, (raw) => appendComment(raw, { ...comment, timestamp }));
}

export async function editPricingRequestComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<PricingRequest> {
  if (USE_MOCK) {
    return mockReplace(id, (r) => ({
      ...r,
      comments: r.comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        c.authorEmail.toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
    }));
  }
  return rewriteCommunication(id, (raw) => replaceComment(raw, target, newBodyHtml));
}
