import { graphFetch, graphFetchAll } from "./graph";
import {
  SITES,
  SP_MAINTENANCE_DEPARTMENTS_LIST_ID,
  SP_MAINTENANCE_LOCATIONS_LIST_ID,
  USE_MOCK,
} from "./config";
import type {
  GraphListItem,
  MaintenanceReferenceInput,
  MaintenanceReferenceKind,
  MaintenanceReferenceValue,
} from "@/types/task";
import { compareReferenceValues } from "@/lib/maintenanceReferences";
import {
  MOCK_MAINTENANCE_DEPARTMENTS,
  MOCK_MAINTENANCE_LOCATIONS,
} from "@/data/maintenanceMockData";

// =============================================================================
// Maintenance Departments and Maintenance Locations — the two admin-managed
// reference lists behind the `DepartmentRef` / `LocationRef` single lookups on
// the Equipment List, Maintenance Tasks and Scheduled Maintenance. Both on the
// PMO site.
//
// **One parametrised module, not two.** The lists are structurally identical —
// `Title`, `Active`, `Note`, no lookups, no people columns — so the only
// per-list variation is the id and what to call it, which lives in the
// REFERENCE_LISTS table below. Same shape as api/teradyneRefs.ts, and for the
// same reason: two near-identical modules is how a fix reaches one list.
//
// **They replaced CHOICE columns on 2026-08-28, and that is the point.** A
// choice column's allowed values live in the column DEFINITION, so adding a
// department was a column PATCH needing site-manage rights — which ARC, on
// `Sites.Selected`, has never had. Adding a lookup value is adding a LIST
// ITEM, which it can. See the note in api/config.ts.
//
// **There is no delete, in this module or in the UI.** Hundreds of assets and
// work orders point at these rows; deleting one leaves every pointer dangling
// and each affected record reading as though it had no department at all.
// `setMaintenanceReferenceValueActive(kind, id, false)` retires a value
// instead — it leaves every picker while every row already pointing at it
// keeps showing it (see `referenceOptions` in lib/maintenanceReferences.ts).
// `maintenanceReferenceLists.test.ts` asserts this module exports nothing
// matching /delete|remove/.
// =============================================================================

interface ReferenceListSpec {
  /** Human label, used in error messages and toasts. */
  label: string;
  /** Singular form, for "Add a department" style copy. */
  singular: string;
  listId: string;
}

export const REFERENCE_LISTS: Record<MaintenanceReferenceKind, ReferenceListSpec> = {
  departments: {
    label: "Maintenance Departments",
    singular: "department",
    listId: SP_MAINTENANCE_DEPARTMENTS_LIST_ID,
  },
  locations: {
    label: "Maintenance Locations",
    singular: "location",
    listId: SP_MAINTENANCE_LOCATIONS_LIST_ID,
  },
};

/** Columns to `$select`. All three, on both lists — the shape is identical. */
const REFERENCE_SELECT = "Title,Active,Note";

// -----------------------------------------------------------------------------
// Mock store. Module-level so edits persist across navigations within a demo
// session, the same as every other reference-list module.
// -----------------------------------------------------------------------------

const mockStores: Record<MaintenanceReferenceKind, MaintenanceReferenceValue[]> = {
  departments: MOCK_MAINTENANCE_DEPARTMENTS.map((v) => ({ ...v })),
  locations: MOCK_MAINTENANCE_LOCATIONS.map((v) => ({ ...v })),
};

/** Demo-mode-only: reset both lists to the bundled seed. */
export function resetMaintenanceReferenceMockStores(): void {
  mockStores.departments = MOCK_MAINTENANCE_DEPARTMENTS.map((v) => ({ ...v }));
  mockStores.locations = MOCK_MAINTENANCE_LOCATIONS.map((v) => ({ ...v }));
}

function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(kind: MaintenanceReferenceKind, action: string): string {
  const spec = REFERENCE_LISTS[kind];
  if (!spec.listId) {
    throw new Error(`Cannot ${action}: the ${spec.label} list id is not configured.`);
  }
  return spec.listId;
}

function listPath(kind: MaintenanceReferenceKind, action: string): string {
  return `/sites/${SITES.pmo}/lists/${requireListId(kind, action)}/items`;
}

/**
 * Graph item → one reference value.
 *
 * **A missing `Active` reads as ACTIVE.** The opposite would empty every
 * picker in the CMMS the moment somebody added the column to a list that
 * hadn't got it, or the day a row was created outside ARC — the same call the
 * Open Orders customer list makes about its own `Active` column.
 */
export function toMaintenanceReferenceValue(item: GraphListItem): MaintenanceReferenceValue {
  const f = item.fields ?? {};
  const active = f.Active;
  return {
    lookupId: parseInt(item.id, 10),
    title: typeof f.Title === "string" ? f.Title.trim() : "",
    active: active === undefined || active === null ? true : readBoolean(active),
    note: typeof f.Note === "string" ? f.Note : "",
  };
}

function readBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return /^(true|yes|1)$/i.test(raw.trim());
  return false;
}

