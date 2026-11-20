import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PRICING_HISTORY_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { PricingHistoryEntry, PricingHistoryRecord } from "@/types/pricing";
import { PRICING_HISTORY_SELECT, toPricingHistoryRecord } from "@/lib/pricingMapper";
import { appendPricingHistory, parsePricingHistory, HistoryUnreadableError } from "@/lib/pricingHistory";
import { nextPricingMockId, pricingMockClone, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// Pricing History — how each request was priced. MANAGERS AND ADMINS ONLY:
// the list's own permissions keep requesters out, which is the real boundary
// for cost and margin.
//
// One row per request (Title = its PR number, unique; RequestRef = the
// request). The latest pricing is written as real columns, so SharePoint's
// own views can show it; EVERY pricing is in `History`, a JSON array that is
// only ever APPENDED to (lib/pricingHistory.ts) — re-read fresh before each
// write, and never written over when it can't be parsed.
//
// The list is small (one row per priced request), so it is read whole and
// matched in the browser rather than filtered on the lookup.
// =============================================================================

function listPath(): string {
  return `/sites/${SITES.salesTeam}/lists/${SP_PRICING_HISTORY_LIST_ID}/items`;
}

/** Every pricing record. */
export async function listPricingHistory(): Promise<PricingHistoryRecord[]> {
  if (USE_MOCK) return mockDelay(pricingMockClone(pricingMockDb.history));
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$expand=fields($select=${PRICING_HISTORY_SELECT})&$top=999`,
  );
  return items.map(toPricingHistoryRecord);
}

/** The record for one request, or null when it has never been priced. */
export async function getPricingHistoryForRequest(requestId: number): Promise<PricingHistoryRecord | null> {
  const all = await listPricingHistory();
  return all.find((r) => r.requestId === requestId) ?? null;
}

/** The current columns written alongside a new entry — the entry's own figures. */
function currentColumns(entry: PricingHistoryEntry): Record<string, unknown> {
  return {
    Cost: entry.cost,
    CostSource: entry.costSource,
    DistributorDiscountPct: entry.distributorDiscountPct,
    DiscountSource: entry.discountSource,
    TargetGM: entry.input.kind === "gm" ? entry.input.value : null,
    ListPrice: entry.listPrice,
    BaseGM: entry.baseGM,
    CustomerGM: entry.customerGM,
    Mpg: entry.mpg?.key ?? "",
    MpgAvgGM: entry.mpg?.averageGM ?? null,
    MpgCount: entry.mpg?.counted ?? null,
    FamilyPrefix: entry.family?.key ?? "",
    FamilyAvgGM: entry.family?.averageGM ?? null,
    FamilyCount: entry.family?.counted ?? null,
    PricingNote: entry.note,
  };
}

/**
 * Record one pricing of a request: create its row on the first pricing,
 * append to `History` on every later one. Throws `HistoryUnreadableError`
 * rather than replacing a History value it couldn't parse.
 */
export async function recordPricing(
  request: { id: number; requestNumber: string },
  entry: PricingHistoryEntry,
): Promise<PricingHistoryRecord> {
  if (USE_MOCK) {
    const existing = pricingMockDb.history.find((r) => r.requestId === request.id);
    const cols = currentColumns(entry);
    const fromCols = {
      cost: entry.cost,
      costSource: entry.costSource,
      distributorDiscountPct: entry.distributorDiscountPct,
      discountSource: entry.discountSource,
      targetGM: cols.TargetGM as number | null,
      listPrice: entry.listPrice,
      baseGM: entry.baseGM,
      customerGM: entry.customerGM,
      mpg: entry.mpg?.key ?? "",
      mpgAvgGM: entry.mpg?.averageGM ?? null,
      mpgCount: entry.mpg?.counted ?? null,
      familyPrefix: entry.family?.key ?? "",
      familyAvgGM: entry.family?.averageGM ?? null,
      familyCount: entry.family?.counted ?? null,
      pricingNote: entry.note,
    };
    if (existing) {
      if (existing.historyCorrupt) throw new HistoryUnreadableError("price");
      Object.assign(existing, fromCols, { history: [...existing.history, entry] });
      return mockDelay(pricingMockClone(existing));
    }
    const row: PricingHistoryRecord = {
      id: nextPricingMockId(pricingMockDb.history),
      requestNumber: request.requestNumber,
      requestId: request.id,
      ...fromCols,
      history: [entry],
      historyCorrupt: false,
    };
    pricingMockDb.history.push(row);
    return mockDelay(pricingMockClone(row));
  }

  // FRESH read — the cache can be minutes old, and appending to a stale copy
  // would drop a pricing somebody else recorded in between.
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$expand=fields($select=${PRICING_HISTORY_SELECT})&$top=999`,
  );
  const existing = items.find((i) => toPricingHistoryRecord(i).requestId === request.id);

  if (!existing) {
    const created = await graphFetch<GraphListItem>(listPath(), {
      method: "POST",
      body: JSON.stringify({
        fields: {
          Title: request.requestNumber,
          // A SINGLE lookup — a bare integer.
          RequestRefLookupId: request.id,
          ...currentColumns(entry),
          History: JSON.stringify([entry]),
        },
      }),
    });
    return toPricingHistoryRecord(created);
  }

  const raw = existing.fields?.History;
  if (parsePricingHistory(raw).corrupt) throw new HistoryUnreadableError("price");
  await graphFetch(`${listPath()}/${existing.id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ ...currentColumns(entry), History: appendPricingHistory(raw, entry) }),
  });
  const fresh = await graphFetch<GraphListItem>(
    `${listPath()}/${existing.id}?$expand=fields($select=${PRICING_HISTORY_SELECT})`,
  );
  return toPricingHistoryRecord(fresh);
}
