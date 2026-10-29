import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_CRIMP_CHECKS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { encodeFilter } from "@/lib/odata";
import type { GraphListItem } from "@/types/task";
import type { CrimpCheck, CrimpCheckInput } from "@/types/crimp";
import {
  buildCrimpCheckFields,
  compareCrimpChecks,
  CRIMP_CHECK_SELECT,
  toCrimpCheck,
} from "@/lib/crimpMapper";
import { buildCrimpCheckTitle, crimpAverage, crimpLimits, isOutOfSpec } from "@/lib/crimpCheck";
import { MOCK_CRIMP_CHECKS } from "@/data/crimpMockData";

// =============================================================================
// Crimp Height Checks — one row per check of three micrometer readings, on the
// PMO site (BusinessIT#55). Replaces the paper Terminal Crimp Verification
// Chart.
//
// Read ONE YEAR AT A TIME on the INDEXED CheckedAt, the Harness Production
// Log's arrangement: a check every 100 terminations across a shift adds up,
// and past 5,000 rows SharePoint refuses a filter on an unindexed column.
// Bare DateTimeOffset literal first, quoted second; if both are refused the
// list is read whole and filtered here, and the refusal is remembered.
//
// `SpecRef` is a SINGLE lookup into Crimp Specs: read as a bare
// `SpecRefLookupId`, written as a bare integer. The spec's figures are COPIED
// onto the check as well, so an edited spec never re-judges old checks.
// =============================================================================

export type CrimpCheckScope = { kind: "year"; year: number } | { kind: "all" };

export const CURRENT_CRIMP_YEAR = (): CrimpCheckScope => ({ kind: "year", year: new Date().getFullYear() });

/** The log started in ARC; nothing is older than the year it went live. */
export const CRIMP_FIRST_YEAR = 2026;

let mockStore: CrimpCheck[] = MOCK_CRIMP_CHECKS.map((c) => ({ ...c }));
let serverFilterUnavailable = false;

/** Test seams. */
export function resetCrimpCheckMockStore(): void {
  mockStore = MOCK_CRIMP_CHECKS.map((c) => ({ ...c }));
}
export function resetCrimpFilterProbe(): void {
  serverFilterUnavailable = false;
}

export function crimpCheckInScope(check: CrimpCheck, scope: CrimpCheckScope): boolean {
  if (scope.kind === "all") return true;
  // Undated rows show in the current year, where somebody can notice them.
  if (!check.checkedAt) return scope.year === new Date().getFullYear();
  return check.checkedAt.getFullYear() === scope.year;
}

/**
 * Local-year bounds as UTC instants: a check at 11pm on 31 December belongs to
 * the year the person saw on the clock.
 */
export function crimpScopeFilters(scope: CrimpCheckScope): string[] {
  if (scope.kind === "all") return [];
  const iso = (y: number) => new Date(y, 0, 1).toISOString().replace(".000Z", "Z");
  const from = iso(scope.year);
  const to = iso(scope.year + 1);
  return [
    `fields/CheckedAt ge ${from} and fields/CheckedAt lt ${to}`,
    `fields/CheckedAt ge '${from}' and fields/CheckedAt lt '${to}'`,
  ];
}

function itemsPath(action: string): string {
  if (!SP_CRIMP_CHECKS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Crimp Height Checks list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_CRIMP_CHECKS_LIST_ID}/items`;
}

/** One scope of the log, newest first. */
export async function listCrimpChecks(scope: CrimpCheckScope = CURRENT_CRIMP_YEAR()): Promise<CrimpCheck[]> {
  if (USE_MOCK) {
    return mockDelay(
      mockStore.filter((c) => crimpCheckInScope(c, scope)).sort(compareCrimpChecks).map((c) => ({ ...c })),
    );
  }
  const base = `${itemsPath("read the crimp height checks")}?$expand=fields($select=${CRIMP_CHECK_SELECT})&$top=999`;
  const build = (items: GraphListItem[]) => items.map(toCrimpCheck).sort(compareCrimpChecks);

  const variants = crimpScopeFilters(scope);
  for (const filter of serverFilterUnavailable ? [] : variants) {
    try {
      return build(await graphFetchAll<GraphListItem>(`${base}&$filter=${encodeFilter(filter)}`));
    } catch (err) {
      /* eslint-disable-next-line no-console */
      console.warn(`[Crimp] CheckedAt filter rejected: ${filter}`, err);
    }
  }
  if (variants.length > 0) serverFilterUnavailable = true;
  return build(await graphFetchAll<GraphListItem>(base)).filter((c) => crimpCheckInScope(c, scope));
}

/** One check, or null when it's gone. Used by the deep link from an alert email. */
export async function getCrimpCheck(id: number): Promise<CrimpCheck | null> {
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

function mockCheck(id: number, input: CrimpCheckInput, prev?: CrimpCheck): CrimpCheck {
  const s = input.snapshot;
  const now = new Date();
  return {
    id,
    title: buildCrimpCheckTitle(s.terminal, s.wireGauge, input.checkPoint),
    checkedAt: input.checkedAt,
    checkPoint: input.checkPoint,
    clockNumber: input.clockNumber.trim().toUpperCase(),
    ...s,
    readings: input.readings,
    average: crimpAverage(input.readings),
    outOfSpec: isOutOfSpec(input.readings, crimpLimits(s.crimpHeight, s.tolerance)),
    applicatorChange: input.applicatorChange.trim(),
    verifierClock: input.verifierClock.trim().toUpperCase(),
    harnessOrAssembly: input.harnessOrAssembly.trim(),
    workOrder: input.workOrder.trim(),
    notes: input.notes,
    createdAt: prev?.createdAt ?? now,
    modifiedAt: now,
  };
}

async function readBack(id: number): Promise<CrimpCheck> {
  return toCrimpCheck(
    await graphFetch<GraphListItem>(`${itemsPath("read a crimp check")}/${id}?$expand=fields($select=${CRIMP_CHECK_SELECT})`),
  );
}

export async function createCrimpCheck(input: CrimpCheckInput): Promise<CrimpCheck> {
  if (USE_MOCK) {
    const created = mockCheck(Math.max(0, ...mockStore.map((c) => c.id)) + 1, input);
    mockStore = [created, ...mockStore];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add a crimp check"), {
    method: "POST",
    body: JSON.stringify({ fields: buildCrimpCheckFields(input) }),
  });
  return readBack(parseInt(created.id, 10));
}

export async function updateCrimpCheck(id: number, input: CrimpCheckInput): Promise<CrimpCheck> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Crimp check ${id} not found`);
    const next = mockCheck(id, input, mockStore[idx]);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("save a crimp check")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildCrimpCheckFields(input)),
  });
  return readBack(id);
}

/** Admin-only — the gate is in `useDeleteCrimpCheck`'s mutationFn. */
export async function deleteCrimpCheck(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((c) => c.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("delete a crimp check")}/${id}`, { method: "DELETE" });
}

/**
 * Checks per spec across EVERY year — what the specs screen shows, and what
 * the spec delete guard asks. Selects the one lookup column only.
 */
export async function listCrimpSpecUsage(): Promise<Map<number, number>> {
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
