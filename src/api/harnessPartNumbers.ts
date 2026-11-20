import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_HARNESS_PART_NUMBERS_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, HarnessPartNumber, HarnessPartNumberInput } from "@/types/task";
import {
  buildHarnessPartFields,
  compareHarnessParts,
  toHarnessPartNumber,
} from "@/lib/harnessLogMapper";
import { MOCK_HARNESS_PART_NUMBERS } from "@/data/harnessMockData";
import { mockDelay } from "./mockLatency";

// =============================================================================
// Harness Part Numbers — the list the Harness Production Log's PartNumber
// lookup points at, on the PMO site. ~1,050 rows at import, cleaned from the
// 1,310 free-text spellings the old Access database had collected.
//
// Read by everyone (it feeds the New entry dropdown); ADDED TO, RENAMED and
// RETIRED by ARC admins only — that gate lives in hooks/useHarnessProductionLog.ts.
//
// **There is no delete, in this module or the UI.** Thousands of log rows
// point at these; deleting one leaves every pointer dangling. Retiring
// (`Active = false`) takes a part out of the New entry dropdown while every
// entry already using it keeps it — the CMMS reference lists' rule.
// `harnessPartNumbers.test.ts` asserts nothing here matches /delete|remove/.
// =============================================================================

const PART_SELECT = "Title,Description,Active,Note";

let mockStore: HarnessPartNumber[] = MOCK_HARNESS_PART_NUMBERS.map((p) => ({ ...p }));

/** Test seam — back to the bundled seed. */
export function resetHarnessPartMockStore(): void {
  mockStore = MOCK_HARNESS_PART_NUMBERS.map((p) => ({ ...p }));
}

function listPath(action: string): string {
  if (!SP_HARNESS_PART_NUMBERS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Harness Part Numbers list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_HARNESS_PART_NUMBERS_LIST_ID}/items`;
}

/** Every part number, retired ones included, A–Z. */
export async function listHarnessPartNumbers(): Promise<HarnessPartNumber[]> {
  if (USE_MOCK) return mockDelay([...mockStore].sort(compareHarnessParts).map((p) => ({ ...p })));
  const items = await graphFetchAll<GraphListItem>(
    `${listPath("read the part numbers")}?$expand=fields($select=${PART_SELECT})&$top=999`,
  );
  return items.map(toHarnessPartNumber).sort(compareHarnessParts);
}

/**
 * Refuse a part number another row already has (case-insensitive). The list
 * isn't unique-constrained in SharePoint, and two rows for one part split its
 * history across two lookups — the exact mess the import cleaned up.
 */
function assertUnique(existing: HarnessPartNumber[], title: string, exceptId?: number) {
  const clash = existing.find(
    (p) => p.lookupId !== exceptId && p.title.toUpperCase() === title.toUpperCase(),
  );
  if (clash) {
    throw new Error(
      clash.active
        ? `${clash.title} is already on the list.`
        : `${clash.title} is already on the list, retired — restore it instead of adding it again.`,
    );
  }
}

export async function createHarnessPartNumber(
  input: HarnessPartNumberInput,
): Promise<HarnessPartNumber> {
  const fields = buildHarnessPartFields(input);
  const title = fields.Title as string;
  if (!title) throw new Error("A part number can't be blank.");
  assertUnique(await listHarnessPartNumbers(), title);

  if (USE_MOCK) {
    const part: HarnessPartNumber = {
      lookupId: Math.max(0, ...mockStore.map((p) => p.lookupId)) + 1,
      title,
      description: fields.Description as string,
      active: fields.Active as boolean,
      note: fields.Note as string,
    };
    mockStore = [...mockStore, part];
    return mockDelay({ ...part });
  }
  const created = await graphFetch<GraphListItem>(listPath("add a part number"), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return toHarnessPartNumber(created);
}

/**
 * Rename a part number and/or edit its description and note. Every log entry
 * pointing at it follows — that's the point of a lookup.
 */
export async function updateHarnessPartNumber(
  lookupId: number,
  input: HarnessPartNumberInput,
): Promise<HarnessPartNumber> {
  const fields = buildHarnessPartFields(input);
  const title = fields.Title as string;
  if (!title) throw new Error("A part number can't be blank.");
  assertUnique(await listHarnessPartNumbers(), title, lookupId);

  if (USE_MOCK) {
    const idx = mockStore.findIndex((p) => p.lookupId === lookupId);
    if (idx < 0) throw new Error(`Part number ${lookupId} not found`);
    const next: HarnessPartNumber = {
      ...mockStore[idx],
      title,
      description: fields.Description as string,
      note: fields.Note as string,
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  // Active is NEVER sent on a rename — `setHarnessPartNumberActive` owns it.
  // Re-sending it is how a retire somebody made a moment ago gets undone.
  await graphFetch(`${listPath("rename a part number")}/${lookupId}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Title: title, Description: fields.Description, Note: fields.Note }),
  });
  return readBack(lookupId);
}

/** Retire a part number, or bring it back. This is what "delete" means here. */
export async function setHarnessPartNumberActive(
  lookupId: number,
  active: boolean,
): Promise<HarnessPartNumber> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((p) => p.lookupId === lookupId);
    if (idx < 0) throw new Error(`Part number ${lookupId} not found`);
    const next = { ...mockStore[idx], active };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }
  await graphFetch(`${listPath("retire a part number")}/${lookupId}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Active: active }),
  });
  return readBack(lookupId);
}

async function readBack(lookupId: number): Promise<HarnessPartNumber> {
  const item = await graphFetch<GraphListItem>(
    `${listPath("read a part number")}/${lookupId}?$expand=fields($select=${PART_SELECT})`,
  );
  return toHarnessPartNumber(item);
}
