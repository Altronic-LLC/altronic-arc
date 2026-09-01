import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MaintenanceAccess } from "@/lib/maintenanceRoles";

// =============================================================================
// The reference-list hooks, and the gate on them.
//
// `manageAssetsGate` — "manage the asset register, departments and locations",
// maintenance admins only — was written when the CMMS roles landed and had no
// caller until this feature. These tests pin that it is asked INSIDE each
// `mutationFn`, not only by the admin screen: defence in depth, so a future
// bulk action can't write without the check. Reading stays open to anyone
// signed in, because the whole point is that everybody sees the value on the
// record in front of them.
// =============================================================================

const access = vi.hoisted(() => ({
  value: { isTech: true, isAdmin: true, enforced: true, isResolving: false } as MaintenanceAccess,
}));

vi.mock("./useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => access.value,
  useResolveMaintenanceAccess: () => async () => access.value,
}));

const api = vi.hoisted(() => ({
  list: vi.fn(async () => [{ lookupId: 4, title: "MACH SHOP", active: true, note: "" }]),
  create: vi.fn(async () => ({ lookupId: 11, title: "TOOL ROOM", active: true, note: "" })),
  update: vi.fn(async () => ({ lookupId: 4, title: "MACHINE SHOP", active: true, note: "" })),
  setActive: vi.fn(async () => ({ lookupId: 4, title: "MACH SHOP", active: false, note: "" })),
}));

vi.mock("@/api/maintenanceReferenceLists", () => ({
  listMaintenanceReferenceValues: api.list,
  createMaintenanceReferenceValue: api.create,
  updateMaintenanceReferenceValue: api.update,
  setMaintenanceReferenceValueActive: api.setActive,
}));

import {
  useCreateMaintenanceReferenceValue,
  useMaintenanceDepartments,
  useMaintenanceLocations,
  useSetMaintenanceReferenceValueActive,
  useUpdateMaintenanceReferenceValue,
} from "./useMaintenanceReferenceLists";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  access.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
});

describe("reads", () => {
  it("reads each list by its own kind", async () => {
    const departments = renderHook(() => useMaintenanceDepartments(), { wrapper });
    await waitFor(() => expect(departments.result.current.data).toBeDefined());
    expect(api.list).toHaveBeenCalledWith("departments");

    const locations = renderHook(() => useMaintenanceLocations(), { wrapper });
    await waitFor(() => expect(locations.result.current.data).toBeDefined());
    expect(api.list).toHaveBeenCalledWith("locations");
  });

  it("reads for a NON-admin too — everyone has to see the value on their record", async () => {
    access.value = { isTech: false, isAdmin: false, enforced: true, isResolving: false };
    const { result } = renderHook(() => useMaintenanceDepartments(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });
});

describe("write guards — manageAssetsGate", () => {
  it("lets a maintenance admin add, rename and retire", async () => {
    const create = renderHook(() => useCreateMaintenanceReferenceValue(), { wrapper });
    await create.result.current.mutateAsync({
      kind: "departments",
      input: { title: "TOOL ROOM" },
    });
    expect(api.create).toHaveBeenCalledWith("departments", { title: "TOOL ROOM" });

    const update = renderHook(() => useUpdateMaintenanceReferenceValue(), { wrapper });
    await update.result.current.mutateAsync({
      kind: "departments",
      lookupId: 4,
      input: { title: "MACHINE SHOP" },
    });
    expect(api.update).toHaveBeenCalledWith("departments", 4, { title: "MACHINE SHOP" });

    const retire = renderHook(() => useSetMaintenanceReferenceValueActive(), { wrapper });
    await retire.result.current.mutateAsync({ kind: "departments", lookupId: 4, active: false });
    expect(api.setActive).toHaveBeenCalledWith("departments", 4, false);
  });

  it("REFUSES a tech who is not a maintenance admin, before touching the API", async () => {
    access.value = { isTech: true, isAdmin: false, enforced: true, isResolving: false };

    const create = renderHook(() => useCreateMaintenanceReferenceValue(), { wrapper });
    await expect(
      create.result.current.mutateAsync({ kind: "locations", input: { title: "BAY 4" } }),
    ).rejects.toThrow(/maintenance admins/i);
    expect(api.create).not.toHaveBeenCalled();

    const update = renderHook(() => useUpdateMaintenanceReferenceValue(), { wrapper });
    await expect(
      update.result.current.mutateAsync({ kind: "locations", lookupId: 4, input: { title: "X" } }),
    ).rejects.toThrow(/maintenance admins/i);
    expect(api.update).not.toHaveBeenCalled();

    const retire = renderHook(() => useSetMaintenanceReferenceValueActive(), { wrapper });
    await expect(
      retire.result.current.mutateAsync({ kind: "locations", lookupId: 4, active: false }),
    ).rejects.toThrow(/maintenance admins/i);
    expect(api.setActive).not.toHaveBeenCalled();
  });

  // Lockout safety: an unconfigured Maintenance Roles list means "everyone
  // keeps what they can do today", never "nobody can do anything".
  it("allows everything when role gating is not enforced", async () => {
    access.value = { isTech: false, isAdmin: false, enforced: false, isResolving: false };
    const create = renderHook(() => useCreateMaintenanceReferenceValue(), { wrapper });
    await create.result.current.mutateAsync({ kind: "departments", input: { title: "TOOL ROOM" } });
    expect(api.create).toHaveBeenCalled();
  });
});
