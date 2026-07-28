import { graphFetch, graphFetchAll } from "./graph";
import {
  SITES,
  SP_TERADYNE_EMPLOYEES_LIST_ID,
  SP_TERADYNE_PRODUCTS_LIST_ID,
  SP_TERADYNE_REMARKS_LIST_ID,
  USE_MOCK,
} from "./config";
import type {
  GraphListItem,
  TeradyneEmployee,
  TeradyneProduct,
  TeradyneRefInput,
  TeradyneRefKind,
  TeradyneRefRow,
  TeradyneRemark,
} from "@/types/task";
import {
  buildTeradyneEmployeeTitle,
  toTeradyneEmployee,
  toTeradyneProduct,
  toTeradyneRemark,
} from "@/lib/teradyneMapper";
import {
  MOCK_TERADYNE_EMPLOYEES,
  MOCK_TERADYNE_PRODUCTS,
  MOCK_TERADYNE_REMARKS,
} from "@/data/teradyneMockData";

// =============================================================================
// Teradyne reference lists (Employees / Products / Remarks) — the three lookup
// sources behind the Teradyne Log, on the PMO site.
//
// One parametrised module instead of three near-identical ones: the lists are
// structurally the same (Title + a couple of scalar columns, no lookups, no
// people fields), so the only per-list variation is the id, which columns to
// select, and how a row maps to/from the domain shape. That variation lives in
// the REF_LISTS table below; everything else is shared.
//
// Editable by any signed-in user (Ray, 2026-07-28) — there is deliberately no
// admin gate. As always in ARC, the real permission boundary is SharePoint's
// own list permissions, not this module.
// =============================================================================

interface RefListSpec {
  /** Human label, used in error messages and toasts. */
  label: string;
  /** Singular form, for "Add a product" style copy. */
  singular: string;
  listId: string;
  /** Columns to $select — keep narrow so the payload stays small. */
  select: string;
  toRow: (item: GraphListItem) => TeradyneRefRow;
  /** Domain input → SharePoint fields payload. */
  writeFields: (input: TeradyneRefInput) => Record<string, unknown>;
}

/**
 * Employees store the display name in Title AND the parts in First_Name /
 * Last_Name, so Title is derived on write — otherwise renaming someone would
 * leave the log's lookup column showing the old name.
 */
function employeeWriteFields(input: TeradyneRefInput): Record<string, unknown> {
  const firstName = (input.firstName ?? "").trim();
  const lastName = (input.lastName ?? "").trim();
  return {
    Title: buildTeradyneEmployeeTitle(firstName, lastName) || input.title.trim(),
    First_Name: firstName,
    Last_Name: lastName,
    ClockNum: input.clockNum ?? null,
    Work_Center: (input.workCenter ?? "").trim(),
  };
}

export const REF_LISTS: Record<TeradyneRefKind, RefListSpec> = {
  employees: {
    label: "Teradyne Employees",
    singular: "employee",
    listId: SP_TERADYNE_EMPLOYEES_LIST_ID,
    select: "Title,IDEmp,First_Name,Last_Name,ClockNum,Work_Center",
    toRow: toTeradyneEmployee,
    writeFields: employeeWriteFields,
  },
  products: {
    label: "Teradyne Products",
    singular: "product",
    listId: SP_TERADYNE_PRODUCTS_LIST_ID,
    select: "Title,IDProd,TestOnStation",
    toRow: toTeradyneProduct,
    writeFields: (input) => ({
      Title: input.title.trim(),
      TestOnStation: (input.testOnStation ?? "").trim(),
    }),
  },
  remarks: {
    label: "Teradyne Remarks",
    singular: "remark",
    listId: SP_TERADYNE_REMARKS_LIST_ID,
    select: "Title,IDRem",
    toRow: toTeradyneRemark,
    // IDRem is writable here (unlike IDEmp/IDProd): the remark number is a code
    // operators use, so they set it when adding and can correct it later.
    writeFields: (input) => ({
      Title: input.title.trim(),
      IDRem: input.idRem ?? null,
    }),
  },
};

// -----------------------------------------------------------------------------
// Mock store. Module-level so edits persist across navigations within a demo
// session (same approach as the other reference-list modules).
// -----------------------------------------------------------------------------

