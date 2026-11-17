import { graphFetch, graphFetchAll } from "./graph";
import { HR_SITE_ID, SP_HR_ROLES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { HrRole, HrRoleEntry, HrRoleInput } from "@/types/hr";
import { parseHrRoles, serializeHrRoles } from "@/lib/hrRoles";
import { MOCK_HR_ROLES } from "@/data/hrMockData";

// =============================================================================
// HR Roles — who sees which HR app. On the HR site (not created yet — see the
// HR block in config.ts), managed in ARC at /hr/roles by an HR admin or an ARC
// admin.
//
// Title = email, `PersonName` (NEVER `DisplayName` — Graph silently drops a
// listItem field of that name), `Roles` (lowercase CSV of HR_ROLES), `Note`.
// Rows CAN be deleted: a person with no tags is nobody to this list.
//
// Everyone who might hold a role must be able to READ this list, or their
// access reads as none. That is the safe direction: an unreadable list hides
// HR, it never shows it.
// =============================================================================

let mockRoles: HrRoleEntry[] = MOCK_HR_ROLES.map((e) => ({ ...e, roles: [...e.roles] }));

/** For tests: put the mock store back. */
export function __resetHrRoleMockStore(): void {
  mockRoles = MOCK_HR_ROLES.map((e) => ({ ...e, roles: [...e.roles] }));
}

function rolesPath(): string {
  if (!HR_SITE_ID || !SP_HR_ROLES_LIST_ID) {
    throw new Error("HR Roles isn't set up yet: VITE_SP_HR_SITE_ID / VITE_SP_HR_ROLES_LIST_ID is not set.");
  }
  return `/sites/${HR_SITE_ID}/lists/${SP_HR_ROLES_LIST_ID}/items`;
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

export function toHrRoleEntry(item: GraphListItem): HrRoleEntry {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    email: text(f.Title).trim().toLowerCase(),
    displayName: text(f.PersonName).trim(),
    roles: parseHrRoles(f.Roles),
    note: text(f.Note).trim(),
  };
}

/** Everyone on the list. An unset list reads as empty — nobody sees HR. */
export async function listHrRoleEntries(): Promise<HrRoleEntry[]> {
  if (USE_MOCK) return mockDelay(mockRoles.map((e) => ({ ...e, roles: [...e.roles] })));
  if (!HR_SITE_ID || !SP_HR_ROLES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${rolesPath()}?$expand=fields($select=Title,PersonName,Roles,Note)&$top=500`,
  );
  return items.map(toHrRoleEntry);
}

export async function createHrRoleEntry(input: HrRoleInput): Promise<HrRoleEntry> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("Pick a person with an email address.");
  if (USE_MOCK) {
    if (mockRoles.some((e) => e.email === email)) throw new Error(`${email} is already on the HR access list.`);
    const entry: HrRoleEntry = {
      id: Math.max(0, ...mockRoles.map((e) => e.id)) + 1,
      email,
      displayName: input.displayName.trim(),
      roles: parseHrRoles([...input.roles]),
      note: input.note.trim(),
    };
    mockRoles = [...mockRoles, entry];
    return mockDelay({ ...entry });
  }
  const created = await graphFetch<GraphListItem>(rolesPath(), {
    method: "POST",
    body: JSON.stringify({
      fields: { Title: email, PersonName: input.displayName.trim(), Roles: serializeHrRoles(input.roles), Note: input.note.trim() },
    }),
  });
  return toHrRoleEntry(created);
}

/** Only the keys given are written. */
export async function updateHrRoleEntry(input: { id: number; roles?: HrRole[]; note?: string }): Promise<void> {
  if (USE_MOCK) {
    mockRoles = mockRoles.map((e) =>
      e.id === input.id
        ? {
            ...e,
            ...(input.roles !== undefined && { roles: parseHrRoles([...input.roles]) }),
            ...(input.note !== undefined && { note: input.note.trim() }),
          }
        : e,
    );
    await mockDelay(null);
    return;
  }
  const fields: Record<string, unknown> = {};
  if (input.roles !== undefined) fields.Roles = serializeHrRoles(input.roles);
  if (input.note !== undefined) fields.Note = input.note.trim();
  if (Object.keys(fields).length === 0) return;
  await graphFetch(`${rolesPath()}/${input.id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteHrRoleEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    mockRoles = mockRoles.filter((e) => e.id !== id);
    await mockDelay(null);
    return;
  }
  await graphFetch(`${rolesPath()}/${id}`, { method: "DELETE" });
}
