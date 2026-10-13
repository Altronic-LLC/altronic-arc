import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_CUSTOMER_QUOTES_LIST_ID, SP_SALESTEAM_SITE_URL, USE_MOCK } from "./config";
import { resolvePeopleLookupIds } from "./siteUsers";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, Person } from "@/types/task";
import type { CustomerQuote, CustomerQuoteLine, QuoteCustomerInfo } from "@/types/pricing";
import {
  CUSTOMER_QUOTE_SELECT,
  PRICING_ITEM_LEVEL_SELECT,
  applyCustomerQuotePatch,
  buildCustomerQuoteFields,
  compareCustomerQuotes,
  toCustomerQuote,
  type CustomerQuotePatch,
} from "@/lib/pricingMapper";
import { formatQuoteNumber, nextQuoteBase, parseQuoteLines, revisionsOf } from "@/lib/customerQuotes";
import { HistoryUnreadableError } from "@/lib/pricingHistory";
import { isUniqueValueRejection, mockUniqueRejection } from "@/lib/quoteMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { nextPricingMockId, pricingMockClone, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// Customer Quotes — SQ-YYYY-####-R#, one row per quote REVISION (Ray,
// 2026-10-13: "like Insourcing Quotes"). MANAGERS AND ADMINS ONLY.
//
// **No delete**: a quote records what was offered. One that no longer applies
// is Lost or Expired.
//
// The customer and the lines are JSON (`Customer`, `Lines`); the customer's
// sold-to and name are ALSO written to plain columns so SharePoint's own views
// can show them. A Lines value that couldn't be parsed is never written over.
//
// A NEW REVISION copies the quote forward as a NEW ROW (Draft, the same base,
// Rev + 1). The old row is never touched, so each revision keeps exactly what
// was sent. Its comments stay with the revision they were made on.
//
// Numbering: the next base is the highest SQ sequence used this year + 1,
// from a FRESH read. Title is unique; that refusal ONLY renumbers and retries
// once.
// =============================================================================

const ENV = "VITE_SP_CUSTOMER_QUOTES_LIST_ID";

function listPath(): string {
  if (!SP_CUSTOMER_QUOTES_LIST_ID) throw new Error(`The Customer Quotes list isn't set up yet (${ENV} is not set).`);
  return `/sites/${SITES.salesTeam}/lists/${SP_CUSTOMER_QUOTES_LIST_ID}/items`;
}

const READ = `?$select=${PRICING_ITEM_LEVEL_SELECT}&$expand=fields($select=${CUSTOMER_QUOTE_SELECT})`;

function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 404 || /\b404\b|itemNotFound/i.test(err instanceof Error ? err.message : String(err));
}

