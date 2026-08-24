import type { OpenOrdersRole, OpenOrdersRoleEntry } from "@/types/task";
import { OPEN_ORDERS_ROLES } from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_OPEN_ORDERS_ROLES_LIST_ID, USE_MOCK } from "./config";

// =============================================================================
// Open Orders Roles list — who may edit the customer list and run the weekly
// generation. Deliberately the SAME shape as the EIR Roles list, because Ray
// asked for these permissions to work "like the eir permissions"
// (2026-08-24) and a second mechanism for the same job is how the two drift.
//
// Setup: scripts/create-open-orders-lists.ps1 creates it, or by hand —
//   1. A list on the ALTRONICSALESTEAM site called "Open Orders Roles".
//   2. The default Title column holds the user's EMAIL.
//   3. Single-line text columns `DisplayName`, `Note`, `Roles`.
//      `Roles` is a lowercase CSV of tags — today only "report manager".
//   4. Set VITE_SP_OPEN_ORDERS_ROLES_LIST_ID.
//
// Matching a person to a row goes through lib/emailIdentity.ts, never a
// display name and never `account.username` on its own — a sign-in name is not
// a mailbox, and that difference silently cost Steven Pirko his EIR access
// once already.
// =============================================================================

const LIST = () => SP_OPEN_ORDERS_ROLES_LIST_ID;

const MOCK_STORE: OpenOrdersRoleEntry[] = [
  {
    id: 1,
    email: "demo.user@altronic-llc.com",
    displayName: "Demo User",
    roles: ["report manager"],
    note: "Mock-mode default user — holds the role so the tool is fully usable",
  },
  {
    id: 2,
    email: "ray.white@altronic-llc.com",
    displayName: "Ray White",
    roles: ["report manager"],
    note: "",
  },
  {
    id: 3,
    email: "paul.mchenry@altronic-llc.com",
    displayName: "Paul McHenry",
    roles: [],
    note: "Regional manager — reads and downloads, doesn't run the weekly job",
  },
];

let mockStore: OpenOrdersRoleEntry[] | null = null;

function store(): OpenOrdersRoleEntry[] {
  mockStore ??= MOCK_STORE.map((e) => ({ ...e, roles: [...e.roles] }));
  return mockStore;
}

/** Test seam. */
export function resetMockOpenOrdersRoles(): void {
  mockStore = null;
}

/**
 * Parse the stored CSV into validated, de-duplicated tags.
 *
 * Unknown tokens are DROPPED rather than surfaced: a typo in SharePoint should
 * cost that person the role, not break the screen for everyone.
 */
export function parseOpenOrdersRoles(raw: string): OpenOrdersRole[] {
  const known = new Set<string>(OPEN_ORDERS_ROLES);
  const seen = new Set<OpenOrdersRole>();
  for (const part of raw.split(",")) {
    const tag = part.trim().toLowerCase();
    if (known.has(tag)) seen.add(tag as OpenOrdersRole);
  }
  return [...seen];
}

export function serialiseOpenOrdersRoles(roles: OpenOrdersRole[]): string {
  return [...new Set(roles)].join(",");
}

interface GraphItem {
  id: string;
  fields?: Record<string, unknown>;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function toEntry(item: GraphItem): OpenOrdersRoleEntry {
  const f = item.fields ?? {};
  return {
    id: Number.parseInt(item.id, 10),
    email: text(f.Title),
    displayName: text(f.DisplayName),
    roles: parseOpenOrdersRoles(text(f.Roles)),
    note: text(f.Note),
  };
}

export async function listOpenOrdersRoles(): Promise<OpenOrdersRoleEntry[]> {
  if (USE_MOCK) return store().map((e) => ({ ...e, roles: [...e.roles] }));
  // Not configured is not an error here: gating is off until the list exists
  // (OPEN_ORDERS_ROLES_ENFORCED), so an empty list is the correct answer and
  // throwing would break the screen that is meant to explain the situation.
  if (!LIST()) return [];
  const items = await graphFetchAll<GraphItem>(
    `/sites/${SITES.salesTeam}/lists/${LIST()}/items?$expand=fields($select=Title,DisplayName,Roles,Note)&$top=500`,
  );
  return items.map(toEntry).sort((a, b) => a.email.localeCompare(b.email));
}

export async function createOpenOrdersRole(
  entry: Omit<OpenOrdersRoleEntry, "id">,
): Promise<OpenOrdersRoleEntry> {
  if (USE_MOCK) {
    const s = store();
    const created = { ...entry, id: Math.max(0, ...s.map((e) => e.id)) + 1 };
    s.push(created);
    return { ...created, roles: [...created.roles] };
  }
  if (!LIST()) throw new Error("The Open Orders Roles list isn't configured yet.");
  const res = await graphFetch<GraphItem>(`/sites/${SITES.salesTeam}/lists/${LIST()}/items`, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Title: entry.email.trim().toLowerCase(),
        DisplayName: entry.displayName.trim(),
        Roles: serialiseOpenOrdersRoles(entry.roles),
        Note: entry.note.trim(),
      },
    }),
  });
  return toEntry(res);
}

export async function updateOpenOrdersRole(
  id: number,
  entry: Omit<OpenOrdersRoleEntry, "id">,
): Promise<OpenOrdersRoleEntry> {
  if (USE_MOCK) {
    const s = store();
    const index = s.findIndex((e) => e.id === id);
    if (index === -1) throw new Error(`No role entry with id ${id}.`);
    s[index] = { ...entry, id };
    return { ...s[index], roles: [...s[index].roles] };
  }
  if (!LIST()) throw new Error("The Open Orders Roles list isn't configured yet.");
  await graphFetch(`/sites/${SITES.salesTeam}/lists/${LIST()}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({
      Title: entry.email.trim().toLowerCase(),
      DisplayName: entry.displayName.trim(),
      Roles: serialiseOpenOrdersRoles(entry.roles),
      Note: entry.note.trim(),
    }),
  });
  return { ...entry, id };
}

export async function deleteOpenOrdersRole(id: number): Promise<void> {
  if (USE_MOCK) {
    const s = store();
    const index = s.findIndex((e) => e.id === id);
    if (index !== -1) s.splice(index, 1);
    return;
  }
  if (!LIST()) throw new Error("The Open Orders Roles list isn't configured yet.");
  await graphFetch(`/sites/${SITES.salesTeam}/lists/${LIST()}/items/${id}`, { method: "DELETE" });
}
