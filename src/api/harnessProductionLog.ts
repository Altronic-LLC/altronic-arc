import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_HARNESS_PRODUCTION_LOG_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, HarnessLogEntry, HarnessLogInput } from "@/types/task";
import {
  buildHarnessLogTitle,
  compareHarnessLogEntries,
  normaliseHarnessInput,
  toHarnessLogEntry,
} from "@/lib/harnessLogMapper";
import { parseSpDateOnly, toSpDateOnly } from "@/lib/spDates";
import { encodeFilter } from "./teradyneLog";
import { listHarnessPartNumbers } from "./harnessPartNumbers";
import { MOCK_HARNESS_LOG } from "@/data/harnessMockData";
import { mockDelay } from "./mockLatency";

// =============================================================================
// Harness Production Log — one row per harness build, on the PMO site.
// Replaces an Access database on a production PC.
//
// Read ONE YEAR AT A TIME, exactly like the Teradyne Log and for the same
// reason: the import lands ~22,000 rows, past SharePoint's 5,000-item
// threshold, and almost all of it is history. `ProductionDate` is INDEXED by
// scripts/create-harness-production-lists.ps1, which is what lets SharePoint
// filter on it at that size. If it refuses anyway, the whole list is fetched
// and filtered in the browser — correct, just slower — and the refusal is
// remembered for the page session so a doomed request isn't repeated.
//
// `PartNumber` is a SINGLE lookup into Harness Part Numbers: Graph returns a
// bare `PartNumberLookupId` with no title, so the part list is read alongside
// and joined here, and a write is a bare integer — never `multiLookupField`'s
// `Collection(Edm.Int32)` shape, which 400s a single lookup.
//
// `DataQualityNotes` and `LegacySource` belong to the import. They are read,
// never written: an edit in ARC must not erase the record of what the import
// changed.
// =============================================================================

const LOG_SELECT =
  "Title,ProductionDate,WorkOrder,PartNumberLookupId,Quantity,ReworkQuantity," +
  "Comments,BuiltBy,VisualCheck,DataQualityNotes";

export type HarnessLogScope = { kind: "year"; year: number } | { kind: "all" };

export const CURRENT_HARNESS_YEAR = (): HarnessLogScope => ({
  kind: "year",
  year: new Date().getFullYear(),
});

export interface HarnessLogResult {
  entries: HarnessLogEntry[];
  /** False when SharePoint wouldn't filter by year and the browser did it. */
  filteredServerSide: boolean;
  fetchedRows: number;
}

let mockStore: HarnessLogEntry[] = MOCK_HARNESS_LOG.map((e) => ({ ...e }));
let serverFilterUnavailable = false;

/** Test seams. */
export function resetHarnessLogMockStore(): void {
  mockStore = MOCK_HARNESS_LOG.map((e) => ({ ...e }));
}
export function resetHarnessFilterProbe(): void {
  serverFilterUnavailable = false;
}

export function harnessEntryInScope(entry: HarnessLogEntry, scope: HarnessLogScope): boolean {
  if (scope.kind === "all") return true;
  // Undated rows show in the current year, where somebody can notice and fix
  // them — otherwise they'd belong to no year and vanish.
  if (!entry.productionDate) return scope.year === new Date().getFullYear();
  return entry.productionDate.getUTCFullYear() === scope.year;
}

/** Bare DateTimeOffset literal first (OData v4), quoted second — see teradyneLog.ts. */
export function harnessScopeFilters(scope: HarnessLogScope): string[] {
  if (scope.kind === "all") return [];
  const from = `${scope.year}-01-01T00:00:00Z`;
  const to = `${scope.year + 1}-01-01T00:00:00Z`;
  return [
    `fields/ProductionDate ge ${from} and fields/ProductionDate lt ${to}`,
    `fields/ProductionDate ge '${from}' and fields/ProductionDate lt '${to}'`,
  ];
}

