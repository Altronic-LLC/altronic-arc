import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_SUPPLIER_COLD_CALLS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { SupplierColdCall, SupplierColdCallInput } from "@/types/supplierColdCall";
import {
  SUPPLIER_COLD_CALL_SELECT,
  applySupplierColdCallInput,
  buildSupplierColdCallFields,
  compareSupplierColdCalls,
  supplierColdCallProblem,
  toSupplierColdCall,
} from "@/lib/supplierColdCalls";
import { MOCK_SUPPLIER_COLD_CALLS } from "@/data/srmMockData";

// =============================================================================
// SRM Tool — Supplier Cold Call Log, on Altronic_PMO (BusinessIT#79). A small
// list, read whole and searched in the browser.
//
// Anyone signed in adds, edits and DELETES an entry (Tim, 2026-11-24): it is an
// address book of companies we might call one day, not a record of something
// that happened, so a stale entry is simply removed — the Supplier Contacts
// arrangement. SharePoint's own list permissions remain the real boundary.
// =============================================================================

let mockStore: SupplierColdCall[] = clone(MOCK_SUPPLIER_COLD_CALLS);

function clone(rows: SupplierColdCall[]): SupplierColdCall[] {
  return rows.map((r) => ({ ...r, createdBy: r.createdBy ? { ...r.createdBy } : null }));
}

/** For tests: put the mock store back. */
export function __resetSupplierColdCallsMockStore(): void {
  mockStore = clone(MOCK_SUPPLIER_COLD_CALLS);
}

function requireListId(action: string): string {
  if (!SP_SUPPLIER_COLD_CALLS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_SUPPLIER_COLD_CALLS_LIST_ID is not set.`);
  }
  return SP_SUPPLIER_COLD_CALLS_LIST_ID;
}

function itemsPath(action: string): string {
  return `/sites/${SITES.pmo}/lists/${requireListId(action)}/items`;
}

/** Every entry, company A–Z. Empty when the list isn't set up yet. */
export async function listSupplierColdCalls(): Promise<SupplierColdCall[]> {
  if (USE_MOCK) return mockDelay(clone(mockStore).sort(compareSupplierColdCalls));
  if (!SP_SUPPLIER_COLD_CALLS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath("load the cold call log")}?$expand=fields($select=${SUPPLIER_COLD_CALL_SELECT})&$top=999`,
  );
  return items.map(toSupplierColdCall).sort(compareSupplierColdCalls);
}

async function readOne(id: number): Promise<SupplierColdCall> {
  const item = await graphFetch<GraphListItem>(
    `${itemsPath("read the entry")}/${id}?$expand=fields($select=${SUPPLIER_COLD_CALL_SELECT})`,
  );
  return toSupplierColdCall(item);
}

function refuseInvalid(input: SupplierColdCallInput): void {
  const problem = supplierColdCallProblem(input);
  if (problem) throw new Error(problem);
}

export async function createSupplierColdCall(input: SupplierColdCallInput): Promise<SupplierColdCall> {
  refuseInvalid(input);
  if (USE_MOCK) {
    const now = new Date();
    const created = applySupplierColdCallInput(
      {
        id: Math.max(0, ...mockStore.map((c) => c.id)) + 1,
        company: "",
        website: "",
        commodity: "",
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        notes: "",
        createdBy: { displayName: "Demo User", email: "demo.user@altronic-llc.com" },
        createdAt: now,
        modifiedAt: now,
      },
      input,
    );
    mockStore = [...mockStore, created];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add the entry"), {
    method: "POST",
    body: JSON.stringify({ fields: buildSupplierColdCallFields(input) }),
  });
  // Re-read: the POST's answer carries every field, but not always createdBy.
  return readOne(parseInt(created.id, 10));
}

/**
 * Write only what changed since `previous` (the row the edit started from),
 * then re-read the row. Nothing changed → nothing sent, `previous` returned.
 */
export async function updateSupplierColdCall(
  id: number,
  input: SupplierColdCallInput,
  previous: SupplierColdCall,
): Promise<SupplierColdCall> {
  refuseInvalid(input);
  const fields = buildSupplierColdCallFields(input, previous);
  if (Object.keys(fields).length === 0) return { ...previous };

  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error("That entry isn't on the log any more.");
    const next = { ...applySupplierColdCallInput(mockStore[idx], input), modifiedAt: new Date() };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("save the entry")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  return readOne(id);
}

/** Remove an entry. Already gone (a 404) counts as done — that's what was asked for. */
export async function deleteSupplierColdCall(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((c) => c.id !== id);
    return mockDelay(undefined);
  }
  try {
    await graphFetch(`${itemsPath("remove the entry")}/${id}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return;
    throw err;
  }
}
