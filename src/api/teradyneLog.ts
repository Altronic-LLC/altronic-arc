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
  toLookupId,
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
//
// SCALE. Legacy history was imported in 2026, taking the list past 16,000 rows,
// and it keeps growing. Nearly all of that is historical: the app is for the
// current year's work, and the legacy rows are read directly in SharePoint for
// reporting. So the log is fetched ONE YEAR AT A TIME, filtered server-side —
// pulling 16k rows over ~18 sequential pages to then throw most of them away
// was both slow and pointless.
//
// That server-side filter needs the `EnterDate` column INDEXED in SharePoint:
// above 5,000 items, SharePoint refuses to filter or sort on an unindexed
// column regardless of how few rows match. If the filtered request fails for
// any reason (no index, or a filter syntax the tenant rejects), we fall back to
// fetching everything and filtering in the browser — correct, just slow — and
// report `filteredServerSide: false` so the UI can say why it's crawling
// instead of leaving it a mystery.
// =============================================================================

const LOG_SELECT =
  "Title,EnterDate,DefectiveParts,NumberOfBoards,BoardsTested,FailuresPerBoard," +
  "SAPNumber,OldSAPNumber,OperatorNotes,ProductLookupId,Employee1LookupId," +
  "Employee2LookupId,RemarkLookupId,Employee1Clock,Employee2Clock";

/** Which slice of the log to load. Default everywhere is the current year. */
export type TeradyneLogScope = { kind: "year"; year: number } | { kind: "all" };

export const CURRENT_YEAR_SCOPE = (): TeradyneLogScope => ({
  kind: "year",
  year: new Date().getFullYear(),
});

export interface TeradyneLogResult {
  entries: TeradyneLogEntry[];
  /**
   * False when SharePoint wouldn't apply the year filter and we had to fetch
   * the whole list and filter locally — the signal that `EnterDate` needs an
   * index. Always true in mock mode and for the "all" scope (nothing to filter).
   */
  filteredServerSide: boolean;
  /** Raw rows fetched, so the UI can show what the fallback actually cost. */
  fetchedRows: number;
  /**
   * Why the server-side filter was refused, when it was. Surfaced in the UI:
   * "SharePoint said no" is only actionable if you can see what it said.
   */
  filterError?: string;
}

let mockStore: TeradyneLogEntry[] = MOCK_TERADYNE_LOG.map((e) => ({ ...e }));

/**
 * Set once SharePoint has refused the date filter, so we don't re-try a request
 * we know will fail on every subsequent load. Module-level = per page session;
 * a reload re-tests it, which is what you want after someone adds the index.
 */
let serverFilterUnavailable = false;

/** Test seam — resets the session memo above. */
export function resetTeradyneFilterProbe() {
  serverFilterUnavailable = false;
}

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** True when the entry falls inside the scope. Used by the mock + fallback paths. */
export function entryInScope(entry: TeradyneLogEntry, scope: TeradyneLogScope): boolean {
  if (scope.kind === "all") return true;
  // Undated rows belong to no year — they'd otherwise vanish entirely, so they
  // show in the current year's view where someone can notice and fix them.
  if (!entry.enterDate) return scope.year === new Date().getFullYear();
  return entry.enterDate.getUTCFullYear() === scope.year;
}

/**
 * The filter forms to try, in order, before giving up and filtering locally.
 *
 * Graph is OData v4, where a DateTimeOffset literal is written BARE
 * (`ge 2026-01-01T00:00:00Z`). Quoting it makes it a string literal and the
 * comparison is rejected as a type mismatch — which is exactly what bit us
 * first time round: the log fell back to downloading all 2,926 rows on a list
 * well under SharePoint's 5,000-item threshold, so the index was never the
 * problem. The quoted form is kept as a second attempt because some SharePoint
 * columns surfaced through Graph do behave like text.
 */
export function scopeFilterVariants(scope: TeradyneLogScope): string[] {
  if (scope.kind === "all") return [];
  const from = `${scope.year}-01-01T00:00:00Z`;
  const to = `${scope.year + 1}-01-01T00:00:00Z`;
  return [
    `fields/EnterDate ge ${from} and fields/EnterDate lt ${to}`,
    `fields/EnterDate ge '${from}' and fields/EnterDate lt '${to}'`,
  ];
}

/**
 * Encode a filter for the query string WITHOUT mangling OData literal syntax.
 *
 * `encodeURIComponent` would turn the colons in a bare datetime into `%3A`,
 * which some OData parsers reject. Only spaces and `#` actually need escaping
 * here; `'`, `:` and `-` are all legal in a query value.
 */
