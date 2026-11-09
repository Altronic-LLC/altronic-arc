import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PULL_TESTS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { encodeFilter } from "@/lib/odata";
import type { GraphListItem } from "@/types/task";
import type { PullTest, PullTestInput } from "@/types/pullTest";
import {
  buildPullTestFields,
  comparePullTests,
  padReadings,
  PULL_TEST_SELECT,
  toPullTest,
} from "@/lib/pullTestMapper";
import { buildPullTestTitle, isPullTestFailed, lowestPull } from "@/lib/pullTest";
import { MOCK_PULL_TESTS } from "@/data/pullTestMockData";

// =============================================================================
// Pull Tests — one row per test of up to five pulls on the Mark-10 WT-205, on
// the PMO site (BusinessIT#64).
//
// Read ONE YEAR AT A TIME on the INDEXED TestedAt, the crimp checks'
// arrangement: bare DateTimeOffset literal first, quoted second; if both are
// refused the list is read whole and filtered here, and the refusal is
// remembered for the session.
//
// `SpecRef` is a SINGLE lookup into Pull Test Specs: read as a bare
// `SpecRefLookupId`, written as a bare integer. The spec's minimum is COPIED
// onto the test as well, so an edited spec never re-judges old tests.
// =============================================================================

export type PullTestScope = { kind: "year"; year: number } | { kind: "all" };

export const CURRENT_PULL_TEST_YEAR = (): PullTestScope => ({ kind: "year", year: new Date().getFullYear() });

/** The log started in ARC; nothing is older than the year it went live. */
export const PULL_TEST_FIRST_YEAR = 2026;

let mockStore: PullTest[] = MOCK_PULL_TESTS.map((t) => ({ ...t }));
let serverFilterUnavailable = false;

/** Test seams. */
export function resetPullTestMockStore(): void {
  mockStore = MOCK_PULL_TESTS.map((t) => ({ ...t }));
}
export function resetPullTestFilterProbe(): void {
  serverFilterUnavailable = false;
}

export function pullTestInScope(test: PullTest, scope: PullTestScope): boolean {
  if (scope.kind === "all") return true;
  // Undated rows show in the current year, where somebody can notice them.
  if (!test.testedAt) return scope.year === new Date().getFullYear();
  return test.testedAt.getFullYear() === scope.year;
}

/** Local-year bounds as UTC instants — the year the person saw on the clock. */
export function pullTestScopeFilters(scope: PullTestScope): string[] {
  if (scope.kind === "all") return [];
  const iso = (y: number) => new Date(y, 0, 1).toISOString().replace(".000Z", "Z");
  const from = iso(scope.year);
  const to = iso(scope.year + 1);
  return [
    `fields/TestedAt ge ${from} and fields/TestedAt lt ${to}`,
    `fields/TestedAt ge '${from}' and fields/TestedAt lt '${to}'`,
  ];
}

function itemsPath(action: string): string {
  if (!SP_PULL_TESTS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Pull Tests list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_PULL_TESTS_LIST_ID}/items`;
}

/** One scope of the log, newest first. */
export async function listPullTests(scope: PullTestScope = CURRENT_PULL_TEST_YEAR()): Promise<PullTest[]> {
  if (USE_MOCK) {
    return mockDelay(mockStore.filter((t) => pullTestInScope(t, scope)).sort(comparePullTests).map((t) => ({ ...t })));
  }
  const base = `${itemsPath("read the pull tests")}?$expand=fields($select=${PULL_TEST_SELECT})&$top=999`;
  const build = (items: GraphListItem[]) => items.map(toPullTest).sort(comparePullTests);

  const variants = pullTestScopeFilters(scope);
  for (const filter of serverFilterUnavailable ? [] : variants) {
    try {
      return build(await graphFetchAll<GraphListItem>(`${base}&$filter=${encodeFilter(filter)}`));
    } catch (err) {
      /* eslint-disable-next-line no-console */
      console.warn(`[PullTests] TestedAt filter rejected: ${filter}`, err);
    }
  }
  if (variants.length > 0) serverFilterUnavailable = true;
  return build(await graphFetchAll<GraphListItem>(base)).filter((t) => pullTestInScope(t, scope));
}

/** One test, or null when it's gone. Used by the deep link from an alert email. */
export async function getPullTest(id: number): Promise<PullTest | null> {
  if (USE_MOCK) {
    const found = mockStore.find((t) => t.id === id);
    return mockDelay(found ? { ...found } : null);
  }
  try {
    return await readBack(id);
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}

function mockTest(id: number, input: PullTestInput, prev?: PullTest): PullTest {
  const s = input.snapshot;
  const readings = padReadings(input.readings);
  const now = new Date();
  return {
    id,
    title: buildPullTestTitle(input.terminal, s.wireGauge, input.checkPoint),
    testedAt: input.testedAt,
    checkPoint: input.checkPoint,
    clockNumber: input.clockNumber.trim().toUpperCase(),
    ...s,
    terminal: input.terminal.trim().toUpperCase(),
    applicator: input.applicator.trim(),
    readings,
    unit: input.unit,
    lowest: lowestPull(readings),
    failed: isPullTestFailed(readings, input.unit, s),
    readingSource: input.readingSource,
    howFailed: input.howFailed.trim(),
    harnessOrAssembly: input.harnessOrAssembly.trim(),
    workOrder: input.workOrder.trim(),
    notes: input.notes,
    createdAt: prev?.createdAt ?? now,
    modifiedAt: now,
  };
}

async function readBack(id: number): Promise<PullTest> {
  return toPullTest(
    await graphFetch<GraphListItem>(`${itemsPath("read a pull test")}/${id}?$expand=fields($select=${PULL_TEST_SELECT})`),
  );
}

export async function createPullTest(input: PullTestInput): Promise<PullTest> {
  if (USE_MOCK) {
    const created = mockTest(Math.max(0, ...mockStore.map((t) => t.id)) + 1, input);
    mockStore = [created, ...mockStore];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add a pull test"), {
    method: "POST",
    body: JSON.stringify({ fields: buildPullTestFields(input) }),
  });
  return readBack(parseInt(created.id, 10));
}

export async function updatePullTest(id: number, input: PullTestInput): Promise<PullTest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Pull test ${id} not found`);
    const next = mockTest(id, input, mockStore[idx]);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("save a pull test")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildPullTestFields(input)),
  });
  return readBack(id);
}

/** Admin-only — the gate is in `useDeletePullTest`'s mutationFn. */
export async function deletePullTest(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((t) => t.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("delete a pull test")}/${id}`, { method: "DELETE" });
}

/**
 * Tests per spec across EVERY year — what the specs screen shows, and what
 * the spec delete guard asks. Selects the one lookup column only.
 */
export async function listPullTestSpecUsage(): Promise<Map<number, number>> {
  const usage = new Map<number, number>();
  const bump = (id: number | null) => {
    if (id !== null) usage.set(id, (usage.get(id) ?? 0) + 1);
  };
  if (USE_MOCK) {
    mockStore.forEach((t) => bump(t.specId));
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