function itemsPath(action: string): string {
  if (!SP_HARNESS_PRODUCTION_LOG_LIST_ID) {
    throw new Error(`Cannot ${action}: the Harness Production Log list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_HARNESS_PRODUCTION_LOG_LIST_ID}/items`;
}

/** One scope of the log, newest first, part numbers resolved. */
export async function listHarnessLog(
  scope: HarnessLogScope = CURRENT_HARNESS_YEAR(),
): Promise<HarnessLogResult> {
  if (USE_MOCK) {
    const entries = mockStore
      .filter((e) => harnessEntryInScope(e, scope))
      .sort(compareHarnessLogEntries)
      .map((e) => ({ ...e }));
    return mockDelay({ entries, filteredServerSide: true, fetchedRows: entries.length });
  }

  const base = itemsPath("read the Harness Production Log");
  const query = `?$expand=fields($select=${LOG_SELECT})&$top=999`;
  const parts = await listHarnessPartNumbers();
  const titles = new Map(parts.map((p) => [p.lookupId, p.title]));
  const build = (items: GraphListItem[]) =>
    items.map((i) => toHarnessLogEntry(i, titles)).sort(compareHarnessLogEntries);

  const variants = harnessScopeFilters(scope);
  for (const filter of serverFilterUnavailable ? [] : variants) {
    try {
      const items = await graphFetchAll<GraphListItem>(`${base}${query}&$filter=${encodeFilter(filter)}`);
      return { entries: build(items), filteredServerSide: true, fetchedRows: items.length };
    } catch (err) {
      /* eslint-disable-next-line no-console */
      console.warn(`[Harness] ProductionDate filter rejected: ${filter}`, err);
    }
  }
  if (variants.length > 0) serverFilterUnavailable = true;

  const items = await graphFetchAll<GraphListItem>(`${base}${query}`);
  return {
    entries: build(items).filter((e) => harnessEntryInScope(e, scope)),
    filteredServerSide: variants.length === 0,
    fetchedRows: items.length,
  };
}

/**
 * Input → fields. `partTitle` is passed in (the caller already has the part
 * list) so the derived Title can be built without a re-read.
 */
export function buildHarnessLogFields(
  input: HarnessLogInput,
  partTitle: string | null,
): Record<string, unknown> {
  const n = normaliseHarnessInput(input);
  return {
    Title: buildHarnessLogTitle(partTitle, n.workOrder),
    ProductionDate: toSpDateOnly(n.productionDate),
    WorkOrder: n.workOrder,
    // A bare integer: PartNumber is a SINGLE lookup. null clears it.
    PartNumberLookupId: n.partLookupId,
    Quantity: n.quantity,
    ReworkQuantity: n.reworkQuantity,
    Comments: n.comments,
    BuiltBy: n.builtBy,
    VisualCheck: n.visualCheck,
  };
}

function mockEntry(id: number, input: HarnessLogInput, partTitle: string | null, prev?: HarnessLogEntry): HarnessLogEntry {
  const n = normaliseHarnessInput(input);
  const now = new Date();
  return {
    id,
    title: buildHarnessLogTitle(partTitle, n.workOrder),
    productionDate: n.productionDate,
    workOrder: n.workOrder,
    part: n.partLookupId === null ? null : { lookupId: n.partLookupId, title: partTitle ?? `(missing #${n.partLookupId})` },
    quantity: n.quantity,
    reworkQuantity: n.reworkQuantity,
    comments: n.comments,
    builtBy: n.builtBy,
    visualCheck: n.visualCheck,
    dataQualityNotes: prev?.dataQualityNotes ?? "",
    createdAt: prev?.createdAt ?? now,
    modifiedAt: now,
  };
}

async function readBack(id: number): Promise<HarnessLogEntry> {
  const [item, parts] = await Promise.all([
    graphFetch<GraphListItem>(`${itemsPath("read an entry")}/${id}?$expand=fields($select=${LOG_SELECT})`),
    listHarnessPartNumbers(),
  ]);
  return toHarnessLogEntry(item, new Map(parts.map((p) => [p.lookupId, p.title])));
}

export async function createHarnessLogEntry(
  input: HarnessLogInput,
  partTitle: string | null,
): Promise<HarnessLogEntry> {
  if (USE_MOCK) {
    const created = mockEntry(Math.max(0, ...mockStore.map((e) => e.id)) + 1, input, partTitle);
    mockStore = [created, ...mockStore];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add an entry"), {
    method: "POST",
    body: JSON.stringify({ fields: buildHarnessLogFields(input, partTitle) }),
  });
  return readBack(parseInt(created.id, 10));
}

export async function updateHarnessLogEntry(
  id: number,
  input: HarnessLogInput,
  partTitle: string | null,
): Promise<HarnessLogEntry> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`Entry ${id} not found`);
    const next = mockEntry(id, input, partTitle, mockStore[idx]);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("save an entry")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildHarnessLogFields(input, partTitle)),
  });
  return readBack(id);
}

