import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mirrors useEirRoles.guard.test.tsx. The admin view already hides these write
// controls; these guards make sure no OTHER call path can write either, so a
// future screen or bulk action can't quietly acquire the ability.

const mocks = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => mocks.isAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.isAdmin, isResolving: false }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "U", email: "u@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["u@altronic-llc.com"],
}));
vi.mock("@/api/maintenanceRoles", () => ({
  listMaintenanceRoles: vi.fn().mockResolvedValue([]),
  addMaintenanceRole: vi.fn().mockResolvedValue({ id: 1 }),
  updateMaintenanceRole: vi.fn().mockResolvedValue(undefined),
  removeMaintenanceRole: vi.fn().mockResolvedValue(undefined),
}));

import {
  useAddMaintenanceRole,
  useRemoveMaintenanceRole,
  useUpdateMaintenanceRole,
} from "./useMaintenanceRoles";
import {
  addMaintenanceRole,
  removeMaintenanceRole,
  updateMaintenanceRole,
} from "@/api/maintenanceRoles";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const input = {
  email: "new.tech@altronic-llc.com",
  displayName: "New Tech",
  roles: ["tech"] as const,
  note: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
});

describe("useMaintenanceRoles mutation guards", () => {
  it("lets an admin add / update / remove a role entry", async () => {
    const add = renderHook(() => useAddMaintenanceRole(), { wrapper });
    await add.result.current.mutateAsync({ ...input, roles: [...input.roles] });
    expect(addMaintenanceRole as Mock).toHaveBeenCalled();

    const upd = renderHook(() => useUpdateMaintenanceRole(), { wrapper });
    await upd.result.current.mutateAsync({ id: 1, roles: ["admin"] });
    expect(updateMaintenanceRole as Mock).toHaveBeenCalled();

    const rem = renderHook(() => useRemoveMaintenanceRole(), { wrapper });
    await rem.result.current.mutateAsync(1);
    expect(removeMaintenanceRole as Mock).toHaveBeenCalled();
  });

  it("blocks a non-admin from add / update / remove, and never reaches SharePoint", async () => {
    mocks.isAdmin = false;

    const add = renderHook(() => useAddMaintenanceRole(), { wrapper });
    await expect(
      add.result.current.mutateAsync({ ...input, roles: [...input.roles] }),
    ).rejects.toThrow(/Only admins/i);

    const upd = renderHook(() => useUpdateMaintenanceRole(), { wrapper });
    await expect(upd.result.current.mutateAsync({ id: 1, roles: ["admin"] })).rejects.toThrow(
      /Only admins/i,
    );

    const rem = renderHook(() => useRemoveMaintenanceRole(), { wrapper });
    await expect(rem.result.current.mutateAsync(1)).rejects.toThrow(/Only admins/i);

    // The point of a guard in the mutationFn rather than only in the view.
    expect(addMaintenanceRole as Mock).not.toHaveBeenCalled();
    expect(updateMaintenanceRole as Mock).not.toHaveBeenCalled();
    expect(removeMaintenanceRole as Mock).not.toHaveBeenCalled();
  });

  // An optimistic patch that isn't rolled back leaves the table showing a row
  // that was never written — worse than the refusal itself.
  it("rolls the optimistic row back when a non-admin is refused", async () => {
    mocks.isAdmin = false;
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    qc.setQueryData(["maintenance-roles", "list"], []);
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const add = renderHook(() => useAddMaintenanceRole(), { wrapper: localWrapper });
    await expect(
      add.result.current.mutateAsync({ ...input, roles: [...input.roles] }),
    ).rejects.toThrow();
    expect(qc.getQueryData(["maintenance-roles", "list"])).toEqual([]);
  });
});
