import type { GraphListItem, PanelRole, PanelRoleEntry, Person } from "@/types/task";
import { PANEL_ROLE_CHOICES } from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_ROLES_LIST_ID, USE_MOCK } from "./config";
import { listPanelSiteUsers } from "./panelOrders";
import { MOCK_PANEL_ROLES } from "@/data/panelMockData";
import { mockDelay } from "./mockLatency";

// =============================================================================
// Panel User Roles list — one row per user PER role (User person column +
// single Role choice), unlike EIR Roles' email/CSV shape. Managed only at
// /admin/panel-roles. The role → editing-rights mapping is in
// lib/panelRoles.ts; v1 gates no fields, so this list is bookkeeping until
// the first gated field is wired.
//
// Person-column note: the single `User` column returns only a bare
// UserLookupId via Graph — display names are joined from the panel site's
// user directory (listPanelSiteUsers). Writes are the plain scalar
// `UserLookupId` int (no @odata.type annotation on single-value fields).
//
// `OnCapacity` (yes/no, Tim 2026-10-30) gives a non-Engineer a row on Panel
// Engineering Capacity. scripts/setup-panel-planning.ps1 adds it. This list
// decides who may open the panel planning tools at all, so a read must never
// fail for want of that column: it retries once without it and remembers
// (the MRB Watchers arrangement).
// =============================================================================

/**
 * Does the list have the OnCapacity column? `null` = not yet known; `false`
 * once a read asking for it was refused and the read without it worked.
 */
let onCapacityColumn: boolean | null = null;

/** Whether the On capacity toggle can be read or written. The admin screen asks. */
export function panelRolesOnCapacityAvailable(): boolean {
  return USE_MOCK || onCapacityColumn !== false;
}

function rolesSelect(withOnCapacity: boolean): string {
  return `Title,UserLookupId,User,Role${withOnCapacity ? ",OnCapacity" : ""}`;
}

async function withOnCapacityFallback<T>(read: (select: string) => Promise<T>): Promise<T> {
  if (onCapacityColumn === false) return read(rolesSelect(false));
  try {
    const result = await read(rolesSelect(true));
    onCapacityColumn = true;
    return result;
  } catch (err) {
    // Only retry while it's still unknown; a later failure is something else.
    if (onCapacityColumn !== null) throw err;
    const result = await read(rolesSelect(false));
    onCapacityColumn = false;
    return result;
  }
}

const ON_CAPACITY_MISSING =
  "The Panel User Roles list has no OnCapacity column yet — run scripts/setup-panel-planning.ps1, then refresh.";

let mockStore: PanelRoleEntry[] = MOCK_PANEL_ROLES.map((e) => ({ ...e }));

function clampRole(raw: unknown): PanelRole | null {
  return typeof raw === "string" && (PANEL_ROLE_CHOICES as readonly string[]).includes(raw)
    ? (raw as PanelRole)
    : null;
}

function toInt(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export async function listPanelRoles(): Promise<PanelRoleEntry[]> {
  if (USE_MOCK) {
    return mockDelay(mockStore.map((e) => ({ ...e })));
  }
  if (!SP_PANEL_ROLES_LIST_ID) return [];

  const listId = SP_PANEL_ROLES_LIST_ID;
  const [items, users] = await Promise.all([
    withOnCapacityFallback((select) =>
      graphFetchAll<GraphListItem>(
        `/sites/${SITES.panelTeam}/lists/${listId}/items?$expand=fields($select=${select})&$top=200`,
      ),
    ),
    listPanelSiteUsers(),
  ]);

  return items.map((it) => {
    const f = it.fields as Record<string, unknown>;
    const lookupId = toInt(f.UserLookupId);
    const user: Person | null = lookupId
      ? users.get(lookupId) ?? { lookupId, displayName: "" }
      : null;
    return {
      id: parseInt(it.id, 10),
      user,
      role: clampRole(f.Role),
      note: typeof f.Title === "string" ? f.Title : "",
      onCapacity: f.OnCapacity === true,
    };
  });
}

export async function addPanelRole(input: {
  user: Person;
  role: PanelRole;
  note?: string;
  onCapacity?: boolean;
}): Promise<PanelRoleEntry> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((e) => e.id)) + 1;
    const entry: PanelRoleEntry = {
      id: nextId,
      user: input.user,
      role: input.role,
      note: input.note ?? "",
      onCapacity: input.onCapacity ?? false,
    };
    mockStore = [...mockStore, entry];
    return mockDelay({ ...entry });
  }
  if (!SP_PANEL_ROLES_LIST_ID) {
    throw new Error("Cannot add panel role: VITE_SP_PANEL_ROLES_LIST_ID is not set.");
  }
  if (!input.user.lookupId) {
    throw new Error(
      "Cannot add panel role: the selected user has no resolved SharePoint lookupId.",
    );
  }
  if (input.onCapacity && !panelRolesOnCapacityAvailable()) throw new Error(ON_CAPACITY_MISSING);
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ROLES_LIST_ID}/items`,
    {
      method: "POST",
      body: JSON.stringify({
        fields: {
          Title: input.note ?? "",
          UserLookupId: input.user.lookupId,
          Role: input.role,
          // Only sent when Yes, so a list without the column still takes a row.
          ...(input.onCapacity ? { OnCapacity: true } : {}),
        },
      }),
    },
  );
  return {
    id: parseInt(created.id, 10),
    user: input.user,
    role: input.role,
    note: input.note ?? "",
    onCapacity: input.onCapacity ?? false,
  };
}

export async function updatePanelRole(input: {
  id: number;
  role?: PanelRole;
  note?: string;
  onCapacity?: boolean;
}): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.map((e) =>
      e.id === input.id
        ? {
            ...e,
            role: input.role !== undefined ? input.role : e.role,
            note: input.note !== undefined ? input.note : e.note,
            onCapacity: input.onCapacity !== undefined ? input.onCapacity : e.onCapacity,
          }
        : e,
    );
    await mockDelay(null);
    return;
  }
  if (!SP_PANEL_ROLES_LIST_ID) {
    throw new Error("Cannot update panel role: VITE_SP_PANEL_ROLES_LIST_ID is not set.");
  }
  if (input.onCapacity !== undefined && !panelRolesOnCapacityAvailable()) {
    throw new Error(ON_CAPACITY_MISSING);
  }
  const fields: Record<string, string | boolean> = {};
  if (input.role !== undefined) fields.Role = input.role;
  if (input.note !== undefined) fields.Title = input.note;
  if (input.onCapacity !== undefined) fields.OnCapacity = input.onCapacity;
  await graphFetch(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ROLES_LIST_ID}/items/${input.id}/fields`,
    { method: "PATCH", body: JSON.stringify(fields) },
  );
}

export async function removePanelRole(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    await mockDelay(null);
    return;
  }
  if (!SP_PANEL_ROLES_LIST_ID) {
    throw new Error("Cannot remove panel role: VITE_SP_PANEL_ROLES_LIST_ID is not set.");
  }
  await graphFetch(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_ROLES_LIST_ID}/items/${id}`, {
    method: "DELETE",
  });
}

/** Demo-mode-only: reset the roles mock store (used by tests). */
export function resetPanelRolesMockStore(): void {
  mockStore = MOCK_PANEL_ROLES.map((e) => ({ ...e }));
  onCapacityColumn = null;
}
