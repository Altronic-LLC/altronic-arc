import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_COATING_SPECS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { CoatingSpec, CoatingSpecInput } from "@/types/coating";
import {
  buildCoatingSpecFields,
  compareCoatingSpecs,
  COATING_SPEC_SELECT,
  toCoatingSpec,
} from "@/lib/coatingMapper";
import { coatingSpecKey } from "@/lib/coatingCheck";
import { MOCK_COATING_SPECS } from "@/data/coatingMockData";

// =============================================================================
// Coating Specs — the conformal coating thickness each check is judged by, on
// the PMO site (BusinessIT#60). One row per spec: a name, the min / max in
// millimetres (entered in mm or inches — SpecUnit says which), and how many
// sides the board is coated on.
//
// Read by everyone (the check form's spec picker). Added, edited, retired and
// deleted by ARC admins only — the gate lives in hooks/useCoatingChecks.ts.
// Delete only for a spec NO check points at; a used spec is RETIRED instead
// (Active = false), the Crimp Specs arrangement.
// =============================================================================

let mockStore: CoatingSpec[] = MOCK_COATING_SPECS.map((s) => ({ ...s }));

/** Test seam — back to the bundled seed. */
export function resetCoatingSpecMockStore(): void {
  mockStore = MOCK_COATING_SPECS.map((s) => ({ ...s }));
}

function itemsPath(action: string): string {
  if (!SP_COATING_SPECS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Coating Specs list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_COATING_SPECS_LIST_ID}/items`;
}

/** Every spec, retired ones included — active first, then by name. */
export async function listCoatingSpecs(): Promise<CoatingSpec[]> {
  if (USE_MOCK) return mockDelay([...mockStore].sort(compareCoatingSpecs).map((s) => ({ ...s })));
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath("read the coating specs")}?$expand=fields($select=${COATING_SPEC_SELECT})&$top=999`,
  );
  return items.map(toCoatingSpec).sort(compareCoatingSpecs);
}

/** Two specs with one name would make the picker a coin flip. */
function assertUnique(existing: CoatingSpec[], input: CoatingSpecInput, exceptId?: number) {
  const key = coatingSpecKey(input.name);
  const clash = existing.find((s) => s.id !== exceptId && coatingSpecKey(s.name) === key);
  if (clash) {
    throw new Error(`There's already a spec called "${clash.name}"${clash.active ? "" : " (retired — restore it instead)"}.`);
  }
}

/** Refuses a spec that couldn't judge a check. */
export function validateCoatingSpec(input: CoatingSpecInput): void {
  if (!input.name.trim()) throw new Error("A spec needs a name.");
  if (input.minMm === null || input.maxMm === null) throw new Error("Enter both the minimum and the maximum, in mm.");
  if (!Number.isFinite(input.minMm) || !Number.isFinite(input.maxMm)) throw new Error("The limits must be numbers, in mm.");
  if (input.minMm < 0) throw new Error("The minimum can't be negative.");
  if (input.maxMm < input.minMm) throw new Error("The maximum can't be less than the minimum.");
  if (input.coatedSides !== 1 && input.coatedSides !== 2) throw new Error("Coated sides must be 1 or 2.");
  if (input.specUnit !== "mm" && input.specUnit !== "in") throw new Error("A spec's limits are entered in mm or inches.");
}

export async function createCoatingSpec(input: CoatingSpecInput): Promise<CoatingSpec> {
  validateCoatingSpec(input);
  assertUnique(await listCoatingSpecs(), input);
  if (USE_MOCK) {
    const created: CoatingSpec = { ...input, name: input.name.trim(), id: Math.max(0, ...mockStore.map((s) => s.id)) + 1 };
    mockStore = [...mockStore, created];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add a coating spec"), {
    method: "POST",
    body: JSON.stringify({ fields: buildCoatingSpecFields(input) }),
  });
  return readBack(parseInt(created.id, 10));
}

/**
 * Edit a spec. Checks already taken keep the figures they were judged by —
 * they're copied onto the check — so a change only affects the NEXT check.
 */
export async function updateCoatingSpec(id: number, input: CoatingSpecInput): Promise<CoatingSpec> {
  validateCoatingSpec(input);
  assertUnique(await listCoatingSpecs(), input, id);
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Coating spec ${id} not found`);
    const next: CoatingSpec = { ...input, name: input.name.trim(), id };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("save a coating spec")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildCoatingSpecFields(input)),
  });
  return readBack(id);
}

/** Retire a spec, or bring it back. Only `Active` is sent. */
export async function setCoatingSpecActive(id: number, active: boolean): Promise<CoatingSpec> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Coating spec ${id} not found`);
    const next = { ...mockStore[idx], active };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("retire a coating spec")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Active: active }),
  });
  return readBack(id);
}

/** Admin-only, and only while no check uses it — both asked in `useDeleteCoatingSpec`. */
export async function deleteCoatingSpec(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((s) => s.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("delete a coating spec")}/${id}`, { method: "DELETE" });
}

async function readBack(id: number): Promise<CoatingSpec> {
  return toCoatingSpec(
    await graphFetch<GraphListItem>(`${itemsPath("read a coating spec")}/${id}?$expand=fields($select=${COATING_SPEC_SELECT})`),
  );
}
