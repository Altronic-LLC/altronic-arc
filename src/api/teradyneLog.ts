import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_TERADYNE_LOG_LIST_ID, USE_MOCK } from "./config";
import type {
  GraphListItem,
  TeradyneEmployee,
  TeradyneLogEntry,
  TeradyneLogInput,
  TeradyneProduct,
  TeradyneRemark,
} from "@/types/task";
import {
  buildTeradyneLogTitle,
  buildTeradyneRefMaps,
  compareTeradyneLogEntries,
  toSpDateOnly,
  toTeradyneLogEntry,
} from "@/lib/teradyneMapper";
import { listTeradyneRefs } from "./teradyneRefs";
import { MOCK_TERADYNE_LOG } from "@/data/teradyneMockData";

// =============================================================================
// Teradyne Log API — the primary list for the Operations Teradyne app, on the
// PMO site.
//
// The awkward part is reading it. Graph's `expand=fields` returns single-value
// lookups as bare ids (`ProductLookupId: "201"`) with no accompanying
// `LookupValue`, so there is no way to get the product/employee/remark NAMES
// out of the log alone. `listTeradyneLog` therefore fetches the log plus all
// three reference lists in parallel and joins them client-side, handing back
// entries whose lookups are already resolved. This is the same shape of problem
// as `parentProject` on Engineering tasks, solved the same way.
//
// The three reference lists are small (hundreds of rows) and cached separately
// by React Query, so the join costs one extra round of requests on a cold load
// and nothing thereafter.
// =============================================================================

const LOG_SELECT =
  "Title,EnterDate,DefectiveParts,NumberOfBoards,BoardsTested,FailuresPerBoard," +
  "SAPNumber,OldSAPNumber,OperatorNotes,ProductLookupId,Employee1LookupId," +
  "Employee2LookupId,RemarkLookupId,Employee1Clock,Employee2Clock";

let mockStore: TeradyneLogEntry[] = MOCK_TERADYNE_LOG.map((e) => ({ ...e }));

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Every log entry, newest Enter Date first, with lookups resolved to titles. */
export async function listTeradyneLog(): Promise<TeradyneLogEntry[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareTeradyneLogEntries).map((e) => ({ ...e })));
  }

  const path =
    `/sites/${SITES.pmo}/lists/${SP_TERADYNE_LOG_LIST_ID}/items` +
    `?$expand=fields($select=${LOG_SELECT})&$top=500`;

  // All four in parallel — the reference lists don't depend on the log.
  const [items, products, employees, remarks] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listTeradyneRefs("products") as Promise<TeradyneProduct[]>,
    listTeradyneRefs("employees") as Promise<TeradyneEmployee[]>,
    listTeradyneRefs("remarks") as Promise<TeradyneRemark[]>,
  ]);

  const maps = buildTeradyneRefMaps(products, employees, remarks);
  return items.map((item) => toTeradyneLogEntry(item, maps)).sort(compareTeradyneLogEntries);
}

/**
 * Build the SharePoint `fields` payload for a create/update.
 *
 * Single-value lookups take a bare integer under `<Field>LookupId` — NOT the
 * two-key `Collection(Edm.Int32)` shape that multi-value lookups need (see
 * src/lib/graphFields.ts). Clearing one writes `null`.
 *
 * `productTitle` is passed in (rather than looked up here) because the caller
 * already has the reference lists loaded; it exists only to compute `Title`.
 */
export function buildLogWriteFields(
  input: TeradyneLogInput,
  productTitle: string | null,
): Record<string, unknown> {
  return {
    Title: buildTeradyneLogTitle(productTitle, input.defectiveParts),
    EnterDate: toSpDateOnly(input.enterDate),
    DefectiveParts: input.defectiveParts.trim(),
    NumberOfBoards: input.numberOfBoards,
    BoardsTested: input.boardsTested,
    FailuresPerBoard: input.failuresPerBoard,
    SAPNumber: input.sapNumber.trim(),
    OldSAPNumber: input.oldSapNumber.trim(),
    OperatorNotes: input.operatorNotes.trim(),
    ProductLookupId: input.productLookupId,
    Employee1LookupId: input.employee1LookupId,
    Employee2LookupId: input.employee2LookupId,
    RemarkLookupId: input.remarkLookupId,
    Employee1Clock: input.employee1Clock,
    Employee2Clock: input.employee2Clock,
  };
}

