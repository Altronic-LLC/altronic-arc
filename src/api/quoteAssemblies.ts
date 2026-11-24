import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QUOTE_ASSEMBLIES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { QuoteAssembly } from "@/types/quote";
import {
  QUOTE_ASSEMBLY_EUR_COLUMNS,
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
// Quote Assemblies — the LINES on a quote (PMO site), each carrying its final
// material, labor and overhead. No comment thread and no attachments (the
// quote's own Discussion and data package cover them). `QuoteRef` is a SINGLE
// lookup: both halves selected on read, a bare integer on write.
//
// Fetched WHOLE and scoped to a quote in the browser — a few rows per quote,
// and a `$filter` on a lookup needs an index past 5,000 items anyway.
//
// Lines CAN be deleted (section 13): they are the composition of a draft, and
// a new rev preserves what was sent.
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

// The euro-target columns (TargetPriceEur, EurUsdRate) were added after the
// list was live, by scripts/create-quote-lists.ps1. Selecting a column a list
// hasn't got 400s the WHOLE read, which would blank every quote's lines — so
// the read asks for them, and on a 400 only retries without and remembers for
// the session (the MRB Watchers / EIR latest-columns arrangement). A write
// naming them while they're missing is refused, naming the script.
let eurColumnsAvailable: boolean | null = null;

/** Test hook — forget what was learned about the euro columns. */
export function __resetQuoteAssemblyEurColumns(): void {
  eurColumnsAvailable = null;
}

/** Can a line's euro target be stored? False only once a read proved the columns missing. */
export function quoteAssemblyEurColumnsAvailable(): boolean {
  return eurColumnsAvailable !== false;
}

function selectFor(withEur: boolean): string {
  return withEur ? `${QUOTE_ASSEMBLY_SELECT},${QUOTE_ASSEMBLY_EUR_COLUMNS.join(",")}` : QUOTE_ASSEMBLY_SELECT;
}

async function readWithEurFallback<T>(read: (select: string) => Promise<T>): Promise<T> {
  if (eurColumnsAvailable === false) return read(selectFor(false));
  try {
    const result = await read(selectFor(true));
    eurColumnsAvailable = true;
    return result;
  } catch (err) {
    // Only a 400 can mean a missing column, and only on the first read; a
    // throttle or a refusal must never read as "the columns aren't there".
    const missing = err instanceof GraphError && err.status === 400;
    if (eurColumnsAvailable !== null || !missing) throw err;
    const result = await read(selectFor(false));
    eurColumnsAvailable = false;
    return result;
  }
}

function refuseEurWithoutColumns(fields: Record<string, unknown>): void {
  if (eurColumnsAvailable !== false) return;
  if (QUOTE_ASSEMBLY_EUR_COLUMNS.some((c) => c in fields)) {
    throw new Error(
      "The euro target can't be saved yet: the Quote Assemblies list has no TargetPriceEur / EurUsdRate " +
        "columns. Run scripts/create-quote-lists.ps1 to add them, or clear the euro target and enter dollars.",
    );
  }
}

async function readAssembly(listId: string, id: number): Promise<QuoteAssembly> {
  return readWithEurFallback(async (select) =>
    toQuoteAssembly(
      await graphFetch<GraphListItem>(`${listPath(listId)}/${id}?$expand=fields($select=${select})`),
    ),
  );
}

/** Every assembly on every quote, in line order. `[]` when the list isn't configured. */
export async function listQuoteAssemblies(): Promise<QuoteAssembly[]> {
  if (USE_MOCK) return mockDelay([...quoteMockDb.assemblies].sort(compareLines).map(quoteMockClone.assembly));
  if (!SP_QUOTE_ASSEMBLIES_LIST_ID) return [];
  const listId = SP_QUOTE_ASSEMBLIES_LIST_ID;
  const items = await readWithEurFallback((select) =>
    graphFetchAll<GraphListItem>(`${listPath(listId)}?$expand=fields($select=${select})&$top=999`),
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
      materialCost: input.materialCost,
      laborCost: input.laborCost,
      materialOverheadPct: input.materialOverheadPct,
      altronicPartNumber: input.altronicPartNumber.trim(),
      sapPartNumber: input.sapPartNumber.trim(),
      customerPartNumber: input.customerPartNumber.trim(),
      description: input.description,
      priceBreaks: input.priceBreaks.map((b) => ({ ...b })),
      targetGM: input.targetGM,
      manualPrice: input.manualPrice,
      targetPrice: input.targetPrice,
      targetPriceEur: input.targetPriceEur ?? null,
      eurUsdRate: input.targetPriceEur != null ? (input.eurUsdRate ?? null) : null,
      estimatedEau: input.estimatedEau,
      customerPrice: input.customerPrice,
    };
    quoteMockDb.assemblies.push(row);
    return mockDelay(quoteMockClone.assembly(row));
  }
  const listId = requireListId("add an assembly");
  const createFields = buildQuoteAssemblyCreateFields(input);
  refuseEurWithoutColumns(createFields);
  const created = await graphFetch<GraphListItem>(listPath(listId), {
    method: "POST",
    body: JSON.stringify({ fields: createFields }),
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
  refuseEurWithoutColumns(fields);
  await graphFetch(`${listPath(listId)}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  return readAssembly(listId, id);
}

/** Delete a line. A 404 resolves — it's already gone, which is what was asked for. */
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
