import {
  COMPONENT_DESCRIPTION_OPTION_KINDS,
  type ComponentDescriptionOption,
  type ComponentDescriptionOptionKind,
  type GraphListItem,
} from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID, USE_MOCK } from "./config";
import { cleanOptionName, parseTypes, seedOptions, serializeTypes } from "@/lib/componentDescriptions";

// =============================================================================
// Component Description Options list — the dropdowns a NEW component is
// described with (Tim, 2026-09-28/29). One row per option:
//
//   Title      the option — a Description ("Capacitor") or a SIL category
//              ("SIL CAT 1")
//   Kind       Description | SIL Category (a strict Choice column)
//   Types      a Description's types, one per line; blank for a SIL category
//   SortOrder  the order offered, within its kind
//
// Types are LINES on the description's row rather than rows of their own: a
// type means nothing without its description, and a second list would make
// every rename a two-list write.
//
// There IS a delete, unlike most reference lists in ARC. Parts store the
// description as TEXT, never a pointer to an option, so removing one orphans
// nothing — it just stops being offered to the next new part.
//
// Who may write is asked in the hooks (manageDescriptionOptionsGate). This
// module only stores. Unset list id = the dropdowns are off and every write
// here refuses; the New part form keeps its plain Description box.
// =============================================================================

let mockStore: ComponentDescriptionOption[] = seedOptions();

/** Test hook: put the mock store back to the seed, or to the given rows. */
export function __resetComponentDescriptionOptionsMockStore(rows?: ComponentDescriptionOption[]) {
  mockStore = (rows ?? seedOptions()).map((o) => ({ ...o, types: [...o.types] }));
}

function delay<T>(value: T, ms = 40): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const copy = (o: ComponentDescriptionOption): ComponentDescriptionOption => ({ ...o, types: [...o.types] });

function toKind(raw: unknown): ComponentDescriptionOptionKind {
  return COMPONENT_DESCRIPTION_OPTION_KINDS.find((k) => k === raw) ?? "Description";
}

function toOption(item: GraphListItem): ComponentDescriptionOption {
  const f = item.fields as Record<string, unknown>;
  const kind = toKind(f.Kind);
  const order = typeof f.SortOrder === "number" ? f.SortOrder : Number(f.SortOrder);
  return {
    id: parseInt(item.id, 10),
    kind,
    name: typeof f.Title === "string" ? f.Title.trim() : "",
    types: kind === "Description" ? parseTypes(f.Types) : [],
    sortOrder: Number.isFinite(order) ? order : 0,
  };
}

const NOT_SET =
  "the Component Description Options list isn't configured (VITE_SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID is not set).";

function listPath(): string {
  return `/sites/${SITES.engineering}/lists/${SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID}/items`;
}

export async function listComponentDescriptionOptions(): Promise<ComponentDescriptionOption[]> {
  if (USE_MOCK) return delay(mockStore.map(copy));
  if (!SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$expand=fields($select=Title,Kind,Types,SortOrder)&$top=500`,
  );
  return items.map(toOption).filter((o) => o.name);
}

export interface ComponentDescriptionOptionInput {
  kind: ComponentDescriptionOptionKind;
  name: string;
  types: string[];
  sortOrder: number;
}

export async function createComponentDescriptionOption(
  input: ComponentDescriptionOptionInput,
): Promise<ComponentDescriptionOption> {
  const name = cleanOptionName(input.name);
  const types = input.kind === "Description" ? parseTypes(input.types.join("\n")) : [];
  if (USE_MOCK) {
    const row: ComponentDescriptionOption = {
      id: Math.max(0, ...mockStore.map((o) => o.id)) + 1,
      kind: input.kind,
      name,
      types,
      sortOrder: input.sortOrder,
    };
    mockStore.push(row);
    return delay(copy(row));
  }
  if (!SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID) throw new Error(`Can't add that option: ${NOT_SET}`);
  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({
      fields: { Title: name, Kind: input.kind, Types: serializeTypes(types), SortOrder: input.sortOrder },
    }),
  });
  return toOption(created);
}

/** Change an option's name, types or order. Only the fields given are written. */
export async function updateComponentDescriptionOption(input: {
  id: number;
  name?: string;
  types?: string[];
  sortOrder?: number;
}): Promise<ComponentDescriptionOption> {
  if (USE_MOCK) {
    const row = mockStore.find((o) => o.id === input.id);
    if (!row) throw new Error("That option is no longer on the list — somebody may have removed it.");
    if (input.name !== undefined) row.name = cleanOptionName(input.name);
    if (input.types !== undefined && row.kind === "Description") row.types = parseTypes(input.types.join("\n"));
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;
    return delay(copy(row));
  }
  if (!SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID) throw new Error(`Can't change that option: ${NOT_SET}`);
  const fields: Record<string, string | number> = {};
  if (input.name !== undefined) fields.Title = cleanOptionName(input.name);
  if (input.types !== undefined) fields.Types = serializeTypes(input.types);
  if (input.sortOrder !== undefined) fields.SortOrder = input.sortOrder;
  await graphFetch(`${listPath()}/${input.id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const item = await graphFetch<GraphListItem>(`${listPath()}/${input.id}?$expand=fields($select=Title,Kind,Types,SortOrder)`);
  return toOption(item);
}

/** Stop offering an option. No part changes — parts hold the text, not the option. */
export async function deleteComponentDescriptionOption(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((o) => o.id !== id);
    await delay(null);
    return;
  }
  if (!SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID) throw new Error(`Can't remove that option: ${NOT_SET}`);
  await graphFetch(`${listPath()}/${id}`, { method: "DELETE" });
}