const mockStores: {
  employees: TeradyneEmployee[];
  products: TeradyneProduct[];
  remarks: TeradyneRemark[];
} = {
  employees: MOCK_TERADYNE_EMPLOYEES.map((e) => ({ ...e })),
  products: MOCK_TERADYNE_PRODUCTS.map((p) => ({ ...p })),
  remarks: MOCK_TERADYNE_REMARKS.map((r) => ({ ...r })),
};

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Build a mock row of the right shape for the kind, from a generic input. */
function mockRowFrom(kind: TeradyneRefKind, lookupId: number, input: TeradyneRefInput): TeradyneRefRow {
  if (kind === "employees") {
    const firstName = (input.firstName ?? "").trim();
    const lastName = (input.lastName ?? "").trim();
    return {
      lookupId,
      title: buildTeradyneEmployeeTitle(firstName, lastName) || input.title.trim(),
      firstName,
      lastName,
      clockNum: input.clockNum ?? null,
      workCenter: (input.workCenter ?? "").trim(),
      idEmp: null,
    } satisfies TeradyneEmployee;
  }
  if (kind === "products") {
    return {
      lookupId,
      title: input.title.trim(),
      testOnStation: (input.testOnStation ?? "").trim(),
      idProd: null,
    } satisfies TeradyneProduct;
  }
  return {
    lookupId,
    title: input.title.trim(),
    idRem: input.idRem ?? null,
  } satisfies TeradyneRemark;
}

/**
 * A row's READ-ONLY legacy import id, as a spreadable object — `{ idEmp: 2 }`,
 * `{ idProd: 208 }`, or `{}`.
 *
 * `idRem` is deliberately absent: remark numbers are user-maintained, so
 * re-applying the old value after an edit would silently revert the change.
 */
function readOnlyLegacyIdOf(row: TeradyneRefRow): Partial<TeradyneRefRow> {
  if ("idEmp" in row) return { idEmp: row.idEmp };
  if ("idProd" in row) return { idProd: row.idProd };
  return {};
}

/** Sort helper — alphabetical by title, numeric-aware ("Board 2" before "Board 10"). */
function byTitle(a: TeradyneRefRow, b: TeradyneRefRow): number {
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

/** List every row of one reference list, sorted by title. */
export async function listTeradyneRefs(kind: TeradyneRefKind): Promise<TeradyneRefRow[]> {
  const spec = REF_LISTS[kind];

  if (USE_MOCK) {
    return delay([...mockStores[kind]].sort(byTitle).map((r) => ({ ...r })));
  }

  const path =
    `/sites/${SITES.pmo}/lists/${spec.listId}/items` +
    `?$expand=fields($select=${spec.select})&$top=500`;
  const items = await graphFetchAll<GraphListItem>(path);
  return items.map(spec.toRow).sort(byTitle);
}

export async function createTeradyneRef(
  kind: TeradyneRefKind,
  input: TeradyneRefInput,
): Promise<TeradyneRefRow> {
  const spec = REF_LISTS[kind];

  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStores[kind].map((r) => r.lookupId)) + 1;
    const row = mockRowFrom(kind, nextId, input);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockStores[kind] as any[]).push(row);
    return delay({ ...row });
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${spec.listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: spec.writeFields(input) }) },
  );
  return spec.toRow(created);
}

export async function updateTeradyneRef(
  kind: TeradyneRefKind,
  lookupId: number,
  input: TeradyneRefInput,
): Promise<TeradyneRefRow> {
  const spec = REF_LISTS[kind];

  if (USE_MOCK) {
    const store = mockStores[kind];
    const idx = store.findIndex((r) => r.lookupId === lookupId);
    if (idx < 0) throw new Error(`${spec.singular} ${lookupId} not found`);
    const existing = store[idx];
    const next = mockRowFrom(kind, lookupId, input);
    // Preserve the read-only legacy ids. mockRowFrom sets them to null (new
    // rows don't get one), so they have to be re-applied AFTER the spread or an
    // edit would blank the id the imported row came in with. Remark numbers are
    // NOT in there — those come from the input, because users maintain them.
    const merged = { ...existing, ...next, ...readOnlyLegacyIdOf(existing) } as TeradyneRefRow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any[])[idx] = merged;
    return delay({ ...merged });
  }

  await graphFetch(
    `/sites/${SITES.pmo}/lists/${spec.listId}/items/${lookupId}/fields`,
    { method: "PATCH", body: JSON.stringify(spec.writeFields(input)) },
  );
  const rows = await listTeradyneRefs(kind);
  return rows.find((r) => r.lookupId === lookupId) ?? mockRowFrom(kind, lookupId, input);
}

/**
 * Delete a reference row.
 *
 * Callers are expected to have checked that nothing in the log still points at
 * it (see `teradyneRefUsage` in src/hooks/useTeradyne.ts) — a lookup whose
 * target is gone renders as "(missing #n)" on every affected log row, which is
 * recoverable but ugly, so the UI blocks it rather than relying on SharePoint's
 * own referential-integrity setting, which these lists don't enforce.
 */
export async function deleteTeradyneRef(kind: TeradyneRefKind, lookupId: number): Promise<void> {
  const spec = REF_LISTS[kind];

  if (USE_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockStores as any)[kind] = mockStores[kind].filter((r) => r.lookupId !== lookupId);
    await delay(null);
    return;
  }

  await graphFetch(`/sites/${SITES.pmo}/lists/${spec.listId}/items/${lookupId}`, {
    method: "DELETE",
  });
}
