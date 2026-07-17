import type { GraphListItem, PanelRole, PanelRoleEntry, Person } from "@/types/task";
import { PANEL_ROLE_CHOICES } from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_ROLES_LIST_ID, USE_MOCK } from "./config";
import { listPanelSiteUsers } from "./panelOrders";
import { MOCK_PANEL_ROLES } from "@/data/panelMockData";

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
// =============================================================================

let mockStore: PanelRoleEntry[] = MOCK_PANEL_ROLES.map((e) => ({ ...e }));

function delay<T>(value: T, ms = 60): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

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
    return delay(mockStore.map((e) => ({ ...e })));
  }
  if (!SP_PANEL_ROLES_LIST_ID) return [];

  const [items, users] = await Promise.all([
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ROLES_LIST_ID}/items` +
        `?$expand=fields($select=Title,UserLookupId,User,Role)&$top=200`,
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
    };
  });
}

export async function addPanelRole(input: {
  user: Person;
  role: PanelRole;
  note?: string;
}): Promise<PanelRoleEntry> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((e) => e.id)) + 1;
    const entry: PanelRoleEntry = {
      id: nextId,
      user: input.user,
      role: input.role,
      note: input.note ?? "",
    };
    mockStore = [...mockStore, entry];
    return delay({ ...entry });
  }
  if (!SP_PANEL_ROLES_LIST_ID) {
    throw new Error("Cannot add panel role: VITE_SP_PANEL_ROLES_LIST_ID is not set.");
  }
  if (!input.user.lookupId) {
    throw new Error(
      "Cannot add panel role: the selected user has no resolved SharePoint lookupId.",
    );
  }
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ROLES_LIST_ID}/items`,
    {
      method: "POST",
      body: JSON.stringify({
        fields: {
          Title: input.note ?? "",
          UserLookupId: input.user.lookupId,
          Role: input.role,
        },
      }),
    },
  );
  return {
    id: parseInt(created.id, 10),
    user: input.user,
    role: input.role,
    note: input.note ?? "",
  };
}

export async function updatePanelRole(input: {
  id: number;
  role?: PanelRole;
  note?: string;
}): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.map((e) =>
      e.id === input.id
        ? {
            ...e,
            role: input.role !== undefined ? input.role : e.role,
            note: input.note !== undefined ? input.note : e.note,
          }
        : e,
    );
    await delay(null);
    return;
  }
  if (!SP_PANEL_ROLES_LIST_ID) {
    throw new Error("Cannot update panel role: VITE_SP_PANEL_ROLES_LIST_ID is not set.");
  }
  const fields: Record<string, string> = {};
  if (input.role !== undefined) fields.Role = input.role;
  if (input.note !== undefined) fields.Title = input.note;
  await graphFetch(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ROLES_LIST_ID}/items/${input.id}/fields`,
    { method: "PATCH", body: JSON.stringify(fields) },
  );
}

export async function removePanelRole(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    await delay(null);
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
}
