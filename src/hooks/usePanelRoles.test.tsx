import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PanelRoleEntry } from "@/types/task";

// Panel User Roles: who holds which role, the signed-in user's effective rights,
// and the admin-only write guard. Mirrors useMaintenanceRoles.guard.test.tsx.
// USE_MOCK is true under Vitest, so PANEL_ROLES_ENFORCED is true here.

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  email: "tech.one@altronic-llc.com",
  entries: [] as PanelRoleEntry[],
}));

vi.mock("./useIsAdmin", () => ({ useIsAdmin: () => mocks.isAdmin }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "U", email: mocks.email, lookupId: 0 }),
}));
vi.mock("@/api/panelRoles", () => ({
  listPanelRoles: vi.fn(async () => mocks.entries),
  addPanelRole: vi.fn().mockResolvedValue({ id: 9 }),
  updatePanelRole: vi.fn().mockResolvedValue(undefined),
  removePanelRole: vi.fn().mockResolvedValue(undefined),
}));

import {
  useAddPanelRole,
  useMyPanelRoles,
  usePanelRoles,
  useRemovePanelRole,
  useUpdatePanelRole,
} from "./usePanelRoles";
import { addPanelRole, removePanelRole, updatePanelRole } from "@/api/panelRoles";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const person = (email: string) => ({ displayName: email, email, lookupId: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
  mocks.email = "tech.one@altronic-llc.com";
  mocks.entries = [
    { id: 1, user: person("Tech.One@altronic-llc.com"), role: "Tech", note: "", onCapacity: false },
    { id: 2, user: person("tech.one@altronic-llc.com"), role: "Engineer", note: "", onCapacity: false },
    { id: 3, user: person("someone.else@altronic-llc.com"), role: "Admin", note: "", onCapacity: false },
    { id: 4, user: person("tech.one@altronic-llc.com"), role: null, note: "blank role row", onCapacity: false },
  ];
});

describe("useMyPanelRoles", () => {
  it("collects every role row for the signed-in user, case-insensitively, and drops blank roles", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useMyPanelRoles(), { wrapper });
    await waitFor(() => expect(result.current.roles).toHaveLength(2));
    expect(result.current.roles.sort()).toEqual(["Engineer", "Tech"]);
    expect(result.current).toMatchObject({ production: true, engineering: true, enforced: true });
  });

  it("gives no rights to someone with no rows", async () => {
    mocks.email = "nobody@altronic-llc.com";
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => ({ mine: useMyPanelRoles(), list: usePanelRoles() }), { wrapper });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.mine).toMatchObject({ roles: [], production: false, engineering: false });
  });

  it("gives no rights when the user has no address yet", async () => {
    mocks.email = "";
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => ({ mine: useMyPanelRoles(), list: usePanelRoles() }), { wrapper });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.mine.roles).toEqual([]);
  });
});

describe("Panel User Roles mutation guards", () => {
  it("lets an admin add, update and remove", async () => {
    const { wrapper } = makeWrapper();
    const add = renderHook(() => useAddPanelRole(), { wrapper });
    await add.result.current.mutateAsync({ user: person("n@altronic-llc.com"), role: "Tech", note: "", onCapacity: false });
    const upd = renderHook(() => useUpdatePanelRole(), { wrapper });
    await upd.result.current.mutateAsync({ id: 1, role: "Manager" });
    const rem = renderHook(() => useRemovePanelRole(), { wrapper });
    await rem.result.current.mutateAsync(1);
    expect(addPanelRole).toHaveBeenCalledTimes(1);
    expect(updatePanelRole).toHaveBeenCalledTimes(1);
    expect(removePanelRole).toHaveBeenCalledWith(1);
  });

  it("refuses every write for a non-admin, whatever the caller", async () => {
    mocks.isAdmin = false;
    const { wrapper } = makeWrapper();
    const add = renderHook(() => useAddPanelRole(), { wrapper });
    const upd = renderHook(() => useUpdatePanelRole(), { wrapper });
    const rem = renderHook(() => useRemovePanelRole(), { wrapper });
    await expect(
      add.result.current.mutateAsync({ user: person("n@altronic-llc.com"), role: "Tech", note: "", onCapacity: false }),
    ).rejects.toThrow(/Only admins/);
    await expect(upd.result.current.mutateAsync({ id: 1, role: "Manager" })).rejects.toThrow(/Only admins/);
    await expect(rem.result.current.mutateAsync(1)).rejects.toThrow(/Only admins/);
    expect(addPanelRole).not.toHaveBeenCalled();
    expect(updatePanelRole).not.toHaveBeenCalled();
    expect(removePanelRole).not.toHaveBeenCalled();
  });

  it("puts a removed row back when the delete fails", async () => {
    vi.mocked(removePanelRole).mockRejectedValueOnce(new Error("403"));
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => ({ list: usePanelRoles(), rem: useRemovePanelRole() }), { wrapper });
    await waitFor(() => expect(result.current.list.data).toHaveLength(4));
    await expect(result.current.rem.mutateAsync(3)).rejects.toThrow("403");
    const cached = qc.getQueryData<PanelRoleEntry[]>(["panel-roles", "list"]);
    expect(cached?.some((e) => e.id === 3)).toBe(true);
  });
});
