import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// `manageAssetsGate` on the equipment register.
//
// The gate was documented from the day the CMMS roles landed as covering "the
// asset register, departments and locations". Departments and locations asked
// it; **the asset register did not** — Asset Status and Responsible Tech were
// editable by anyone signed in, from the asset detail page, with no check
// anywhere. These cases pin the hole shut.
//
// The roles LIST is mocked rather than the access resolution, so every case
// runs the real chain: hook → resolveMaintenanceAccess → manageAssetsGate.
// Mocking `useResolveMaintenanceAccess` instead would mock away the thing
// under test, and would pass whether or not the gate is asked at all.
//
// The last block is the one that matters most. With the Maintenance Roles list
// unconfigured, gating is OFF and NOBODY is refused: an unconfigured list means
// "everyone keeps what they can do today", never "nobody can edit an asset".
// A gate that quietly ignored that flag would lock the shop out of its own
// register at the next deploy.
//
// `everyWrite()` also covers `useCreateEquipment` (added 2026-09-01) — adding
// it to that one array is what makes every case in this file exercise create
// automatically, rather than needing its own copy of each case.
// =============================================================================

const pushToast = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  enforced: true,
  arcAdmin: false,
  roles: [] as string[],
}));

vi.mock("@/components/Toast", () => ({ pushToast }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

const ME = { displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 999 };

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ME,
  useCurrentUserEmails: () => [ME.email],
}));
vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => mocks.arcAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.arcAdmin, isResolving: false }),
}));

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return {
    ...actual,
    get MAINTENANCE_ROLES_ENFORCED() {
      return mocks.enforced;
    },
  };
});

vi.mock("@/api/maintenanceRoles", () => ({
  listMaintenanceRoles: vi.fn(async () => [
    { id: 1, email: ME.email, displayName: ME.displayName, roles: mocks.roles, note: "" },
  ]),
}));

// The API is spied on so a refused write can be proved to have never reached
// it — "it threw" and "it threw before touching SharePoint" are different
// guarantees, and only the second is defence in depth.
const api = vi.hoisted(() => ({
  update: vi.fn(async () => ({}) as never),
  status: vi.fn(async () => ({}) as never),
  tech: vi.fn(async () => ({}) as never),
  warranty: vi.fn(async () => ({}) as never),
  hours: vi.fn(async () => ({}) as never),
  create: vi.fn(async () => ({}) as never),
}));

vi.mock("@/api/operationsEquipment", () => ({
  listEquipment: vi.fn(async () => []),
  updateEquipmentFields: api.update,
  setEquipmentAssetStatus: api.status,
  setEquipmentResponsibleTech: api.tech,
  setEquipmentWarrantyExpiry: api.warranty,
  setEquipmentMachineHours: api.hours,
  createEquipment: api.create,
}));

import {
  useCreateEquipment,
  useSetEquipmentAssetStatus,
  useSetEquipmentMachineHours,
  useSetEquipmentResponsibleTech,
  useSetEquipmentWarrantyExpiry,
  useUpdateEquipmentFields,
} from "./useEquipment";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Every equipment write, as `[name, fire it]` — so no case can forget one. */
function everyWrite() {
  const update = renderHook(() => useUpdateEquipmentFields(), { wrapper });
  const status = renderHook(() => useSetEquipmentAssetStatus(), { wrapper });
  const tech = renderHook(() => useSetEquipmentResponsibleTech(), { wrapper });
  const warranty = renderHook(() => useSetEquipmentWarrantyExpiry(), { wrapper });
  const hours = renderHook(() => useSetEquipmentMachineHours(), { wrapper });
  const create = renderHook(() => useCreateEquipment(), { wrapper });
  return [
    [
      "updateEquipmentFields",
      api.update,
      () => update.result.current.mutateAsync({ lookupId: 1, fields: { AssetTag: "X" } }),
    ],
    [
      "setEquipmentAssetStatus",
      api.status,
      () => status.result.current.mutateAsync({ lookupId: 1, assetStatus: "Down" }),
    ],
    [
      "setEquipmentResponsibleTech",
      api.tech,
      () =>
        tech.result.current.mutateAsync({
          lookupId: 1,
          person: { displayName: "A", email: "a@x.com", lookupId: 2 },
        }),
    ],
    [
      "setEquipmentWarrantyExpiry",
      api.warranty,
      () => warranty.result.current.mutateAsync({ lookupId: 1, date: new Date() }),
    ],
    [
      "setEquipmentMachineHours",
      api.hours,
      () => hours.result.current.mutateAsync({ lookupId: 1, hours: 100 }),
    ],
    ["createEquipment", api.create, () => create.result.current.mutateAsync({ Title: "New" })],
  ] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforced = true;
  mocks.arcAdmin = false;
  mocks.roles = [];
});

describe("every equipment write asks manageAssetsGate", () => {
  it("REFUSES someone with no maintenance role, before touching the API", async () => {
    for (const [name, fn, fire] of everyWrite()) {
      await expect(fire(), name).rejects.toThrow(/maintenance admins/i);
      expect(fn, name).not.toHaveBeenCalled();
    }
  });

  // The asymmetry is the point: a tech may close a work order out and log a
  // PM, but the asset register is what every work order and PM schedule points
  // AT, so changing it is an admin's job.
  it("REFUSES a maintenance TECH — this is the admin gate, not the tech one", async () => {
    mocks.roles = ["tech"];
    for (const [name, fn, fire] of everyWrite()) {
      await expect(fire(), name).rejects.toThrow(/maintenance admins/i);
      expect(fn, name).not.toHaveBeenCalled();
    }
  });

  it("names the role to ask for, and where — not a bare 'access denied'", async () => {
    const { result } = renderHook(() => useSetEquipmentAssetStatus(), { wrapper });
    await expect(
      result.current.mutateAsync({ lookupId: 1, assetStatus: "Down" }),
    ).rejects.toThrow(/Admin → Maintenance Roles/);
  });

  it("surfaces the refusal to the user rather than failing silently", async () => {
    const { result } = renderHook(() => useSetEquipmentAssetStatus(), { wrapper });
    await expect(
      result.current.mutateAsync({ lookupId: 1, assetStatus: "Down" }),
    ).rejects.toThrow();
    // The gate's own wording, not a generic "couldn't save" that throws away
    // the one sentence telling the user what to ask for.
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: expect.stringMatching(/maintenance admins/i),
      }),
    );
  });

  it("lets a maintenance ADMIN through to every write", async () => {
    mocks.roles = ["admin"];
    for (const [name, fn, fire] of everyWrite()) {
      await fire();
      expect(fn, name).toHaveBeenCalled();
    }
  });

  // An ARC admin is a maintenance admin, list or no list — otherwise a roles
  // list nobody holds `admin` on is a door locked from the inside.
  it("lets an ARC admin through even with no maintenance role tag", async () => {
    mocks.arcAdmin = true;
    for (const [name, fn, fire] of everyWrite()) {
      await fire();
      expect(fn, name).toHaveBeenCalled();
    }
  });
});

describe("lockout safety — gating OFF when the roles list isn't configured", () => {
  it("allows EVERY write when gating is not enforced", async () => {
    mocks.enforced = false;
    mocks.arcAdmin = false;
    mocks.roles = [];
    for (const [name, fn, fire] of everyWrite()) {
      await fire();
      expect(fn, name).toHaveBeenCalled();
    }
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
  });
});
