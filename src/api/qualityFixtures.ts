import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QUALITY_FIXTURES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { QualityFixture, QualityFixtureInput } from "@/types/qualityFixture";
import {
  QUALITY_FIXTURE_SELECT,
  applyQualityFixtureInput,
  buildQualityFixtureFields,
  compareFixtures,
  fixtureNumberProblem,
  normalizeFixtureNumber,
  toQualityFixture,
} from "@/lib/qualityFixtures";
import { MOCK_QUALITY_FIXTURES } from "@/data/qualityFixtureMockData";

// =============================================================================
// Quality Fixture Log — QFLOG on Altronic_PMO (Quality Control). About 290
// rows, so it's read whole and searched in the browser.
//
// NO DELETE: a fixture taken out of service is retired (Active = No), and its
// number is never reused. qualityFixtures.test.ts asserts there is no delete.
//
// A fixture number must be unique, checked against a FRESH read of the list
// at save — the cached list can be minutes old.
// =============================================================================

let mockStore: QualityFixture[] = clone(MOCK_QUALITY_FIXTURES);

function clone(rows: QualityFixture[]): QualityFixture[] {
  return rows.map((r) => ({ ...r }));
}

/** For tests: put the mock store back. */
export function __resetQualityFixturesMockStore(): void {
  mockStore = clone(MOCK_QUALITY_FIXTURES);
}

function itemsPath(): string {
  return `/sites/${SITES.pmo}/lists/${SP_QUALITY_FIXTURES_LIST_ID}/items`;
}

function isNotFound(err: unknown): boolean {
  return err instanceof GraphError && err.status === 404;
}

/** Every fixture, in log order (QF1, QF2 … QF63A … QF200 …), retired ones included. */
export async function listQualityFixtures(): Promise<QualityFixture[]> {
  if (USE_MOCK) return mockDelay(clone(mockStore).sort(compareFixtures));
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath()}?$expand=fields($select=${QUALITY_FIXTURE_SELECT})&$top=999`,
  );
  return items.map(toQualityFixture).sort(compareFixtures);
}

/** One fixture, or null when it isn't there (a 404). Anything else throws. */
export async function getQualityFixture(id: number): Promise<QualityFixture | null> {
  if (USE_MOCK) {
    const found = mockStore.find((f) => f.id === id);
    return mockDelay(found ? { ...found } : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(
      `${itemsPath()}/${id}?$expand=fields($select=${QUALITY_FIXTURE_SELECT})`,
    );
    return toQualityFixture(item);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Refuse a number that's malformed or already on the log, judged against a fresh read. */
async function assertNumberFree(number: string, exceptId: number | null): Promise<void> {
  const all = await listQualityFixtures();
  const problem = fixtureNumberProblem(
    number,
    all.filter((f) => f.id !== exceptId),
  );
  if (problem) throw new Error(problem);
}

export async function createQualityFixture(input: QualityFixtureInput): Promise<QualityFixture> {
  await assertNumberFree(input.number, null);
  if (USE_MOCK) {
    const now = new Date();
    const created = applyQualityFixtureInput(
      {
        id: Math.max(0, ...mockStore.map((f) => f.id)) + 1,
        number: "",
        description: "",
        comment: "",
        location: "",
        partNumbers: "",
        active: true,
        hasAttachments: false,
        createdAt: now,
        modifiedAt: now,
      },
      input,
    );
    mockStore = [...mockStore, created];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath(), {
    method: "POST",
    body: JSON.stringify({ fields: buildQualityFixtureFields(input) }),
  });
  return toQualityFixture(created);
}

/**
 * Write only what changed since `previous` (the row the edit started from),
 * then re-read the row. Nothing changed → nothing sent, `previous` returned.
 */
export async function updateQualityFixture(
  id: number,
  input: QualityFixtureInput,
  previous: QualityFixture,
): Promise<QualityFixture> {
  const fields = buildQualityFixtureFields(input, previous);
  if (Object.keys(fields).length === 0) return { ...previous };
  if ("Title" in fields) await assertNumberFree(normalizeFixtureNumber(input.number), id);

  if (USE_MOCK) {
    const idx = mockStore.findIndex((f) => f.id === id);
    if (idx < 0) throw new Error(`Fixture ${id} isn't on the log any more.`);
    const next = { ...applyQualityFixtureInput(mockStore[idx], input), modifiedAt: new Date() };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const back = await getQualityFixture(id);
  if (!back) throw new Error(`Fixture ${id} isn't on the log any more.`);
  return back;
}