/** Domain input → the SharePoint fields payload. `Active` is ALWAYS sent. */
function writeFields(input: MaintenanceReferenceInput): Record<string, unknown> {
  return {
    Title: input.title.trim(),
    // Never omitted: a null Active reads as blank in SharePoint's own views,
    // and a value that is neither on nor off is one nobody can tell the state
    // of. Same rule as `Active` on a PM schedule.
    Active: input.active ?? true,
    Note: input.note ?? "",
  };
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/**
 * Every value on one reference list, retired ones included, sorted by title.
 *
 * Retired values are NOT filtered out here. Every caller needs them for a
 * different reason — the admin screen to restore them, the mappers to resolve
 * a row that still points at one, `referenceOptions` to keep the current
 * value in its own picker — and a read that hid them would make each of those
 * fetch the list a second way.
 */
export async function listMaintenanceReferenceValues(
  kind: MaintenanceReferenceKind,
): Promise<MaintenanceReferenceValue[]> {
  if (USE_MOCK) {
    return delay([...mockStores[kind]].sort(compareReferenceValues).map((v) => ({ ...v })));
  }

  const path =
    `${listPath(kind, `read the ${REFERENCE_LISTS[kind].label} list`)}` +
    `?$expand=fields($select=${REFERENCE_SELECT})&$top=500`;
  const items = await graphFetchAll<GraphListItem>(path);
  return items.map(toMaintenanceReferenceValue).sort(compareReferenceValues);
}

/** Both lists in one go — what every CMMS read needs to resolve its lookups. */
export async function listMaintenanceReferenceLists(): Promise<{
  departments: MaintenanceReferenceValue[];
  locations: MaintenanceReferenceValue[];
}> {
  const [departments, locations] = await Promise.all([
    listMaintenanceReferenceValues("departments"),
    listMaintenanceReferenceValues("locations"),
  ]);
  return { departments, locations };
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

/** Add a value. This is the whole reason these are lookups and not choices. */
export async function createMaintenanceReferenceValue(
  kind: MaintenanceReferenceKind,
  input: MaintenanceReferenceInput,
): Promise<MaintenanceReferenceValue> {
  const title = input.title.trim();
  if (!title) throw new Error(`A ${REFERENCE_LISTS[kind].singular} needs a name.`);

  if (USE_MOCK) {
    const store = mockStores[kind];
    const value: MaintenanceReferenceValue = {
      lookupId: Math.max(0, ...store.map((v) => v.lookupId)) + 1,
      title,
      active: input.active ?? true,
      note: input.note ?? "",
    };
    mockStores[kind] = [...store, value];
    return delay({ ...value });
  }

  const created = await graphFetch<GraphListItem>(
    listPath(kind, `add a ${REFERENCE_LISTS[kind].singular}`),
    { method: "POST", body: JSON.stringify({ fields: writeFields({ ...input, title }) }) },
  );
  return toMaintenanceReferenceValue(created);
}

/**
 * Rename a value (and/or edit its note).
 *
 * Every row pointing at it follows automatically — that is a lookup's whole
 * advantage over a choice column, where correcting a typo meant editing the
 * column definition AND every row that held the old spelling.
 */
export async function updateMaintenanceReferenceValue(
  kind: MaintenanceReferenceKind,
  lookupId: number,
  input: MaintenanceReferenceInput,
): Promise<MaintenanceReferenceValue> {
  const title = input.title.trim();
  if (!title) throw new Error(`A ${REFERENCE_LISTS[kind].singular} needs a name.`);

  if (USE_MOCK) {
    const store = mockStores[kind];
    const idx = store.findIndex((v) => v.lookupId === lookupId);
    if (idx < 0) throw new Error(`${REFERENCE_LISTS[kind].singular} ${lookupId} not found`);
    const next: MaintenanceReferenceValue = {
      ...store[idx],
      title,
      active: input.active ?? store[idx].active,
      note: input.note ?? store[idx].note,
    };
    mockStores[kind] = [...store.slice(0, idx), next, ...store.slice(idx + 1)];
    return delay({ ...next });
  }

  const path = listPath(kind, `rename a ${REFERENCE_LISTS[kind].singular}`);
  await graphFetch(`${path}/${lookupId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(writeFields({ ...input, title })),
  });
  const values = await listMaintenanceReferenceValues(kind);
  const found = values.find((v) => v.lookupId === lookupId);
  if (!found) throw new Error(`${REFERENCE_LISTS[kind].singular} ${lookupId} disappeared after update`);
  return found;
}

/**
 * Retire a value, or bring it back. **This is what "delete" means here** — see
 * the note at the top of this file.
 *
 * Writes `Active` alone rather than going through `writeFields`: retiring must
 * not touch the title or the note, and re-sending a title is how a rename
 * somebody else made a moment ago gets silently reverted.
 */
export async function setMaintenanceReferenceValueActive(
  kind: MaintenanceReferenceKind,
  lookupId: number,
  active: boolean,
): Promise<MaintenanceReferenceValue> {
  if (USE_MOCK) {
    const store = mockStores[kind];
    const idx = store.findIndex((v) => v.lookupId === lookupId);
    if (idx < 0) throw new Error(`${REFERENCE_LISTS[kind].singular} ${lookupId} not found`);
    const next: MaintenanceReferenceValue = { ...store[idx], active };
    mockStores[kind] = [...store.slice(0, idx), next, ...store.slice(idx + 1)];
    return delay({ ...next });
  }

  const path = listPath(kind, `retire a ${REFERENCE_LISTS[kind].singular}`);
  await graphFetch(`${path}/${lookupId}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Active: active }),
  });
  const values = await listMaintenanceReferenceValues(kind);
  const found = values.find((v) => v.lookupId === lookupId);
  if (!found) throw new Error(`${REFERENCE_LISTS[kind].singular} ${lookupId} disappeared after update`);
  return found;
}
