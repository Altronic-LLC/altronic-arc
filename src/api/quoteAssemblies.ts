import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QUOTE_ASSEMBLIES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { QuoteAssembly } from "@/types/quote";
import {
  QUOTE_ASSEMBLY_SELECT,
  applyQuoteAssemblyPatch,
  buildQuoteAssemblyCreateFields,
  buildQuoteAssemblyUpdateFields,
  compareLines,
  toQuoteAssembly,
  type QuoteAssemblyInput,
  type QuoteAssemblyPatch,
} from "@/lib/quoteMapper";
import { nextMockId, quoteMockClone, quoteMockDb } from "@/data/quoteMockData";
import { isNotFound } from "./quotes";

// =============================================================================
// Quote Assemblies — the final assemblies on a quote (PMO site). No comment
// thread and no attachments (decided). `QuoteRef` is a SINGLE lookup: both
// halves selected on read, a bare integer on write.
//
// Fetched WHOLE and scoped to a quote in the browser — a few rows per quote,
// and a `$filter` on a lookup needs an index past 5,000 items anyway.
//
// Assemblies CAN be deleted (section 13): they are the composition of a draft,
// and a new rev preserves what was sent. **The caller deletes the assembly's
// Quote Items FIRST** — SharePoint has no cascade on these lookups, so an
// assembly deleted first leaves its components pointing at nothing, on no
// screen, still counted in nothing.
// =============================================================================

const ENV_VAR = "VITE_SP_QUOTE_ASSEMBLIES_LIST_ID";

function requireListId(action: string): string {
  if (!SP_QUOTE_ASSEMBLIES_LIST_ID) {
    throw new Error(`Cannot ${action}: the Quote Assemblies list isn't configured (${ENV_VAR} is not set).`);
  }
  return SP_QUOTE_ASSEMBLIES_LIST_ID;
}

function listPath(listId: string): string {
  return `/sites/${SITES.pmo}/lists/${listId}/items`;
}

async function readAssembly(listId: string, id: number): Promise<QuoteAssembly> {
  const item = await graphFetch<GraphListItem>(
    `${listPath(listId)}/${id}?$expand=fields($select=${QUOTE_ASSEMBLY_SELECT})`,
  );
  return toQuoteAssembly(item);
}

/** Every assembly on every quote, in line order. `[]` when the list isn't configured. */
export async function listQuoteAssemblies(): Promise<QuoteAssembly[]> {
  if (USE_MOCK) return mockDelay([...quoteMockDb.assemblies].sort(compareLines).map(quoteMockClone.assembly));
  if (!SP_QUOTE_ASSEMBLIES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${listPath(SP_QUOTE_ASSEMBLIES_LIST_ID)}?$expand=fields($select=${QUOTE_ASSEMBLY_SELECT})&$top=999`,
  );
  return items.map(toQuoteAssembly).sort(compareLines);
}

export async function createQuoteAssembly(input: QuoteAssemblyInput): Promise<QuoteAssembly> {
  if (USE_MOCK) {
    const row: QuoteAssembly = {
      id: nextMockId(quoteMockDb.assemblies),
      quoteId: input.quoteId,
      lineNo: input.lineNo,
      quotedQty: input.quotedQty,
      lineType: input.lineType,
      cost: input.cost,
      materialOverheadPct: input.materialOverheadPct,
      altronicPartNumber: input.altronicPartNumber.trim(),
      sapPartNumber: input.sapPartNumber.trim(),
      customerPartNumber: input.customerPartNumber.trim(),
      description: input.description,
      priceBreaks: input.priceBreaks.map((b) => ({ ...b })),
      targetGM: input.targetGM,
      manualPrice: input.manualPrice,
      customerPrice: input.customerPrice,
    };
    quoteMockDb.assemblies.push(row);
    return mockDelay(quoteMockClone.assembly(row));
  }
  const listId = requireListId("add an assembly");
  const created = await graphFetch<GraphListItem>(listPath(listId), {
    method: "POST",
    body: JSON.stringify({ fields: buildQuoteAssemblyCreateFields(input) }),
  });
  return readAssembly(listId, parseInt(created.id, 10));
}

/** DIFFED against `previous` — nothing is sent when nothing changed. */
export async function updateQuoteAssemblyFields(
  id: number,
  changes: QuoteAssemblyPatch,
  previous: QuoteAssembly,
): Promise<QuoteAssembly> {
  if (USE_MOCK) {
    const idx = quoteMockDb.assemblies.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error(`Quote assembly ${id} not found`);
    const next = applyQuoteAssemblyPatch(quoteMockDb.assemblies[idx], changes);
    quoteMockDb.assemblies[idx] = next;
    return mockDelay(quoteMockClone.assembly(next));
  }
  const listId = requireListId("update an assembly");
  const fields = buildQuoteAssemblyUpdateFields(changes, previous);
  if (Object.keys(fields).length === 0) return previous;
  await graphFetch(`${listPath(listId)}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  return readAssembly(listId, id);
}

/**
 * Delete an assembly. A 404 resolves — it's already gone, which is what was
 * asked for. Delete its Quote Items FIRST (see the header).
 */
export async function deleteQuoteAssembly(id: number): Promise<void> {
  if (USE_MOCK) {
    quoteMockDb.assemblies = quoteMockDb.assemblies.filter((a) => a.id !== id);
    await mockDelay(null);
    return;
  }
  const listId = requireListId("delete an assembly");
  await graphFetch(`${listPath(listId)}/${id}`, { method: "DELETE" }).catch((err: unknown) => {
    if (!isNotFound(err)) throw err;
  });
}
