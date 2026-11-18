import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PLANT_MAP_ROLES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { PlantMapRole, PlantMapRoleEntry, PlantMapRoleInput } from "@/types/plant";
import { parsePlantMapRoles, serializePlantMapRoles } from "@/lib/plantMapRoles";
import { MOCK_PLANT_MAP_ROLES } from "@/data/plantMockData";

// =============================================================================
// Plant Map Roles — who may edit the Plant Map. On Altronic_PMO, managed in
// ARC at /operations/plant-map/roles by a Plant Map admin or an ARC admin.
//
// Title = email, `PersonName` (NEVER `DisplayName` — Graph silently drops a
// listItem field of that name), `Roles` (lowercase CSV: editor, admin),
// `Note`. Rows CAN be deleted: a person with no tags is nobody to this list.
// =============================================================================

let mockRoles: PlantMapRoleEntry[] = clone(MOCK_PLANT_MAP_ROLES);

function clone(entries: PlantMapRoleEntry[]): PlantMapRoleEntry[] {
  return entries.map((e) => ({ ...e, roles: [...e.roles] }));
}

/** For tests: put the mock store back. */
export function __resetPlantMapRolesMockStore(): void {
  mockRoles = clone(MOCK_PLANT_MAP_ROLES);
}

function rolesPath(): string {
  if (!SP_PLANT_MAP_ROLES_LIST_ID) {
    throw new Error("Plant Map Roles isn't set up yet: VITE_SP_PLANT_MAP_ROLES_LIST_ID is not set.");
  }
  return `/sites/${SITES.pmo}/lists/${SP_PLANT_MAP_ROLES_LIST_ID}/items`;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

export function toPlantMapRoleEntry(item: GraphListItem): PlantMapRoleEntry {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    email: text(f.Title).trim().toLowerCase(),
    displayName: text(f.PersonName).trim(),
    roles: parsePlantMapRoles(f.Roles),
    note: text(f.Note).trim(),
  };
}

/** Everyone on the list. An unset list reads as empty — nobody edits. */
export async function listPlantMapRoleEntries(): Promise<PlantMapRoleEntry[]> {
  if (USE_MOCK) return mockDelay(clone(mockRoles));
  if (!SP_PLANT_MAP_ROLES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${rolesPath()}?$expand=fields($select=Title,PersonName,Roles,Note)&$top=500`,
  );
  return items.map(toPlantMapRoleEntry);
}

export async function createPlantMapRoleEntry(input: PlantMapRoleInput): Promise<PlantMapRoleEntry> {
  const email = input.email.trim().toLowerCase();
  if (USE_MOCK) {
    if (mockRoles.some((e) => e.email === email)) throw new Error(`${email} is already on the Plant Map Roles list.`);
    const entry: PlantMapRoleEntry = {
      id: Math.max(0, ...mockRoles.map((e) => e.id)) + 1,
      email,
      displayName: input.displayName.trim(),
      roles: parsePlantMapRoles([...input.roles]),
      note: input.note.trim(),
    };
    mockRoles = [...mockRoles, entry];
    return mockDelay({ ...entry, roles: [...entry.roles] });
  }
  const created = await graphFetch<GraphListItem>(rolesPath(), {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Title: email,
        PersonName: input.displayName.trim(),
        Roles: serializePlantMapRoles(input.roles),
        Note: input.note.trim(),
      },
    }),
  });
  return toPlantMapRoleEntry(created);
}

/** Only the keys given are written. */
export async function updatePlantMapRoleEntry(input: { id: number; roles?: PlantMapRole[]; note?: string }): Promise<void> {
  if (USE_MOCK) {
    mockRoles = mockRoles.map((e) =>
      e.id === input.id
        ? {
            ...e,
            ...(input.roles !== undefined && { roles: parsePlantMapRoles([...input.roles]) }),
            ...(input.note !== undefined && { note: input.note.trim() }),
          }
        : e,
    );
    await mockDelay(null);
    return;
  }
  const fields: Record<string, unknown> = {};
  if (input.roles !== undefined) fields.Roles = serializePlantMapRoles(input.roles);
  if (input.note !== undefined) fields.Note = input.note.trim();
  if (Object.keys(fields).length === 0) return;
  await graphFetch(`${rolesPath()}/${input.id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deletePlantMapRoleEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    mockRoles = mockRoles.filter((e) => e.id !== id);
    await mockDelay(null);
    return;
  }
  await graphFetch(`${rolesPath()}/${id}`, { method: "DELETE" });
}
