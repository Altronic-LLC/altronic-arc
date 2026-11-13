import { graphFetch, graphFetchAll } from "./graph";
import { SITES, USE_MOCK } from "./config";
import type { GraphListItem } from "@/types/task";
import {
  buildQcFormFields,
  compareQcFormRecords,
  qcNounTitle,
  toQcFormRecord,
  type QcFormRecord,
  type QcFormSpec,
  type QcValues,
} from "@/lib/qcFormEngine";
import { MOCK_QC_CPU95_RECORDS } from "@/data/qcCpu95MockData";
import { MOCK_QC_GET1_RECORDS } from "@/data/qcGet1MockData";
import { MOCK_QC_SERIES_X_RECORDS } from "@/data/qcSeriesXMockData";
import { QC_FORM_LISTS } from "./qcFormLists";
import { mockDelay } from "./mockLatency";

// =============================================================================
// QC Forms — every form's test sheets, one SharePoint list per form
// (api/qcFormLists.ts). The form's spec (lib/qcForms.ts) says which columns
// exist and how each is read and written; this module only moves rows.
//
// Any signed-in user can create or edit a sheet; there is no admin gate, same
// openness as Test Sheets and QC Time Tracking. No delete — each row is a
// signed, dated test record (Final Test By / Final Inspection By), the same
// "correct with an edit" call as FAIT and Visit Reports.
//
// NO `$select`. The old Engineering-site CPU-95 list's ~230 columns made a
// fully-named $select run the URL up near 5,000 characters, which came back
// 404 "UnknownError" with no rows (found live, 2026-09-17). `toQcFormRecord`
// only reads the columns the form declares, so fetching every field costs a
// bigger response, never a wrong one.
// =============================================================================

/** Each form's demo rows. A form with none starts empty in the demo. */
const MOCK_FIXTURES: Record<string, readonly QcFormRecord[]> = {
  "cpu-95": MOCK_QC_CPU95_RECORDS,
  "get-1": MOCK_QC_GET1_RECORDS,
  "series-x": MOCK_QC_SERIES_X_RECORDS,
};

const copy = (r: QcFormRecord): QcFormRecord => ({ ...r, values: { ...r.values } });

let mockStores = new Map<string, QcFormRecord[]>();

function mockStore(spec: QcFormSpec): QcFormRecord[] {
  let store = mockStores.get(spec.id);
  if (!store) {
    store = (MOCK_FIXTURES[spec.id] ?? []).map(copy);
    mockStores.set(spec.id, store);
  }
  return store;
}

function listPath(spec: QcFormSpec, action: string): string {
  const list = QC_FORM_LISTS[spec.id];
  if (!list) throw new Error(`Cannot ${action}: the ${spec.formNumber} list isn't registered in api/qcFormLists.ts.`);
  if (!list.listId) throw new Error(`Cannot ${action}: ${list.envVar} is not set.`);
  return `/sites/${SITES[list.site]}/lists/${list.listId}`;
}

const many = (spec: QcFormSpec) => `${spec.shortName} ${spec.noun}s`;

/** Every sheet for a form, newest tested first. */
export async function listQcFormRecords(spec: QcFormSpec): Promise<QcFormRecord[]> {
  if (USE_MOCK) {
    return mockDelay([...mockStore(spec)].sort(compareQcFormRecords(spec)).map(copy));
  }

  const list = listPath(spec, `load ${many(spec)}`);
  const items = await graphFetchAll<GraphListItem>(`${list}/items?$expand=fields&$top=999`);
  return items.map((item) => toQcFormRecord(spec, item)).sort(compareQcFormRecords(spec));
}

/** One sheet by id, or null when it isn't there. */
export async function getQcFormRecord(spec: QcFormSpec, id: number): Promise<QcFormRecord | null> {
  if (USE_MOCK) {
    const found = mockStore(spec).find((r) => r.id === id);
    return mockDelay(found ? copy(found) : null);
  }

  const list = listPath(spec, `load the ${spec.shortName} ${spec.noun}`);
  try {
    const item = await graphFetch<GraphListItem>(`${list}/items/${id}?$expand=fields`);
    return toQcFormRecord(spec, item);
  } catch {
    return null;
  }
}

export async function createQcFormRecord(spec: QcFormSpec, values: QcValues): Promise<QcFormRecord> {
  if (USE_MOCK) {
    const store = mockStore(spec);
    const now = new Date();
    const record: QcFormRecord = {
      id: Math.max(0, ...store.map((r) => r.id)) + 1,
      values: { ...values },
      createdAt: now,
      modifiedAt: now,
    };
    store.unshift(record);
    return mockDelay(copy(record));
  }

  const list = listPath(spec, `add the ${spec.shortName} ${spec.noun}`);
  const created = await graphFetch<GraphListItem>(`${list}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: buildQcFormFields(spec, values) }),
  });
  // The create response doesn't expand the fields — read the row back so the
  // list renders from the same shape a later refetch would give.
  return (await getQcFormRecord(spec, parseInt(created.id, 10))) ?? toQcFormRecord(spec, created);
}

/** Save the edit form — every field the form declares. */
export async function updateQcFormRecord(spec: QcFormSpec, id: number, values: QcValues): Promise<QcFormRecord> {
  if (USE_MOCK) {
    const store = mockStore(spec);
    const idx = store.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`${qcNounTitle(spec)} ${id} not found`);
    store[idx] = { ...store[idx], values: { ...values }, modifiedAt: new Date() };
    return mockDelay(copy(store[idx]));
  }

  const list = listPath(spec, `save the ${spec.shortName} ${spec.noun}`);
  await graphFetch(`${list}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildQcFormFields(spec, values)),
  });
  const updated = await getQcFormRecord(spec, id);
  if (!updated) throw new Error(`${qcNounTitle(spec)} ${id} disappeared after update`);
  return updated;
}

/** Test seam — restores every form's mock store to the shipped fixtures. */
export function __resetQcFormMockStores(): void {
  mockStores = new Map();
}