/** Admin-only — the gate is in `useDeleteHarnessLogEntry`'s mutationFn. */
export async function deleteHarnessLogEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("delete an entry")}/${id}`, { method: "DELETE" });
}

/** How far back the Built By / Visual Check suggestions look. */
export const RECENT_CODES_MONTHS = 12;

/** Midnight UTC, `months` before `today` — the start of the suggestion window. */
export function recentCodesSince(today: Date, months = RECENT_CODES_MONTHS): Date {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()));
}

export interface HarnessRecentCodes {
  /** Raw Built By / Visual Check values, one per entry in the window. */
  builtBy: string[];
  visualCheck: string[];
}

/**
 * Built By and Visual Check values from the last `RECENT_CODES_MONTHS`
 * months, WHICHEVER year the screen is showing — the form's suggestions.
 *
 * A separate, slim read rather than the loaded year: on 2 January this year's
 * log is nearly empty, and on "All years" it is every leaver and typo since
 * 2018. Selects the two columns plus the date only, filtered server-side on
 * the indexed ProductionDate; if SharePoint refuses the filter, the whole list
 * is read (still just three columns) and filtered here.
 */
export async function listHarnessRecentCodes(today = new Date()): Promise<HarnessRecentCodes> {
  const since = recentCodesSince(today);
  const inWindow = (d: Date | null) => !!d && d.getTime() >= since.getTime();

  if (USE_MOCK) {
    const recent = mockStore.filter((e) => inWindow(e.productionDate));
    return mockDelay({
      builtBy: recent.map((e) => e.builtBy),
      visualCheck: recent.map((e) => e.visualCheck),
    });
  }

  const base =
    `${itemsPath("read recent builders")}` +
    `?$expand=fields($select=ProductionDate,BuiltBy,VisualCheck)&$top=999`;
  const iso = since.toISOString().replace(".000Z", "Z");
  let items: GraphListItem[] | null = null;
  for (const filter of serverFilterUnavailable
    ? []
    : [`fields/ProductionDate ge ${iso}`, `fields/ProductionDate ge '${iso}'`]) {
    try {
      items = await graphFetchAll<GraphListItem>(`${base}&$filter=${encodeFilter(filter)}`);
      break;
    } catch (err) {
      /* eslint-disable-next-line no-console */
      console.warn(`[Harness] ProductionDate filter rejected: ${filter}`, err);
    }
  }
  if (items === null) {
    serverFilterUnavailable = true;
    items = (await graphFetchAll<GraphListItem>(base)).filter((i) =>
      inWindow(parseSpDateOnly((i.fields as Record<string, unknown>)?.ProductionDate)),
    );
  }
  const text = (i: GraphListItem, k: string) => {
    const v = (i.fields as Record<string, unknown>)?.[k];
    return typeof v === "string" ? v : "";
  };
  return {
    builtBy: items.map((i) => text(i, "BuiltBy")),
    visualCheck: items.map((i) => text(i, "VisualCheck")),
  };
}

/**
 * Entries per part number across EVERY year — the part-number screen shows it
 * so an admin can see how much history a rename or retire touches. Selects the
 * one lookup column only, so even 22,000 rows is a small payload.
 */
export async function listHarnessPartUsage(): Promise<Map<number, number>> {
  const usage = new Map<number, number>();
  const bump = (id: number | null) => {
    if (id !== null) usage.set(id, (usage.get(id) ?? 0) + 1);
  };
  if (USE_MOCK) {
    mockStore.forEach((e) => bump(e.part?.lookupId ?? null));
    return mockDelay(usage);
  }
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath("count part usage")}?$expand=fields($select=PartNumberLookupId)&$top=999`,
  );
  for (const item of items) {
    const raw = Number((item.fields as Record<string, unknown>)?.PartNumberLookupId);
    bump(Number.isInteger(raw) && raw > 0 ? raw : null);
  }
  return usage;
}