export async function listCustomerQuotes(): Promise<CustomerQuote[]> {
  if (USE_MOCK) return mockDelay(pricingMockClone(pricingMockDb.quotes).sort(compareCustomerQuotes));
  if (!SP_CUSTOMER_QUOTES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(`${listPath()}${READ}&$top=999`);
  return items.map(toCustomerQuote).sort(compareCustomerQuotes);
}

export async function getCustomerQuote(id: number): Promise<CustomerQuote | null> {
  if (USE_MOCK) {
    const found = pricingMockDb.quotes.find((q) => q.id === id);
    return mockDelay(found ? pricingMockClone(found) : null);
  }
  const item = await graphFetch<GraphListItem>(`${listPath()}/${id}${READ}`).catch((err: unknown) => {
    if (isNotFound(err)) return null;
    throw err;
  });
  return item ? toCustomerQuote(item) : null;
}

async function listTitles(): Promise<string[]> {
  if (USE_MOCK) return pricingMockDb.quotes.map((q) => q.quoteNumber);
  const items = await graphFetchAll<GraphListItem>(`${listPath()}?$expand=fields($select=Title)&$top=999`);
  return items.map((i) => String(i.fields?.Title ?? ""));
}

export interface CustomerQuoteRow {
  validityDays: number;
  customer: QuoteCustomerInfo;
  lines: CustomerQuoteLine[];
  notes: string;
  /** The caller adds the creator; resolved against the Sales site here. */
  watchers: Person[];
}

async function postQuote(quoteBase: string, rev: number, body: CustomerQuoteRow): Promise<CustomerQuote> {
  const quoteNumber = formatQuoteNumber(quoteBase, rev);
  if (USE_MOCK) {
    if (pricingMockDb.quotes.some((q) => q.quoteNumber === quoteNumber)) {
      await mockDelay();
      throw mockUniqueRejection("Title", quoteNumber);
    }
    const now = new Date().toISOString();
    const row: CustomerQuote = {
      id: nextPricingMockId(pricingMockDb.quotes),
      quoteNumber,
      quoteBase,
      rev,
      status: "Draft",
      validityDays: body.validityDays,
      customer: { ...body.customer },
      lines: body.lines.map((l) => ({ ...l })),
      linesCorrupt: false,
      notes: body.notes,
      comments: [],
      watchers: body.watchers.map((p) => ({ ...p })),
      hasAttachments: false,
      createdBy: body.watchers[0] ? { ...body.watchers[0] } : null,
      createdAt: now,
      modifiedAt: now,
    };
    pricingMockDb.quotes.push(row);
    return mockDelay(pricingMockClone(row));
  }
  const watchers = await resolvePeopleLookupIds(SITES.salesTeam, SP_SALESTEAM_SITE_URL, body.watchers);
  const fields = {
    Title: quoteNumber,
    QuoteBase: quoteBase,
    Rev: rev,
    Status: "Draft",
    ...buildCustomerQuoteFields({
      validityDays: body.validityDays,
      customer: body.customer,
      lines: body.lines,
      notes: body.notes,
    }),
    ...multiPersonField("Watchers", watchers),
  };
  const created = await graphFetch<GraphListItem>(listPath(), { method: "POST", body: JSON.stringify({ fields }) });
  return (await getCustomerQuote(parseInt(created.id, 10))) ?? toCustomerQuote(created);
}

/** Raise a new quote at R1. One renumber-and-retry on a unique-value refusal only. */
export async function createCustomerQuote(body: CustomerQuoteRow, now: Date = new Date()): Promise<CustomerQuote> {
  const year = now.getFullYear();
  const first = nextQuoteBase(year, await listTitles());
  try {
    return await postQuote(first, 1, body);
  } catch (err) {
    if (!isUniqueValueRejection(err)) throw err;
    const second = nextQuoteBase(year, await listTitles());
    if (second === first) throw err;
    return postQuote(second, 1, body);
  }
}

/** Copy a quote forward as its next revision — a NEW row, Draft. The old one is untouched. */
export async function createCustomerQuoteRevision(id: number, watchers: Person[]): Promise<CustomerQuote> {
  const source = await getCustomerQuote(id);
  if (!source) throw new Error(`Quote ${id} not found`);
  if (source.linesCorrupt) throw new HistoryUnreadableError("quote line");
  const all = USE_MOCK ? pricingMockDb.quotes : await listCustomerQuotes();
  const nextRev = (revisionsOf(source.quoteBase, all)[0]?.rev ?? source.rev) + 1;
  return postQuote(source.quoteBase, nextRev, {
    validityDays: source.validityDays,
    customer: source.customer,
    lines: source.lines,
    notes: source.notes,
    watchers,
  });
}

/**
 * Edit a quote. A Lines write re-reads the stored value first and refuses one
 * it can't parse — replacing data ARC failed to read would lose it.
 */
export async function updateCustomerQuote(id: number, patch: CustomerQuotePatch): Promise<CustomerQuote> {
  if (USE_MOCK) {
    const idx = pricingMockDb.quotes.findIndex((q) => q.id === id);
    if (idx < 0) throw new Error(`Quote ${id} not found`);
    if (patch.lines !== undefined && pricingMockDb.quotes[idx].linesCorrupt) throw new HistoryUnreadableError("quote line");
    const next = { ...applyCustomerQuotePatch(pricingMockDb.quotes[idx], patch), modifiedAt: new Date().toISOString() };
    pricingMockDb.quotes[idx] = next;
    return mockDelay(pricingMockClone(next));
  }
  if (patch.lines !== undefined) {
    const fresh = await graphFetch<GraphListItem>(`${listPath()}/${id}?$expand=fields($select=Lines)`);
    if (parseQuoteLines(fresh.fields?.Lines).corrupt) throw new HistoryUnreadableError("quote line");
  }
  const fields = buildCustomerQuoteFields(patch);
  if (Object.keys(fields).length > 0) {
    await graphFetch(`${listPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  }
  const updated = await getCustomerQuote(id);
  if (!updated) throw new Error(`Quote ${id} disappeared after saving`);
  return updated;
}

export async function setCustomerQuoteWatchers(id: number, people: Person[]): Promise<CustomerQuote> {
  if (USE_MOCK) {
    const idx = pricingMockDb.quotes.findIndex((q) => q.id === id);
    pricingMockDb.quotes[idx] = { ...pricingMockDb.quotes[idx], watchers: people.map((p) => ({ ...p })) };
    return mockDelay(pricingMockClone(pricingMockDb.quotes[idx]));
  }
  const resolved = await resolvePeopleLookupIds(SITES.salesTeam, SP_SALESTEAM_SITE_URL, people);
  if (people.length > 0 && !resolved.some((p) => p.lookupId)) {
    throw new Error("Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.");
  }
  await graphFetch(`${listPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(multiPersonField("Watchers", resolved)),
  });
  const updated = await getCustomerQuote(id);
  if (!updated) throw new Error(`Quote ${id} disappeared after saving`);
  return updated;
}

export interface QuoteCommentInput {
  authorName: string;
  authorEmail: string;
  bodyHtml: string;
}

async function rewriteCommunication(id: number, change: (raw: string) => string): Promise<CustomerQuote> {
  const existing = await graphFetch<GraphListItem>(`${listPath()}/${id}?$expand=fields($select=Communication)`);
  const raw = (existing.fields?.Communication as string | undefined) ?? "";
  await graphFetch(`${listPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify({ Communication: change(raw) }) });
  const updated = await getCustomerQuote(id);
  if (!updated) throw new Error(`Quote ${id} disappeared after saving`);
  return updated;
}

export async function addCustomerQuoteComment(id: number, comment: QuoteCommentInput): Promise<CustomerQuote> {
  const timestamp = new Date();
  if (USE_MOCK) {
    const idx = pricingMockDb.quotes.findIndex((q) => q.id === id);
    const q = pricingMockDb.quotes[idx];
    pricingMockDb.quotes[idx] = { ...q, comments: [{ ...comment, timestamp, attachments: [] }, ...q.comments] };
    return mockDelay(pricingMockClone(pricingMockDb.quotes[idx]));
  }
  return rewriteCommunication(id, (raw) => appendComment(raw, { ...comment, timestamp }));
}

export async function editCustomerQuoteComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<CustomerQuote> {
  if (USE_MOCK) {
    const idx = pricingMockDb.quotes.findIndex((q) => q.id === id);
    const q = pricingMockDb.quotes[idx];
    pricingMockDb.quotes[idx] = {
      ...q,
      comments: q.comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        c.authorEmail.toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
    };
    return mockDelay(pricingMockClone(pricingMockDb.quotes[idx]));
  }
  return rewriteCommunication(id, (raw) => replaceComment(raw, target, newBodyHtml));
}
