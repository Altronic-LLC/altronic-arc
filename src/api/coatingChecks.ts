import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_COATING_CHECKS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { encodeFilter } from "@/lib/odata";
import type { GraphListItem } from "@/types/task";
import type { CoatingCheck, CoatingCheckInput } from "@/types/coating";
import {
  buildCoatingCheckFields,
  compareCoatingChecks,
  COATING_CHECK_SELECT,
  deriveCoatingFigures,
  toCoatingCheck,
} from "@/lib/coatingMapper";
import { buildCoatingCheckTitle } from "@/lib/coatingCheck";
import { MOCK_COATING_CHECKS } from "@/data/coatingMockData";

// =============================================================================
// Coating Checks — one row per conformal coating thickness check, on the PMO
// site (BusinessIT#60). Six readings (uncoated × 3, coated × 3), the machine,
// the operator and when.
//
// Read ONE YEAR AT A TIME on the INDEXED MeasuredAt, the crimp log's
// arrangement: a check a shift per machine adds up, and past 5,000 rows
// SharePoint refuses a filter on an unindexed column. Bare DateTimeOffset
// literal first, quoted second; if both are refused the list is read whole and
// filtered here, and the refusal is remembered for the session.
//
// `SpecRef` is a SINGLE lookup into Coating Specs: read as a bare
// `SpecRefLookupId`, written as a bare integer. The spec's figures are COPIED
// onto the check as well, so an edited spec never re-judges old checks.
// =============================================================================

export type CoatingCheckScope = { kind: "year"; year: number } | { kind: "all" };

export const CURRENT_COATING_YEAR = (): CoatingCheckScope => ({ kind: "year", year: new Date().getFullYear() });

/** The log started in ARC; nothing is older than the year it went live. */
export const COATING_FIRST_YEAR = 2026;

let mockStore: CoatingCheck[] = MOCK_COATING_CHECKS.map((c) => ({ ...c }));
let serverFilterUnavailable = false;

/** Test seams. */
export function resetCoatingCheckMockStore(): void {
  mockStore = MOCK_COATING_CHECKS.map((c) => ({ ...c }));
}
export function resetCoatingFilterProbe(): void {
  serverFilterUnavailable = false;
}

export function coatingCheckInScope(check: CoatingCheck, scope: CoatingCheckScope): boolean {
  if (scope.kind === "all") return true;
  // Undated rows show in the current year, where somebody can notice them.
  if (!check.measuredAt) return scope.year === new Date().getFullYear();
  return check.measuredAt.getFullYear() === scope.year;
}

/** Local-year bounds as UTC instants: a check at 11pm on 31 December belongs to the year on the clock. */
export function coatingScopeFilters(scope: CoatingCheckScope): string[] {
  if (scope.kind === "all") return [];
  const iso = (y: number) => new Date(y, 0, 1).toISOString().replace(".000Z", "Z");
  const from = iso(scope.year);
  const to = iso(scope.year + 1);
  return [
    `fields/MeasuredAt ge ${from} and fields/MeasuredAt lt ${to}`,
    `fields/MeasuredAt ge '${from}' and fields/MeasuredAt lt '${to}'`,
  ];
}

function itemsPath(action: string): string {
  if (!SP_COATING_CHECKS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Coating Checks list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_COATING_CHECKS_LIST_ID}/items`;
}

/** One scope of the log, newest first. */
export async function listCoatingChecks(scope: CoatingCheckScope = CURRENT_COATING_YEAR()): Promise<CoatingCheck[]> {
  if (USE_MOCK) {
    return mockDelay(
      mockStore.filter((c) => coatingCheckInScope(c, scope)).sort(compareCoatingChecks).map((c) => ({ ...c })),
    );
  }
  const base = `${itemsPath("read the coating checks")}?$expand=fields($select=${COATING_CHECK_SELECT})&$top=999`;
  const build = (items: GraphListItem[]) => items.map(toCoatingCheck).sort(compareCoatingChecks);

  const variants = coatingScopeFilters(scope);
  for (const filter of serverFilterUnavailable ? [] : variants) {
    try {
      return build(await graphFetchAll<GraphListItem>(`${base}&$filter=${encodeFilter(filter)}`));
    } catch (err) {
      /* eslint-disable-next-line no-console */
      console.warn(`[Coating] MeasuredAt filter rejected: ${filter}`, err);
    }
  }
  if (variants.length > 0) serverFilterUnavailable = true;
  return build(await graphFetchAll<GraphListItem>(base)).filter((c) => coatingCheckInScope(c, scope));
}

/** One check, or null when it's gone. Used by the deep link from an alert email. */
export async function getCoatingCheck(id: number): Promise<CoatingCheck | null> {
  if (USE_MOCK) {
    const found = mockStore.find((c) => c.id === id);
    return mockDelay(found ? { ...found } : null);
  }
  try {
    return await readBack(id);
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}

function mockCheck(id: number, input: CoatingCheckInput, prev?: CoatingCheck): CoatingCheck {
  const now = new Date();
  return {
    id,
    title: buildCoatingCheckTitle(input.machine, input.snapshot.specName, input.measuredAt),
    measuredAt: input.measuredAt,
    machine: input.machine.trim(),
    operator: input.operator.trim(),
    unit: input.unit,
    ...input.snapshot,
    uncoated: input.uncoated,
    coated: input.coated,
    ...deriveCoatingFigures(input),
    notes: input.notes,
    createdAt: prev?.createdAt ?? now,
    modifiedAt: now,
  };
}

async function readBack(id: number): Promise<CoatingCheck> {
  return toCoatingCheck(
    await graphFetch<GraphListItem>(`${itemsPath("read a coating check")}/${id}?$expand=fields($select=${COATING_CHECK_SELECT})`),
  );
}

export async function createCoatingCheck(input: CoatingCheckInput): Promise<CoatingCheck> {
  if (USE_MOCK) {
    const created = mockCheck(Math.max(0, ...mockStore.map((c) => c.id)) + 1, input);
    mockStore = [created, ...mockStore];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add a coating check"), {
    method: "POST",
    body: JSON.stringify({ fields: buildCoatingCheckFields(input) }),
  });
  return readBack(parseInt(created.id, 10));
}

export async function updateCoatingCheck(id: number, input: CoatingCheckInput): Promise<CoatingCheck> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Coating check ${id} not found`);
    const next = mockCheck(id, input, mockStore[idx]);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("save a coating check")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildCoatingCheckFields(input)),
  });
  return readBack(id);
}

/** Admin-only — the gate is in `useDeleteCoatingCheck`'s mutationFn. */
export async function deleteCoatingCheck(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((c) => c.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("delete a coating check")}/${id}`, { method: "DELETE" });
}

/**
 * Checks per spec across EVERY year — what the specs screen shows, and what
 * the spec delete guard asks. Selects the one lookup column only.
 */
export async function listCoatingSpecUsage(): Promise<Map<number, number>> {
  const usage = new Map<number, number>();
  const bump = (id: number | null) => {
    if (id !== null) usage.set(id, (usage.get(id) ?? 0) + 1);
  };
  if (USE_MOCK) {
    mockStore.forEach((c) => bump(c.specId));
    return mockDelay(usage);
  }
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath("count spec usage")}?$expand=fields($select=SpecRefLookupId)&$top=999`,
  );
  for (const item of items) {
    const raw = Number((item.fields as Record<string, unknown>)?.SpecRefLookupId);
    bump(Number.isInteger(raw) && raw > 0 ? raw : null);
  }
  return usage;
}
