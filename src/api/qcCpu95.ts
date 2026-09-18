import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QC_CPU95_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, QcCpu95Record } from "@/types/task";
import { buildQcCpu95Fields, compareQcCpu95Records, toQcCpu95Record } from "@/lib/qcCpu95Mapper";
import { MOCK_QC_CPU95_RECORDS } from "@/data/qcCpu95MockData";

// =============================================================================
// QCFRM-012 (CPU-95) — Engineering site.
//
// Any signed-in user can create or edit a test sheet; there is no admin gate,
// same openness as Test Sheets and QC Time Tracking. No delete — each row is
// a signed, dated test record (Final Test By / Final Inspection By), the same
// "correct with an edit" call as FAIT and Visit Reports.
//
// NO `$select` — see the header comment in lib/qcCpu95Fields.ts. This list's
// ~200 columns make a fully-named $select run the request URL up near 5,000
// characters, which came back 404 "UnknownError" with no rows rather than a
// clean error (found live, 2026-09-17). `toQcCpu95Record` only reads the
// columns it knows about, so fetching every field costs a bigger response,
// never a wrong one.
// =============================================================================

let mockStore: QcCpu95Record[] = MOCK_QC_CPU95_RECORDS.map((r) => ({ ...r, values: { ...r.values } }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_QC_CPU95_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_QC_CPU95_LIST_ID is not set.`);
  }
  return SP_QC_CPU95_LIST_ID;
}

/** Every CPU-95 test sheet, newest tested first. */
export async function listQcCpu95Records(): Promise<QcCpu95Record[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareQcCpu95Records).map((r) => ({ ...r, values: { ...r.values } })));
  }

  const listId = requireListId("load CPU-95 test sheets");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items?$expand=fields&$top=999`,
  );
  return items.map(toQcCpu95Record).sort(compareQcCpu95Records);
}

/** One test sheet by id, or null when it isn't there. */
export async function getQcCpu95Record(id: number): Promise<QcCpu95Record | null> {
  if (USE_MOCK) {
    const found = mockStore.find((r) => r.id === id);
    return delay(found ? { ...found, values: { ...found.values } } : null);
  }

  const listId = requireListId("load the CPU-95 test sheet");
  try {
    const item = await graphFetch<GraphListItem>(
      `/sites/${SITES.engineering}/lists/${listId}/items/${id}?$expand=fields`,
    );
    return toQcCpu95Record(item);
  } catch {
    return null;
  }
}

export async function createQcCpu95Record(values: Record<string, string>): Promise<QcCpu95Record> {
  if (USE_MOCK) {
    const now = new Date();
    const record: QcCpu95Record = {
      id: Math.max(0, ...mockStore.map((r) => r.id)) + 1,
      values: { ...values },
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [record, ...mockStore];
    return delay(record);
  }

  const listId = requireListId("add the CPU-95 test sheet");
  const created = await graphFetch<GraphListItem>(`/sites/${SITES.engineering}/lists/${listId}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: buildQcCpu95Fields(values) }),
  });
  // The create response doesn't expand the fields we selected — read the row
  // back so the list renders from the same shape a later refetch would give.
  return (await getQcCpu95Record(parseInt(created.id, 10))) ?? toQcCpu95Record(created);
}

/** Save the edit form — every field it holds. No column here has a fixed choice list to be rejected by, so a full resend is always safe. */
export async function updateQcCpu95Record(
  id: number,
  values: Record<string, string>,
): Promise<QcCpu95Record> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`CPU-95 test sheet ${id} not found`);
    const next: QcCpu95Record = { ...mockStore[idx], values: { ...values }, modifiedAt: new Date() };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(next);
  }

  const listId = requireListId("save the CPU-95 test sheet");
  await graphFetch(`/sites/${SITES.engineering}/lists/${listId}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildQcCpu95Fields(values)),
  });
  const updated = await getQcCpu95Record(id);
  if (!updated) throw new Error(`CPU-95 test sheet ${id} disappeared after update`);
  return updated;
}

/** Test seam — restores the mock store to the shipped fixtures. */
export function __resetQcCpu95MockStore(): void {
  mockStore = MOCK_QC_CPU95_RECORDS.map((r) => ({ ...r, values: { ...r.values } }));
}
