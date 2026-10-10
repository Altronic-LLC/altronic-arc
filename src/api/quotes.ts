import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PMO_SITE_URL, SP_QUOTES_LIST_ID, USE_MOCK } from "./config";
import { resolvePeopleLookupIds } from "./siteUsers";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, Person } from "@/types/task";
import type { Quote, QuoteLink, QuoteStatus } from "@/types/quote";
import {
  QUOTE_ITEM_LEVEL_SELECT,
  QUOTE_SELECT,
  applyQuotePatch,
  buildQuoteCreateFields,
  buildQuoteUpdateFields,
  compareQuotes,
  isUniqueValueRejection,
  mockUniqueRejection,
  toQuote,
  type QuoteCreateFieldsInput,
  type QuotePatch,
} from "@/lib/quoteMapper";
import { formatQuoteBase, formatQuoteNumber, nextQuoteSequence } from "@/lib/quoteNumber";
import { appendComment, parseCommunication, replaceComment } from "@/lib/communicationParser";
import { isEditConflict } from "@/lib/listWriteErrors";
import { multiPersonField } from "@/lib/graphFields";
import { nextMockId, quoteMockClone, quoteMockDb } from "@/data/quoteMockData";

// =============================================================================
// Quotes — the header list, one row per quote REVISION (PMO site).
//
// **No delete**, in the UI or here: a quote records what was offered. A
// withdrawn one is Lost or Expired.
//
// NUMBERING. `createQuote` computes the number itself from a FRESH read of
// every Title (`IQ-<code>-<global seq>-R1`, lib/quoteNumber.ts). `Title` has
// Enforce Unique Values, so two people creating in the same second get one
// refusal; that refusal — and ONLY that refusal — re-reads, recomputes, and
// retries ONCE, and only when the fresh read yields a different number. Any
// other failure surfaces unchanged (the Operations task numbering rule).
//
// PEOPLE. Watchers is MULTI-person, expanded by Graph on read. Every write
// resolves people against THIS site (SITES.pmo / SP_PMO_SITE_URL) — a lookupId
// is valid on one site collection only, and `useCurrentUser()` carries the
// Engineering one.
//
// HYPERLINKS. EngineeringTaskLink / OperationsTaskLink never travel in the
// create POST (a bare 400 that fails the whole create); `setQuoteLinks` writes
// them in their OWN PATCH so a refusal costs only the link.
// =============================================================================

const ENV_VAR = "VITE_SP_QUOTES_LIST_ID";

function requireListId(action: string): string {
  if (!SP_QUOTES_LIST_ID) {
    throw new Error(`Cannot ${action}: the Quotes list isn't configured (${ENV_VAR} is not set).`);
  }
  return SP_QUOTES_LIST_ID;
}

function listPath(listId: string): string {
  return `/sites/${SITES.pmo}/lists/${listId}/items`;
}

/** Whether a Graph failure means "no such item" rather than "something broke". */
export function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return true;
  return /\b404\b|itemNotFound/i.test(err instanceof Error ? err.message : String(err));
}

/** Resolve people against the PMO site collection — see the header. */
export function resolveQuotePeople(people: Person[]): Promise<Person[]> {
  return resolvePeopleLookupIds(SITES.pmo, SP_PMO_SITE_URL, people);
}

/** Pauses between attempts on a `409 resourceModified` (the api/tasks.ts arrangement). */
export const QUOTE_CONFLICT_RETRY_DELAYS_MS = [400, 1200] as const;

/**
 * Run a write, trying again when SharePoint refuses it because the item
 * changed mid-flight. Safe ONLY because each caller rebuilds anything it
 * derived from a read INSIDE `write` — the comment writes re-read
 * Communication on every attempt.
 */
