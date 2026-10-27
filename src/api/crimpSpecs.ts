import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_CRIMP_SPECS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { CrimpSpec, CrimpSpecInput } from "@/types/crimp";
import { buildCrimpSpecFields, compareCrimpSpecs, CRIMP_SPEC_SELECT, toCrimpSpec } from "@/lib/crimpMapper";
import { crimpSpecKey, crimpSpecLabel } from "@/lib/crimpCheck";
import { MOCK_CRIMP_SPECS } from "@/data/crimpMockData";

// =============================================================================
// Crimp Specs — what each terminal's crimp should measure, on the PMO site.
// One row per terminal + applicator + wire gauge: the spec sheet has one
// applicator crimping three gauges, each with its own setting and height.
//
// Read by everyone (the check form's terminal picker). Added, edited, retired
// and deleted by ARC admins only — the gate lives in hooks/useCrimpChecks.ts.
//
// Delete exists (Tim, 2026-10-27: admins "add/remove and adjust the specs"),
// but only for a spec NO check points at — the hook asks first. A spec that
// has been measured against is RETIRED instead (Active = false): checks copy
// the figures they were measured against, but their SpecRef lookup would
// otherwise dangle.
// =============================================================================

let mockStore: CrimpSpec[] = MOCK_CRIMP_SPECS.map((s) => ({ ...s }));

/** Test seam — back to the bundled seed. */
export function resetCrimpSpecMockStore(): void {
  mockStore = MOCK_CRIMP_SPECS.map((s) => ({ ...s }));
}

function itemsPath(action: string): string {
  if (!SP_CRIMP_SPECS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Crimp Specs list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_CRIMP_SPECS_LIST_ID}/items`;
}

/** Every spec, retired ones included, by terminal then gauge. */
export async function listCrimpSpecs(): Promise<CrimpSpec[]> {
  if (USE_MOCK) return mockDelay([...mockStore].sort(compareCrimpSpecs).map((s) => ({ ...s })));
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath("read the crimp specs")}?$expand=fields($select=${CRIMP_SPEC_SELECT})&$top=999`,
  );
  return items.map(toCrimpSpec).sort(compareCrimpSpecs);
}

/**
 * Refuse a second spec for the same terminal + applicator + gauge. Two would
 * offer the operator two answers to "what should this measure", and the
 * check would be judged against whichever they happened to pick.
 */
function assertUnique(existing: CrimpSpec[], input: CrimpSpecInput, exceptId?: number) {
  const key = crimpSpecKey(input);
  const clash = existing.find((s) => s.id !== exceptId && crimpSpecKey(s) === key);
  if (clash) {
    throw new Error(
      `${crimpSpecLabel(clash)} already has a spec${clash.active ? "" : " (retired — restore it instead)"}.`,
    );
  }
}

function validate(input: CrimpSpecInput) {
  if (!input.terminal.trim()) throw new Error("A spec needs the terminal part number.");
  if (input.crimpHeight !== null && !(input.crimpHeight > 0)) throw new Error("Crimp height must be more than zero.");
  if (input.tolerance !== null && !(input.tolerance >= 0)) throw new Error("Tolerance can't be negative.");
}

export async function createCrimpSpec(input: CrimpSpecInput): Promise<CrimpSpec> {
  validate(input);
  assertUnique(await listCrimpSpecs(), input);
  const fields = buildCrimpSpecFields(input);
  if (USE_MOCK) {
    const created: CrimpSpec = {
      ...input,
      id: Math.max(0, ...mockStore.map((s) => s.id)) + 1,
      terminal: fields.Title as string,
      applicator: fields.Applicator as string,
    };
    mockStore = [...mockStore, created];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add a crimp spec"), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return readBack(parseInt(created.id, 10));
}

/**
 * Edit a spec. Checks already taken keep the figures they were measured
 * against — they're copied onto the check — so a correction here only
 * changes what the NEXT check is judged by.
 */
export async function updateCrimpSpec(id: number, input: CrimpSpecInput): Promise<CrimpSpec> {
  validate(input);
  assertUnique(await listCrimpSpecs(), input, id);
  const fields = buildCrimpSpecFields(input);
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Crimp spec ${id} not found`);
    const next: CrimpSpec = {
      ...input,
      id,
      terminal: fields.Title as string,
      applicator: fields.Applicator as string,
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("save a crimp spec")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  return readBack(id);
}

/** Retire a spec, or bring it back. Only `Active` is sent. */
export async function setCrimpSpecActive(id: number, active: boolean): Promise<CrimpSpec> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Crimp spec ${id} not found`);
    const next = { ...mockStore[idx], active };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${itemsPath("retire a crimp spec")}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Active: active }),
  });
  return readBack(id);
}

/** Admin-only, and only while no check uses it — both asked in `useDeleteCrimpSpec`. */
export async function deleteCrimpSpec(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((s) => s.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("delete a crimp spec")}/${id}`, { method: "DELETE" });
}

async function readBack(id: number): Promise<CrimpSpec> {
  return toCrimpSpec(
    await graphFetch<GraphListItem>(`${itemsPath("read a crimp spec")}/${id}?$expand=fields($select=${CRIMP_SPEC_SELECT})`),
  );
}
