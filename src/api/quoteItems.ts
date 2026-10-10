import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QUOTE_ITEMS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, Person } from "@/types/task";
import type { QuoteItem } from "@/types/quote";
import {
  QUOTE_ITEM_SELECT,
  applyQuoteItemPatch,
  buildQuoteItemCreateFields,
  buildQuoteItemUpdateFields,
  compareLines,
  toQuoteItem,
  type QuoteItemInput,
  type QuoteItemPatch,
} from "@/lib/quoteMapper";
import { appendComment, parseCommunication, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { nextMockId, quoteMockClone, quoteMockDb } from "@/data/quoteMockData";
import {
  isNotFound,
  requireSomeResolved,
  resolveQuotePeople,
  withQuoteConflictRetry,
  type QuoteCommentInput,
} from "./quotes";

// =============================================================================
// Quote Items — the components under each final assembly (PMO site). Cost and
// margin live here. Each has its own INTERNAL comment thread (never mirrored)
// and attachments (kind `quoteItem`).
//
// Two SINGLE lookups, `QuoteRef` and `AssemblyRef`: both halves selected on
// read, bare integers on write. Watchers is multi-person, resolved against
// the PMO site on every write. Fetched WHOLE and scoped in the browser.
//
// Items CAN be deleted (section 13) — the composition of a draft; a rev keeps
// what was sent.
// =============================================================================

const ENV_VAR = "VITE_SP_QUOTE_ITEMS_LIST_ID";

function requireListId(action: string): string {
  if (!SP_QUOTE_ITEMS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Quote Items list isn't configured (${ENV_VAR} is not set).`);
  }
  return SP_QUOTE_ITEMS_LIST_ID;
}

function listPath(listId: string): string {
  return `/sites/${SITES.pmo}/lists/${listId}/items`;
}

async function readItem(listId: string, id: number): Promise<QuoteItem> {
  const item = await graphFetch<GraphListItem>(
    `${listPath(listId)}/${id}?$expand=fields($select=${QUOTE_ITEM_SELECT})`,
  );
  return toQuoteItem(item);
}

function mockReplace(id: number, update: (i: QuoteItem) => QuoteItem): Promise<QuoteItem> {
  const idx = quoteMockDb.items.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error(`Quote item ${id} not found`);
  const next = update(quoteMockClone.item(quoteMockDb.items[idx]));
  quoteMockDb.items[idx] = next;
  return mockDelay(quoteMockClone.item(next));
}

async function patchItemColumns(id: number, fields: Record<string, unknown>): Promise<QuoteItem> {
  const listId = requireListId("update a component");
  await graphFetch(`${listPath(listId)}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  return readItem(listId, id);
}

/** Every component on every quote, in line order. `[]` when the list isn't configured. */
export async function listQuoteItems(): Promise<QuoteItem[]> {
  if (USE_MOCK) return mockDelay([...quoteMockDb.items].sort(compareLines).map(quoteMockClone.item));
  if (!SP_QUOTE_ITEMS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${listPath(SP_QUOTE_ITEMS_LIST_ID)}?$expand=fields($select=${QUOTE_ITEM_SELECT})&$top=999`,
  );
  return items.map(toQuoteItem).sort(compareLines);
}

export async function createQuoteItem(input: QuoteItemInput): Promise<QuoteItem> {
  if (USE_MOCK) {
    const row: QuoteItem = {
      id: nextMockId(quoteMockDb.items),
      quoteId: input.quoteId,
      assemblyId: input.assemblyId,
      lineNo: input.lineNo,
      altronicPartNumber: input.altronicPartNumber.trim(),
      sapPartNumber: input.sapPartNumber.trim(),
      description: input.description,
      quantity: input.quantity,
      cost: input.cost,
      materialOverheadPct: input.materialOverheadPct,
      comments: parseCommunication(input.communication ?? ""),
      watchers: (input.watchers ?? []).map((p) => ({ ...p })),
      hasAttachments: false,
    };
    quoteMockDb.items.push(row);
    return mockDelay(quoteMockClone.item(row));
  }
  const listId = requireListId("add a component");
  const watchers = await resolveQuotePeople(input.watchers ?? []);
  const created = await graphFetch<GraphListItem>(listPath(listId), {
    method: "POST",
    body: JSON.stringify({ fields: buildQuoteItemCreateFields(input, watchers) }),
  });
  return readItem(listId, parseInt(created.id, 10));
}

/** DIFFED against `previous` — nothing is sent when nothing changed. */
export async function updateQuoteItemFields(
  id: number,
  changes: QuoteItemPatch,
  previous: QuoteItem,
): Promise<QuoteItem> {
  if (USE_MOCK) return mockReplace(id, (i) => applyQuoteItemPatch(i, changes));
  requireListId("update a component");
  const fields = buildQuoteItemUpdateFields(changes, previous);
  if (Object.keys(fields).length === 0) return previous;
  return patchItemColumns(id, fields);
}

/** Delete a component. A 404 resolves — it's already gone. */
export async function deleteQuoteItem(id: number): Promise<void> {
  if (USE_MOCK) {
    quoteMockDb.items = quoteMockDb.items.filter((i) => i.id !== id);
    await mockDelay(null);
    return;
  }
  const listId = requireListId("delete a component");
  await graphFetch(`${listPath(listId)}/${id}`, { method: "DELETE" }).catch((err: unknown) => {
    if (!isNotFound(err)) throw err;
  });
}

/** Replace the component's Watchers (resolved against PMO; refused if nobody resolves). */
export async function setQuoteItemWatchers(id: number, people: Person[]): Promise<QuoteItem> {
  if (USE_MOCK) return mockReplace(id, (i) => ({ ...i, watchers: people.map((p) => ({ ...p })) }));
  const resolved = await resolveQuotePeople(people);
  requireSomeResolved(people, resolved, "Watchers");
  return patchItemColumns(id, multiPersonField("Watchers", resolved));
}

async function rewriteItemCommunication(id: number, change: (raw: string) => string): Promise<QuoteItem> {
  const listId = requireListId("comment on a component");
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
  return readItem(listId, id);
}

export async function addQuoteItemComment(id: number, comment: QuoteCommentInput): Promise<QuoteItem> {
  const timestamp = new Date();
  if (USE_MOCK) {
    return mockReplace(id, (i) => ({
      ...i,
      comments: [{ ...comment, timestamp, attachments: [] }, ...i.comments],
    }));
  }
  return rewriteItemCommunication(id, (raw) => appendComment(raw, { ...comment, timestamp }));
}

export async function editQuoteItemComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<QuoteItem> {
  if (USE_MOCK) {
    return mockReplace(id, (i) => ({
      ...i,
      comments: i.comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        c.authorEmail.toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
    }));
  }
  return rewriteItemCommunication(id, (raw) => replaceComment(raw, target, newBodyHtml));
}
