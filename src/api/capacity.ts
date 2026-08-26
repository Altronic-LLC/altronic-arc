import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_CAPACITY_LIST_ID, USE_MOCK } from "./config";
import type { CapacityEntry, CapacityInput, GraphListItem } from "@/types/task";
import { buildCapacityFields, compareCapacityEntries, toCapacityEntry } from "@/lib/capacityMapper";
import { MOCK_CAPACITY } from "@/data/crmMockData";

// =============================================================================
// "Capacity" — a per-part weekly production capacity commitment to a
// customer, on the salesOrderEntry site. A small list (5 rows at discovery);
// fetched whole and scoped to one customer client-side.
// =============================================================================

let mockStore: CapacityEntry[] = MOCK_CAPACITY.map((e) => ({ ...e }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_CAPACITY_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_CAPACITY_LIST_ID is not set.`);
  }
  return SP_CAPACITY_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.salesOrderEntry}/lists/${requireListId("reach the capacity entry")}/items/${id}`;
}

const SELECT = "Title,CustomerLookupId,Description,WeeklyMax,Notes,CustomerP_x002f_N";

export async function listCapacity(): Promise<CapacityEntry[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareCapacityEntries).map((e) => ({ ...e })));
  }
  const listId = requireListId("load capacity");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.salesOrderEntry}/lists/${listId}/items?$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toCapacityEntry).sort(compareCapacityEntries);
}

export async function createCapacity(input: CapacityInput): Promise<CapacityEntry> {
  if (USE_MOCK) {
    const entry: CapacityEntry = {
      id: Math.max(0, ...mockStore.map((e) => e.id)) + 1,
      partNumber: input.partNumber.trim(),
      customerId: input.customerId,
      description: input.description.trim(),
      weeklyMax: input.weeklyMax,
      notes: input.notes.trim(),
      customerPartNumber: input.customerPartNumber.trim(),
    };
    mockStore = [entry, ...mockStore];
    return delay(entry);
  }
  const listId = requireListId("create the capacity entry");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.salesOrderEntry}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildCapacityFields(input) }) },
  );
  return toCapacityEntry(created);
}

export async function updateCapacity(
  id: number,
  changed: Partial<CapacityInput>,
): Promise<CapacityEntry> {
  const fields = buildCapacityFields(changed);
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`Capacity entry ${id} not found`);
    const next: CapacityEntry = { ...mockStore[idx], ...changed };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const item = await graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${SELECT})`);
  return toCapacityEntry(item);
}

export async function deleteCapacity(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    return delay(undefined);
  }
  await graphFetch(itemPath(id), { method: "DELETE" });
}