/**
 * Resolved titles for the three lookups, so a created/updated entry can be
 * returned fully-formed without a re-read. The views already hold the
 * reference lists, so they pass them straight through.
 */
export interface TeradyneRefTitles {
  productTitle: string | null;
  employee1Title: string | null;
  employee2Title: string | null;
  remarkTitle: string | null;
}

/** A blank entry to overlay an input onto, for paths with nothing to merge into. */
function emptyEntry(id: number): TeradyneLogEntry {
  return {
    id,
    title: "",
    enterDate: null,
    product: null,
    employee1: null,
    employee2: null,
    remark: null,
    employee1Clock: null,
    employee2Clock: null,
    defectiveParts: "",
    numberOfBoards: null,
    boardsTested: null,
    failuresPerBoard: null,
    sapNumber: "",
    oldSapNumber: "",
    operatorNotes: "",
    createdAt: new Date(),
    modifiedAt: new Date(),
  };
}

function applyInput(
  base: TeradyneLogEntry,
  input: TeradyneLogInput,
  titles: TeradyneRefTitles,
): TeradyneLogEntry {
  const mk = (lookupId: number | null, title: string | null) =>
    lookupId === null ? null : { lookupId, title: title ?? `(missing #${lookupId})` };
  return {
    ...base,
    title: buildTeradyneLogTitle(titles.productTitle, input.defectiveParts),
    enterDate: input.enterDate,
    product: mk(input.productLookupId, titles.productTitle),
    employee1: mk(input.employee1LookupId, titles.employee1Title),
    employee2: mk(input.employee2LookupId, titles.employee2Title),
    remark: mk(input.remarkLookupId, titles.remarkTitle),
    employee1Clock: input.employee1Clock,
    employee2Clock: input.employee2Clock,
    defectiveParts: input.defectiveParts.trim(),
    numberOfBoards: input.numberOfBoards,
    boardsTested: input.boardsTested,
    failuresPerBoard: input.failuresPerBoard,
    sapNumber: input.sapNumber.trim(),
    oldSapNumber: input.oldSapNumber.trim(),
    operatorNotes: input.operatorNotes.trim(),
    modifiedAt: new Date(),
  };
}

export async function createTeradyneLogEntry(
  input: TeradyneLogInput,
  titles: TeradyneRefTitles,
): Promise<TeradyneLogEntry> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((e) => e.id)) + 1;
    const created = applyInput(emptyEntry(nextId), input, titles);
    mockStore = [...mockStore, created];
    return delay({ ...created });
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${SP_TERADYNE_LOG_LIST_ID}/items`,
    {
      method: "POST",
      body: JSON.stringify({ fields: buildLogWriteFields(input, titles.productTitle) }),
    },
  );

  // Map the echoed item so id / createdAt are the real ones, then overlay the
  // resolved lookup titles — the POST response returns lookup IDS only, so
  // empty maps here are correct: applyInput supplies every title.
  return applyInput(toTeradyneLogEntry(created, buildTeradyneRefMaps([], [], [])), input, titles);
}

export async function updateTeradyneLogEntry(
  id: number,
  input: TeradyneLogInput,
  titles: TeradyneRefTitles,
): Promise<TeradyneLogEntry> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`Teradyne log entry ${id} not found`);
    const next = applyInput(mockStore[idx], input, titles);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(
    `/sites/${SITES.pmo}/lists/${SP_TERADYNE_LOG_LIST_ID}/items/${id}/fields`,
    {
      method: "PATCH",
      body: JSON.stringify(buildLogWriteFields(input, titles.productTitle)),
    },
  );

  // Return the entry as the caller's input describes it. `createdAt` is the
  // one field a PATCH can't tell us, and the hook's cache patch keeps the
  // already-loaded value, so a placeholder here is never what the UI shows.
  return applyInput(emptyEntry(id), input, titles);
}

export async function deleteTeradyneLogEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    await delay(null);
    return;
  }

  await graphFetch(`/sites/${SITES.pmo}/lists/${SP_TERADYNE_LOG_LIST_ID}/items/${id}`, {
    method: "DELETE",
  });
}