export function encodeFilter(filter: string): string {
  return filter.replace(/ /g, "%20").replace(/#/g, "%23");
}

/**
 * Log entries for one scope, newest Enter Date first, lookups resolved to titles.
 *
 * @param scope Defaults to the current year — see the SCALE note above.
 */
export async function listTeradyneLog(
  scope: TeradyneLogScope = CURRENT_YEAR_SCOPE(),
): Promise<TeradyneLogResult> {
  if (USE_MOCK) {
    const entries = [...mockStore]
      .filter((e) => entryInScope(e, scope))
      .sort(compareTeradyneLogEntries)
      .map((e) => ({ ...e }));
    return delay({ entries, filteredServerSide: true, fetchedRows: entries.length });
  }

  const base = `/sites/${SITES.pmo}/lists/${SP_TERADYNE_LOG_LIST_ID}/items`;
  // $top=999 is Graph's max page size, so a normal year is one request.
  const query = `?$expand=fields($select=${LOG_SELECT})&$top=999`;
  const variants = scopeFilterVariants(scope);

  // Reference lists first — needed for the join either way, and they're cheap.
  const [products, employees, remarks] = await Promise.all([
    listTeradyneRefs("products") as Promise<TeradyneProduct[]>,
    listTeradyneRefs("employees") as Promise<TeradyneEmployee[]>,
    listTeradyneRefs("remarks") as Promise<TeradyneRemark[]>,
  ]);
  const maps = buildTeradyneRefMaps(products, employees, remarks);

  const build = (items: GraphListItem[]) =>
    items.map((item) => toTeradyneLogEntry(item, maps)).sort(compareTeradyneLogEntries);

  let lastError: string | undefined;
  for (const filter of serverFilterUnavailable ? [] : variants) {
    try {
      const items = await graphFetchAll<GraphListItem>(
        `${base}${query}&$filter=${encodeFilter(filter)}`,
      );
      return { entries: build(items), filteredServerSide: true, fetchedRows: items.length };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      /* eslint-disable-next-line no-console */
      console.warn(`[Teradyne] EnterDate filter rejected: ${filter}`, err);
    }
  }

  if (variants.length > 0 && !serverFilterUnavailable) {
    // Remember for the rest of the session. Whatever the reason (unindexed
    // column above the 5,000-item threshold being the usual one), it won't
    // change between two page loads — so stop paying a doomed request every
    // time and go straight to the local filter.
    serverFilterUnavailable = true;
    /* eslint-disable-next-line no-console */
    console.warn(
      "[Teradyne] No server-side date filter worked; fetching the whole list and filtering " +
        "in the browser for the rest of this session. Indexing EnterDate on the list makes " +
        "this a single request instead of one per 999 rows.",
    );
  }

  const items = await graphFetchAll<GraphListItem>(`${base}${query}`);
  const all = build(items);
  return {
    entries: all.filter((e) => entryInScope(e, scope)),
    filteredServerSide: variants.length === 0,
    fetchedRows: items.length,
    filterError: lastError,
  };
}

/**
 * Lookup-usage counts across the WHOLE log, every year.
 *
 * Separate from `listTeradyneLog` on purpose. The reference-list screens use
 * this to decide whether a row can be deleted, and that question spans all
 * history: a product referenced only by 2019 rows is still in use, and deleting
 * it would break rows that SharePoint reporting depends on. Scoping the guard
 * to the current year would quietly make it wrong.
 *
 * It's affordable because it selects only the four lookup id columns — no
 * titles, notes, or numbers — so even 16k+ rows is a small payload, and it's
 * only fetched on the manage screens.
 */
export interface TeradyneLookupUsage {
  products: Map<number, number>;
  employees: Map<number, number>;
  remarks: Map<number, number>;
}

export async function listTeradyneLookupUsage(): Promise<TeradyneLookupUsage> {
  const usage: TeradyneLookupUsage = {
    products: new Map(),
    employees: new Map(),
    remarks: new Map(),
  };
  const bump = (map: Map<number, number>, id: number | null) => {
    if (id === null) return;
    map.set(id, (map.get(id) ?? 0) + 1);
  };

  if (USE_MOCK) {
    for (const e of mockStore) {
      bump(usage.products, e.product?.lookupId ?? null);
      bump(usage.remarks, e.remark?.lookupId ?? null);
      // An employee counts once per entry even when they hold both slots.
      const empIds = new Set(
        [e.employee1?.lookupId, e.employee2?.lookupId].filter((x): x is number => x != null),
      );
      empIds.forEach((id) => bump(usage.employees, id));
    }
    return delay(usage);
  }

  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${SP_TERADYNE_LOG_LIST_ID}/items` +
      `?$expand=fields($select=ProductLookupId,Employee1LookupId,Employee2LookupId,RemarkLookupId)` +
      `&$top=999`,
  );

  for (const item of items) {
    const f = item.fields as Record<string, unknown>;
    bump(usage.products, toLookupId(f.ProductLookupId));
    bump(usage.remarks, toLookupId(f.RemarkLookupId));
    const empIds = new Set(
      [toLookupId(f.Employee1LookupId), toLookupId(f.Employee2LookupId)].filter(
        (x): x is number => x != null,
      ),
    );
    empIds.forEach((id) => bump(usage.employees, id));
  }
  return usage;
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
    OldSAPNumber: input.altronicPartNumber.trim(),
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
    altronicPartNumber: "",
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
    altronicPartNumber: input.altronicPartNumber.trim(),
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