export async function withQuoteConflictRetry<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      const delay = QUOTE_CONFLICT_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isEditConflict(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Refuse a Watchers write that resolved nobody, rather than silently clearing the column. */
export function requireSomeResolved(people: Person[], resolved: Person[], column: string): void {
  if (people.length > 0 && !resolved.some((p) => p.lookupId)) {
    throw new Error(
      `Cannot update ${column}: couldn't resolve a SharePoint user for any of the selected people.`,
    );
  }
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/** Every quote revision, newest first. `[]` when the list isn't configured. */
export async function listQuotes(): Promise<Quote[]> {
  if (USE_MOCK) return mockDelay([...quoteMockDb.quotes].sort(compareQuotes).map(quoteMockClone.quote));
  if (!SP_QUOTES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${listPath(SP_QUOTES_LIST_ID)}?$select=${QUOTE_ITEM_LEVEL_SELECT}&$expand=fields($select=${QUOTE_SELECT})&$top=999`,
  );
  return items.map(toQuote).sort(compareQuotes);
}

/**
 * One quote. A 404 is a real answer and reads as null; anything else — a
 * throttle, a refused read, a dead session — propagates (the FAIT lesson:
 * swallowing every failure reports a successful write as "it disappeared").
 */
export async function getQuote(id: number): Promise<Quote | null> {
  if (USE_MOCK) {
    const found = quoteMockDb.quotes.find((q) => q.id === id);
    return mockDelay(found ? quoteMockClone.quote(found) : null);
  }
  if (!SP_QUOTES_LIST_ID) return null;
  const item = await graphFetch<GraphListItem>(
    `${listPath(SP_QUOTES_LIST_ID)}/${id}?$select=${QUOTE_ITEM_LEVEL_SELECT}&$expand=fields($select=${QUOTE_SELECT})`,
  ).catch((err: unknown) => {
    if (isNotFound(err)) return null;
    throw err;
  });
  return item ? toQuote(item) : null;
}

/** Every Title on the list — the numbering input. A FRESH read, never the cache. */
async function listQuoteTitles(): Promise<string[]> {
  if (USE_MOCK) return quoteMockDb.quotes.map((q) => q.quoteNumber);
  const items = await graphFetchAll<GraphListItem>(
    `${listPath(requireListId("number a quote"))}?$expand=fields($select=Title)&$top=999`,
  );
  return items.map((item) => String(item.fields?.Title ?? ""));
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface QuoteCreateInput {
  customerId: number;
  /** The customer's frozen code — goes into the number. */
  customerCode: string;
  contactName: string;
  contactEmail: string;
  validityDays: number;
  budgetary: boolean;
  budgetaryText: string;
  quoteNotes: string;
  /** The caller adds the creator; resolved against PMO here. */
  watchers: Person[];
  status?: QuoteStatus;
  /** Phase 2 text column; normally blank on a new quote. */
  engineeringProjectRef?: string;
}

/** Number, base and rev for a new row, computed from the list's current Titles. */
export interface QuoteNumbering {
  quoteNumber: string;
  quoteBase: string;
  rev: number;
}

/** The header columns a create writes, minus the number (computed per attempt). */
export type QuoteRowBody = Omit<QuoteCreateFieldsInput, "quoteNumber" | "quoteBase" | "rev">;

async function postQuote(numbering: QuoteNumbering, body: QuoteRowBody): Promise<Quote> {
  if (USE_MOCK) {
    if (quoteMockDb.quotes.some((q) => q.quoteNumber.toUpperCase() === numbering.quoteNumber.toUpperCase())) {
      await mockDelay();
      throw mockUniqueRejection("Title", numbering.quoteNumber);
    }
    const now = new Date().toISOString();
    const row: Quote = {
      id: nextMockId(quoteMockDb.quotes),
      ...numbering,
      customerId: body.customerId,
      status: body.status,
      validityDays: body.validityDays,
      contactName: body.contactName.trim(),
      contactEmail: body.contactEmail.trim(),
      budgetary: body.budgetary,
      budgetaryText: body.budgetaryText,
      quoteNotes: body.quoteNotes,
      comments: parseCommunication(body.communication ?? ""),
      watchers: body.watchers.map((p) => ({ ...p })),
      engineeringTaskLink: null,
      operationsTaskLink: null,
      engineeringProjectRef: (body.engineeringProjectRef ?? "").trim(),
      hasAttachments: false,
      createdBy: body.watchers[0] ? { ...body.watchers[0] } : null,
      createdAt: now,
      modifiedAt: now,
    };
    quoteMockDb.quotes.push(row);
    return mockDelay(quoteMockClone.quote(row));
  }

  const listId = requireListId("create a quote");
  const watchers = await resolveQuotePeople(body.watchers);
  const fields = buildQuoteCreateFields({ ...body, ...numbering, watchers });
  const created = await graphFetch<GraphListItem>(listPath(listId), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return (await getQuote(parseInt(created.id, 10))) ?? toQuote(created);
}

/**
 * Create a header row numbered by `numberer` from a fresh read of every
 * Title. On a unique-value refusal ONLY: re-read, renumber, retry ONCE — and
 * only when the fresh number differs. Exported for api/quoteRevisions.ts,
 * which numbers by rev rather than by sequence.
 */
export async function createQuoteWithNumbering(
  numberer: (titles: string[]) => QuoteNumbering,
  body: QuoteRowBody,
): Promise<Quote> {
  const first = numberer(await listQuoteTitles());
  try {
    return await postQuote(first, body);
  } catch (err) {
    if (!isUniqueValueRejection(err)) throw err;
    const second = numberer(await listQuoteTitles());
    if (second.quoteNumber === first.quoteNumber) throw err;
    return postQuote(second, body);
  }
}

/** Raise a new quote at R1 with the next GLOBAL sequence for the customer's code. */
export async function createQuote(input: QuoteCreateInput): Promise<Quote> {
  if (!USE_MOCK) requireListId("create a quote");
  return createQuoteWithNumbering(
    (titles) => {
      const quoteBase = formatQuoteBase(input.customerCode, nextQuoteSequence(titles));
      return { quoteBase, rev: 1, quoteNumber: formatQuoteNumber(quoteBase, 1) };
    },
    {
      customerId: input.customerId,
      status: input.status ?? "Draft",
      validityDays: input.validityDays,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      budgetary: input.budgetary,
      budgetaryText: input.budgetaryText,
      quoteNotes: input.quoteNotes,
      engineeringProjectRef: input.engineeringProjectRef,
      watchers: input.watchers,
    },
  );
}

// -----------------------------------------------------------------------------
// Updates
// -----------------------------------------------------------------------------

function mockReplace(id: number, update: (q: Quote) => Quote): Promise<Quote> {
  const idx = quoteMockDb.quotes.findIndex((q) => q.id === id);
  if (idx < 0) throw new Error(`Quote ${id} not found`);
  const next = { ...update(quoteMockClone.quote(quoteMockDb.quotes[idx])), modifiedAt: new Date().toISOString() };
  quoteMockDb.quotes[idx] = next;
  return mockDelay(quoteMockClone.quote(next));
}

/** PATCH raw columns, then hand back the row as SharePoint now holds it. */
async function patchQuoteColumns(id: number, fields: Record<string, unknown>): Promise<Quote> {
  const listId = requireListId("update a quote");
  await graphFetch(`${listPath(listId)}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const updated = await getQuote(id);
  if (!updated) throw new Error(`Quote ${id} disappeared after update`);
  return updated;
}

/**
 * Edit header fields, DIFFED against the row the edit started from: only
 * changed columns travel, and nothing is sent when nothing changed (the
 * previous row comes back). Number, base and rev are never edited.
 */
export async function updateQuoteFields(id: number, changes: QuotePatch, previous: Quote): Promise<Quote> {
  if (USE_MOCK) return mockReplace(id, (q) => applyQuotePatch(q, changes));
  const fields = buildQuoteUpdateFields(changes, previous);
  if (Object.keys(fields).length === 0) return previous;
  return patchQuoteColumns(id, fields);
}

/** Replace the Watchers list (resolved against PMO; refused if nobody resolves). */
export async function setQuoteWatchers(id: number, people: Person[]): Promise<Quote> {
  if (USE_MOCK) return mockReplace(id, (q) => ({ ...q, watchers: people.map((p) => ({ ...p })) }));
  const resolved = await resolveQuotePeople(people);
  requireSomeResolved(people, resolved, "Watchers");
  return patchQuoteColumns(id, multiPersonField("Watchers", resolved));
}

/**
 * Set (or clear with `null`) the Phase-2 task links. A key left out is
 * untouched. Its OWN PATCH, never folded into another write — a Hyperlink
 * column is the fragile kind (the EIRReference lesson).
 */
export async function setQuoteLinks(
  id: number,
  links: { engineeringTaskLink?: QuoteLink | null; operationsTaskLink?: QuoteLink | null },
): Promise<Quote> {
  const toColumn = (l: QuoteLink | null) => (l ? { Url: l.url, Description: l.description || l.url } : null);
  if (USE_MOCK) {
    return mockReplace(id, (q) => ({
      ...q,
      ...(links.engineeringTaskLink !== undefined && {
        engineeringTaskLink: links.engineeringTaskLink ? { ...links.engineeringTaskLink } : null,
      }),
      ...(links.operationsTaskLink !== undefined && {
        operationsTaskLink: links.operationsTaskLink ? { ...links.operationsTaskLink } : null,
      }),
    }));
  }
  const fields: Record<string, unknown> = {};
  if (links.engineeringTaskLink !== undefined) fields.EngineeringTaskLink = toColumn(links.engineeringTaskLink);
  if (links.operationsTaskLink !== undefined) fields.OperationsTaskLink = toColumn(links.operationsTaskLink);
  if (Object.keys(fields).length === 0) {
    const current = await getQuote(id);
    if (!current) throw new Error(`Quote ${id} not found`);
    return current;
  }
  return patchQuoteColumns(id, fields);
}

// -----------------------------------------------------------------------------
// Comments — the standard pipe-delimited Communication thread.
// -----------------------------------------------------------------------------

export interface QuoteCommentInput {
  authorName: string;
  authorEmail: string;
  bodyHtml: string;
}

/**
 * Read Communication, rebuild it with `change`, write it back — re-reading on
 * every attempt, so a retry after a conflict never re-sends a stale thread.
 */
async function rewriteQuoteCommunication(id: number, change: (raw: string) => string): Promise<Quote> {
  const listId = requireListId("comment on a quote");
  await withQuoteConflictRetry(async () => {
    const existing = await graphFetch<GraphListItem>(
      `${listPath(listId)}/${id}?$expand=fields($select=Communication)`,
    );
    const raw = (existing.fields?.Communication as string | undefined) ?? "";
    await graphFetch(`${listPath(listId)}/${id}/fields`, {
      method: "PATCH",
      body: JSON.stringify({ Communication: change(raw) }),
    });
  });
  const updated = await getQuote(id);
  if (!updated) throw new Error(`Quote ${id} disappeared after update`);
  return updated;
}

export async function addQuoteComment(id: number, comment: QuoteCommentInput): Promise<Quote> {
  // Fixed once, outside any retry, so a retried append keeps the moment it was posted.
  const timestamp = new Date();
  if (USE_MOCK) {
    return mockReplace(id, (q) => ({
      ...q,
      comments: [{ ...comment, timestamp, attachments: [] }, ...q.comments],
    }));
  }
  return rewriteQuoteCommunication(id, (raw) => appendComment(raw, { ...comment, timestamp }));
}

export async function editQuoteComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<Quote> {
  if (USE_MOCK) {
    return mockReplace(id, (q) => ({
      ...q,
      comments: q.comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        c.authorEmail.toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
    }));
  }
  return rewriteQuoteCommunication(id, (raw) => replaceComment(raw, target, newBodyHtml));
}
