import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_MCN_DISTRIBUTION_GROUPS_LIST_ID, SP_MCN_ROLES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, Person } from "@/types/task";
import type { McnDistributionGroup, McnRole, McnRoleEntry, McnRoleInput } from "@/types/mcn";
import { parseMcnRoles, serializeMcnRoles } from "@/lib/mcnRoles";
import { parsePeopleLines, serializePeopleLines } from "@/lib/mcnFields";
import { readNumber, text } from "@/lib/maintenanceShared";
import { MOCK_MCN_DISTRIBUTION_GROUPS, MOCK_MCN_ROLES } from "@/data/mcnMockData";

// =============================================================================
// MCN Roles and MCN Distribution Groups — the two small lists behind who may
// do what with MCNs and who an approved MCN goes to. Both on Altronic_PMO,
// both managed from MCN Settings in ARC by an MCN admin or an ARC admin.
//
// MCN Roles: Title = email, `PersonName` (NEVER `DisplayName` — Graph silently
// drops a listItem field of that name), `Roles` (lowercase CSV), `Note`. Rows
// CAN be deleted: a person with no tags is nobody to this list.
//
// MCN Distribution Groups: Title = the role on the form, `Members` (one
// "Name <email>" per line — see lib/mcnFields.ts for why not a person
// column), `SortOrder`. The eight rows are seeded by the script; ARC edits
// their members and never adds or deletes a group.
// =============================================================================

let mockRoles: McnRoleEntry[] = MOCK_MCN_ROLES.map((e) => ({ ...e, roles: [...e.roles] }));
let mockGroups: McnDistributionGroup[] = MOCK_MCN_DISTRIBUTION_GROUPS.map((g) => ({ ...g, members: [...g.members] }));

/** For tests: put both mock stores back. */
export function __resetMcnRoleMockStores(): void {
  mockRoles = MOCK_MCN_ROLES.map((e) => ({ ...e, roles: [...e.roles] }));
  mockGroups = MOCK_MCN_DISTRIBUTION_GROUPS.map((g) => ({ ...g, members: [...g.members] }));
}

function rolesPath(): string {
  if (!SP_MCN_ROLES_LIST_ID) throw new Error("MCN Roles isn't set up yet: VITE_SP_MCN_ROLES_LIST_ID is not set.");
  return `/sites/${SITES.pmo}/lists/${SP_MCN_ROLES_LIST_ID}/items`;
}

function groupsPath(): string {
  if (!SP_MCN_DISTRIBUTION_GROUPS_LIST_ID) {
    throw new Error("MCN Distribution Groups isn't set up yet: VITE_SP_MCN_DISTRIBUTION_GROUPS_LIST_ID is not set.");
  }
  return `/sites/${SITES.pmo}/lists/${SP_MCN_DISTRIBUTION_GROUPS_LIST_ID}/items`;
}

export function toMcnRoleEntry(item: GraphListItem): McnRoleEntry {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    email: text(f.Title).trim().toLowerCase(),
    displayName: text(f.PersonName).trim(),
    roles: parseMcnRoles(f.Roles),
    note: text(f.Note).trim(),
  };
}

export function toMcnDistributionGroup(item: GraphListItem): McnDistributionGroup {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    role: text(f.Title).trim(),
    members: parsePeopleLines(f.Members),
    sortOrder: readNumber(f.SortOrder) ?? 999,
  };
}

// -----------------------------------------------------------------------------
// MCN Roles
// -----------------------------------------------------------------------------

/** Everyone on the list. An unset list reads as empty — nobody can raise. */
export async function listMcnRoleEntries(): Promise<McnRoleEntry[]> {
  if (USE_MOCK) return mockDelay(mockRoles.map((e) => ({ ...e, roles: [...e.roles] })));
  if (!SP_MCN_ROLES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(`${rolesPath()}?$expand=fields($select=Title,PersonName,Roles,Note)&$top=500`);
  return items.map(toMcnRoleEntry);
}

export async function createMcnRoleEntry(input: McnRoleInput): Promise<McnRoleEntry> {
  const email = input.email.trim().toLowerCase();
  if (USE_MOCK) {
    if (mockRoles.some((e) => e.email === email)) throw new Error(`${email} is already on the MCN team list.`);
    const entry: McnRoleEntry = {
      id: Math.max(0, ...mockRoles.map((e) => e.id)) + 1,
      email,
      displayName: input.displayName.trim(),
      roles: parseMcnRoles([...input.roles]),
      note: input.note.trim(),
    };
    mockRoles = [...mockRoles, entry];
    return mockDelay({ ...entry });
  }
  const created = await graphFetch<GraphListItem>(rolesPath(), {
    method: "POST",
    body: JSON.stringify({
      fields: { Title: email, PersonName: input.displayName.trim(), Roles: serializeMcnRoles(input.roles), Note: input.note.trim() },
    }),
  });
  return toMcnRoleEntry(created);
}

/** Only the keys given are written. */
export async function updateMcnRoleEntry(input: { id: number; roles?: McnRole[]; note?: string; displayName?: string }): Promise<void> {
  if (USE_MOCK) {
    mockRoles = mockRoles.map((e) =>
      e.id === input.id
        ? {
            ...e,
            ...(input.roles !== undefined && { roles: parseMcnRoles([...input.roles]) }),
            ...(input.note !== undefined && { note: input.note.trim() }),
            ...(input.displayName !== undefined && { displayName: input.displayName.trim() }),
          }
        : e,
    );
    await mockDelay(null);
    return;
  }
  const fields: Record<string, unknown> = {};
  if (input.roles !== undefined) fields.Roles = serializeMcnRoles(input.roles);
  if (input.note !== undefined) fields.Note = input.note.trim();
  if (input.displayName !== undefined) fields.PersonName = input.displayName.trim();
  if (Object.keys(fields).length === 0) return;
  await graphFetch(`${rolesPath()}/${input.id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteMcnRoleEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    mockRoles = mockRoles.filter((e) => e.id !== id);
    await mockDelay(null);
    return;
  }
  await graphFetch(`${rolesPath()}/${id}`, { method: "DELETE" });
}

// -----------------------------------------------------------------------------
// Distribution groups
// -----------------------------------------------------------------------------

export async function listMcnDistributionGroups(): Promise<McnDistributionGroup[]> {
  if (USE_MOCK) {
    return mockDelay(mockGroups.map((g) => ({ ...g, members: g.members.map((p) => ({ ...p })) })));
  }
  if (!SP_MCN_DISTRIBUTION_GROUPS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(`${groupsPath()}?$expand=fields($select=Title,Members,SortOrder)&$top=100`);
  return items.map(toMcnDistributionGroup).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Replace a group's members. */
export async function setMcnDistributionGroupMembers(id: number, members: Person[]): Promise<void> {
  if (USE_MOCK) {
    mockGroups = mockGroups.map((g) => (g.id === id ? { ...g, members: members.map((p) => ({ ...p })) } : g));
    await mockDelay(null);
    return;
  }
  await graphFetch(`${groupsPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Members: serializePeopleLines(members) }),
  });
}
