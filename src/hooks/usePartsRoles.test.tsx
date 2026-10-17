import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PartsRoleEntry } from "@/types/task";

// Parts Roles: who may add, edit and approve parts. The rules that matter most:
// a person is matched on ANY of their addresses, a failed read REFUSES a write
// rather than granting it, and only admins change the list.
// USE_MOCK is true under Vitest, so PARTS_ROLES_CONFIGURED is true here.

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  emails: ["steve.pirko@altronic-llc.com", "steven.pirko@altronic-llc.com"],
  entries: [] as PartsRoleEntry[],
  listFails: false,
}));

vi.mock("./useIsAdmin", () => ({ useIsAdmin: () => mocks.isAdmin }));
vi.mock("./useCurrentUser", () => ({ useCurrentUserEmails: () => mocks.emails }));
vi.mock("@/api/partsRoles", () => ({
  listPartsRoles: vi.fn(async () => {
    if (mocks.listFails) throw new Error("Graph 503");
    return mocks.entries;
  }),
  addPartsRole: vi.fn(async (e: Omit<PartsRoleEntry, "id">) => ({ ...e, id: 99 })),
  updatePartsRole: vi.fn().mockResolvedValue(undefined),
  removePartsRole: vi.fn().mockResolvedValue(undefined),
}));

import {
  PARTS_ROLES_KEY,
  resolvePartsAccess,
  resolvePartsPeople,
  useAddPartsRole,
  useMyPartsAccess,
  useRemovePartsRole,
  useUpdatePartsRole,
} from "./usePartsRoles";
import { addPartsRole, removePartsRole, updatePartsRole } from "@/api/partsRoles";

function makeQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}
function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
  mocks.listFails = false;
  mocks.emails = ["steve.pirko@altronic-llc.com", "steven.pirko@altronic-llc.com"];
  mocks.entries = [
    { id: 1, email: "Steven.Pirko@altronic-llc.com", displayName: "Steven Pirko", roles: ["reviewing engineer"], note: "" },
    { id: 2, email: "sap.admin@altronic-llc.com", displayName: "", roles: ["sap admin"], note: "" },
    { id: 3, email: "editor@altronic-llc.com", displayName: "Ed Itor", roles: ["editor"], note: "" },
    { id: 4, email: "", displayName: "No address", roles: ["reviewing engineer"], note: "" },
  ];
});

describe("resolvePartsAccess (inside a mutationFn)", () => {
  // The mailbox and the sign-in name differ for some people; the row holds the
  // mailbox. Matching only the sign-in name is how a role silently didn't apply.
  it("matches the user on any of their addresses", async () => {
    const access = await resolvePartsAccess(makeQc(), mocks.emails);
    expect(access).toEqual({ roles: ["reviewing engineer"], configured: true, resolving: false, failed: false });
  });

  it("gives no roles to someone not on the list", async () => {
    const access = await resolvePartsAccess(makeQc(), ["stranger@altronic-llc.com"]);
    expect(access.roles).toEqual([]);
  });

  it("REFUSES rather than grants when the list can't be read", async () => {
    mocks.listFails = true;
    await expect(resolvePartsAccess(makeQc(), mocks.emails)).rejects.toThrow(
      /Couldn't check your Parts List roles.*Graph 503/,
    );
  });
});

describe("resolvePartsPeople (who to e-mail)", () => {
  it("returns the reviewing engineers with an address, named", async () => {
    const people = await resolvePartsPeople(makeQc(), "approveEngineering");
    expect(people).toEqual([{ displayName: "Steven Pirko", email: "Steven.Pirko@altronic-llc.com" }]);
  });

  it("falls back to the address when a row has no display name", async () => {
    const people = await resolvePartsPeople(makeQc(), "approveSap");
    expect(people).toEqual([{ displayName: "sap.admin@altronic-llc.com", email: "sap.admin@altronic-llc.com" }]);
  });
});

describe("useMyPartsAccess (for rendering)", () => {
  it("reports resolving while the list loads, then the user's roles", async () => {
    const qc = makeQc();
    const { result } = renderHook(() => useMyPartsAccess(), { wrapper: wrapperFor(qc) });
    expect(result.current.resolving).toBe(true);
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.roles).toEqual(["reviewing engineer"]);
  });

  it("reports failed, with no roles, when the list can't be read", async () => {
    mocks.listFails = true;
    const { result } = renderHook(() => useMyPartsAccess(), { wrapper: wrapperFor(makeQc()) });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.roles).toEqual([]);
  });
});

describe("Parts Roles mutation guards", () => {
  const entry = { email: "n@altronic-llc.com", displayName: "N", roles: ["editor" as const], note: "" };

  it("lets an admin add (cached at once), update and remove", async () => {
    const qc = makeQc();
    qc.setQueryData(PARTS_ROLES_KEY, mocks.entries);
    const wrapper = wrapperFor(qc);
    const add = renderHook(() => useAddPartsRole(), { wrapper });
    await add.result.current.mutateAsync(entry);
    expect(addPartsRole).toHaveBeenCalledTimes(1);
    const upd = renderHook(() => useUpdatePartsRole(), { wrapper });
    await upd.result.current.mutateAsync({ id: 3, roles: ["hco editor"] });
    const rem = renderHook(() => useRemovePartsRole(), { wrapper });
    await rem.result.current.mutateAsync(3);
    expect(updatePartsRole).toHaveBeenCalledTimes(1);
    expect(removePartsRole).toHaveBeenCalledWith(3);
  });

  it("refuses every write for a non-admin", async () => {
    mocks.isAdmin = false;
    const wrapper = wrapperFor(makeQc());
    const add = renderHook(() => useAddPartsRole(), { wrapper });
    const upd = renderHook(() => useUpdatePartsRole(), { wrapper });
    const rem = renderHook(() => useRemovePartsRole(), { wrapper });
    await expect(add.result.current.mutateAsync(entry)).rejects.toThrow(/Only ARC admins/);
    await expect(upd.result.current.mutateAsync({ id: 3, roles: [] })).rejects.toThrow(/Only ARC admins/);
    await expect(rem.result.current.mutateAsync(3)).rejects.toThrow(/Only ARC admins/);
    expect(addPartsRole).not.toHaveBeenCalled();
    expect(updatePartsRole).not.toHaveBeenCalled();
    expect(removePartsRole).not.toHaveBeenCalled();
  });

  it("restores a role edit when the write fails", async () => {
    vi.mocked(updatePartsRole).mockRejectedValueOnce(new Error("409"));
    const qc = makeQc();
    qc.setQueryData(PARTS_ROLES_KEY, mocks.entries);
    const upd = renderHook(() => useUpdatePartsRole(), { wrapper: wrapperFor(qc) });
    await expect(upd.result.current.mutateAsync({ id: 3, roles: ["sap admin"] })).rejects.toThrow("409");
    const cached = qc.getQueryData<PartsRoleEntry[]>(PARTS_ROLES_KEY);
    expect(cached?.find((e) => e.id === 3)?.roles).toEqual(["editor"]);
  });
});
