import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PULL_TEST_SPECS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { PullTestSpec, PullTestSpecInput } from "@/types/pullTest";
import {
  buildPullTestSpecFields,
  comparePullTestSpecs,
  PULL_SPEC_SELECT,
  toPullTestSpec,
} from "@/lib/pullTestMapper";
import { pullSpecKey, pullSpecLabel } from "@/lib/pullTest";
import { MOCK_PULL_SPECS } from "@/data/pullTestMockData";

// =============================================================================
// Pull Test Specs — the least force a good crimp holds, per terminal and wire
// gauge, on the PMO site (BusinessIT#64). A manufacturer's figure, or an
// industry standard's (IPC/WHMA-A-620), which goes by wire size alone — so
// the terminal may be blank, meaning "any terminal on this gauge".
//
// Read by everyone (the test form's picker). Added, edited, retired and
// deleted by ARC admins only — the gate lives in hooks/usePullTests.ts. Delete
// only for a spec NO test points at; one that has been used is RETIRED — the
// Crimp Specs arrangement.
// =============================================================================

let mockStore: PullTestSpec[] = MOCK_PULL_SPECS.map((s) => ({ ...s }));

/** Test seam — back to the bundled seed. */
export function resetPullTestSpecMockStore(): void {
  mockStore = MOCK_PULL_SPECS.map((s) => ({ ...s }));
}

function itemsPath(action: string): string {
  if (!SP_PULL_TEST_SPECS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Pull Test Specs list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_PULL_TEST_SPECS_LIST_ID}/items`;
}

/** Every spec, retired ones included, by terminal then gauge. */
export async function listPullTestSpecs(): Promise<PullTestSpec[]> {
  if (USE_MOCK) return mockDelay([...mockStore].sort(comparePullTestSpecs).map((s) => ({ ...s })));
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath("read the pull test specs")}?$expand=fields($select=${PULL_SPEC_SELECT})&$top=999`,
  );
  return items.map(toPullTestSpec).sort(comparePullTestSpecs);
}

/**
 * Refuse a second spec for the same terminal + gauge. Two would offer the
 * operator two minimums for one crimp, and the test would be judged by
 * whichever they happened to pick.
 */
function assertUnique(existing: PullTestSpec[], input: PullTestSpecInput, exceptId?: number) {
  const key = pullSpecKey(input);
  const clash = existing.find((s) => s.id !== exceptId && pullSpecKey(s) === key);
  if (clash) {
    throw new Error(
      `${pullSpecLabel(clash)} already has a spec${clash.active ? "" : " (retired — restore it instead)"}.`,
    );
  }
}

function validate(input: PullTestSpecInput) {
  if (!input.wireGauge.trim()) throw new Error("A spec needs the wire gauge.");
  if (!input.terminal.trim() && input.source !== "Industry standard") {
    throw new Error("Only an industry-standard spec can leave the terminal blank.");
  }
  if (input.minimumForce !== null && !(input.minimumForce > 0)) throw new Error("The minimum must be more than zero.");
}

export async function createPullTestSpec(input: PullTestSpecInput): Promise<PullTestSpec> {
  validate(input);
  assertUnique(await listPullTestSpecs(), input);
  const fields = buildPullTestSpecFields(input);
  if (USE_MOCK) {
    const created: PullTestSpec = {
      ...input,
      id: Math.max(0, ...mockStore.map((s) => s.id)) + 1,
      terminal: fields.Title as string,
      wireGauge: fields.WireGauge as string,
    };
    mockStore = [...mockStore, created];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add a pull test spec"), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return readBack(parseInt(created.id, 10));
}

/**
 * Edit a spec. Tests already taken keep the minimum they were judged by — it's
 * copied onto the test — so a correction here only changes the NEXT test.
 */
export async function updatePullTestSpec(id: number, input: PullTestSpecInput): Promise<PullTestSpec> {
  validate(input);
  assertUnique(await listPullTestSpecs(), input, id);
  const fields = buildPullTestSpecFields(input);
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Pull test spec ${id} not found`);
    const next: PullTestSpec = { ...input, id, terminal: fields.Title as string, wireGauge: fields.WireGauge as string };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("save a pull test spec")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  return readBack(id);
}

/** Retire a spec, or bring it back. Only `Active` is sent. */
export async function setPullTestSpecActive(id: number, active: boolean): Promise<PullTestSpec> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Pull test spec ${id} not found`);
    const next = { ...mockStore[idx], active };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("retire a pull test spec")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Active: active }),
  });
  return readBack(id);
}

/** Admin-only, and only while no test uses it — both asked in `useDeletePullTestSpec`. */
export async function deletePullTestSpec(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((s) => s.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("delete a pull test spec")}/${id}`, { method: "DELETE" });
}

async function readBack(id: number): Promise<PullTestSpec> {
  return toPullTestSpec(
    await graphFetch<GraphListItem>(
      `${itemsPath("read a pull test spec")}/${id}?$expand=fields($select=${PULL_SPEC_SELECT})`,
    ),
  );
}
