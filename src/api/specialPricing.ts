import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_SPECIAL_PRICING_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, SpecialPricingEntry, SpecialPricingInput } from "@/types/task";
import {
  buildSpecialPricingFields,
  compareSpecialPricingEntries,
  toSpecialPricingEntry,
} from "@/lib/specialPricingMapper";
import { MOCK_SPECIAL_PRICING } from "@/data/crmMockData";

// =============================================================================
// "Special Pricing" — a pricing note or agreement tied to a customer, on the
// salesOrderEntry site. A small list (2 rows at discovery); fetched whole and
// scoped to one customer client-side, same pattern as Customer Contacts.
// =============================================================================

let mockStore: SpecialPricingEntry[] = MOCK_SPECIAL_PRICING.map((e) => ({ ...e }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_SPECIAL_PRICING_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_SPECIAL_PRICING_LIST_ID is not set.`);
  }
  return SP_SPECIAL_PRICING_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.salesOrderEntry}/lists/${requireListId("reach the pricing entry")}/items/${id}`;
}

const SELECT = "Title,CustomerLookupId,PricingNotes,AIPartNumber";

export async function listSpecialPricing(): Promise<SpecialPricingEntry[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareSpecialPricingEntries).map((e) => ({ ...e })));
  }
  const listId = requireListId("load special pricing");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.salesOrderEntry}/lists/${listId}/items?$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toSpecialPricingEntry).sort(compareSpecialPricingEntries);
}

export async function createSpecialPricing(
  input: SpecialPricingInput,
): Promise<SpecialPricingEntry> {
  if (USE_MOCK) {
    const entry: SpecialPricingEntry = {
      id: Math.max(0, ...mockStore.map((e) => e.id)) + 1,
      title: input.title.trim(),
      customerId: input.customerId,
      pricingNotes: input.pricingNotes.trim(),
      aiPartNumber: input.aiPartNumber.trim(),
    };
    mockStore = [entry, ...mockStore];
    return delay(entry);
  }
  const listId = requireListId("create the pricing entry");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.salesOrderEntry}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildSpecialPricingFields(input) }) },
  );
  return toSpecialPricingEntry(created);
}

export async function updateSpecialPricing(
  id: number,
  changed: Partial<SpecialPricingInput>,
): Promise<SpecialPricingEntry> {
  const fields = buildSpecialPricingFields(changed);
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`Pricing entry ${id} not found`);
    const next: SpecialPricingEntry = { ...mockStore[idx], ...changed };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const item = await graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${SELECT})`);
  return toSpecialPricingEntry(item);
}

export async function deleteSpecialPricing(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    return delay(undefined);
  }
  await graphFetch(itemPath(id), { method: "DELETE" });
}
