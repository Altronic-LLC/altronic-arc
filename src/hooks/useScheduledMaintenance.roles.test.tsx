import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Who may change a PM schedule.
//
// **Maintenance ADMIN** for every write that changes the rule — create, field
// edits, owner, equipment, project, and the Active toggle. A schedule drives
// what the whole shop is told is due, so it is a narrower right than doing the
// work.
//
// **Tech or admin** for recording a completion, because that is logging a PM.
//
// The refusal must also SURVIVE to the user: several of these mutations used a
// fixed "— reverted" message in `onError`, which would have thrown the gate's
// sentence away, so the wording is asserted at the mutation level here and the
// handlers pass `err.message` through.
// =============================================================================

const pushToast = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  enforced: true,
  arcAdmin: false,
  roles: [] as string[],
}));

vi.mock("@/components/Toast", () => ({ pushToast }));
vi.mock("@/api/email", () => ({ fireAssigneeChangeAlert: vi.fn() }));
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

import { resetScheduledMaintenanceMockStore } from "@/api/scheduledMaintenance";
import {
  useCreateScheduledMaintenance,
  useRecordScheduleCompletion,
  useScheduledMaintenance,
  useSetScheduleActive,
  useSetScheduleAssignedTo,
  useSetScheduleEquipment,
  useSetScheduleOperationsProject,
  useSetScheduleWatchers,
  useUpdateScheduleFields,
} from "./useScheduledMaintenance";
import type { ScheduledMaintenance } from "@/types/task";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function loaded(wrap: ReturnType<typeof wrapper>): Promise<ScheduledMaintenance[]> {
  const { result } = renderHook(() => useScheduledMaintenance(), { wrapper: wrap });
  await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  return result.current.data!;
}

const NEW_SCHEDULE = {
  title: "Grease the main bearing",
  instructions: "",
  frequencyInterval: 3,
  frequencyUnit: "Months" as const,
  scheduleBasis: "Fixed" as const,
  firstDueDate: new Date("2026-09-01T12:00:00Z"),
};

beforeEach(() => {
  resetScheduledMaintenanceMockStore();
  mocks.enforced = true;
  mocks.arcAdmin = false;
  mocks.roles = [];
  pushToast.mockClear();
});

describe("changing a PM schedule needs the maintenance admin role", () => {
  it("refuses a CREATE from somebody holding nothing, naming the Admin role", async () => {
    const wrap = wrapper();
    const { result } = renderHook(() => useCreateScheduledMaintenance(), { wrapper: wrap });
    await expect(result.current.mutateAsync(NEW_SCHEDULE)).rejects.toThrow(
      /limited to maintenance admins/i,
    );
  });

  it("refuses a create from a TECH — doing the work isn't owning the schedule", async () => {
    mocks.roles = ["tech"];
    const wrap = wrapper();
    const { result } = renderHook(() => useCreateScheduledMaintenance(), { wrapper: wrap });
    await expect(result.current.mutateAsync(NEW_SCHEDULE)).rejects.toThrow(/Admin role/);
  });

  it("lets a maintenance admin create one", async () => {
    mocks.roles = ["admin"];
    const wrap = wrapper();
    const { result } = renderHook(() => useCreateScheduledMaintenance(), { wrapper: wrap });
    const created = await result.current.mutateAsync(NEW_SCHEDULE);
    expect(created.title).toBe(NEW_SCHEDULE.title);
  });

  it("lets an ARC admin create one with no roles row", async () => {
    mocks.arcAdmin = true;
    const wrap = wrapper();
    const { result } = renderHook(() => useCreateScheduledMaintenance(), { wrapper: wrap });
    const created = await result.current.mutateAsync(NEW_SCHEDULE);
    expect(created.title).toBe(NEW_SCHEDULE.title);
  });

  it("refuses a field edit, and rolls the optimistic patch back", async () => {
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const target = schedules[0]!;

    const { result } = renderHook(() => useUpdateScheduleFields(), { wrapper: wrap });
    await expect(
      result.current.mutateAsync({ id: target.id, fields: { Title: "Renamed by a tech" } }),
    ).rejects.toThrow(/limited to maintenance admins/i);

    const after = await loaded(wrapper());
    expect(after.find((s) => s.id === target.id)?.title).toBe(target.title);
  });

  it("refuses the Active toggle, and keeps the gate's reason in the toast", async () => {
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const target = schedules.find((s) => s.active)!;

    const { result } = renderHook(() => useSetScheduleActive(), { wrapper: wrap });
    await expect(
      result.current.mutateAsync({ id: target.id, active: false }),
    ).rejects.toThrow(/limited to maintenance admins/i);

    // The handler used a fixed "— reverted" line, which would have hidden the
    // one sentence saying what to ask for.
    const messages = pushToast.mock.calls.map((c) => String(c[0]?.message ?? ""));
    expect(messages.some((m) => /limited to maintenance admins/i.test(m))).toBe(true);

    const after = await loaded(wrapper());
    expect(after.find((s) => s.id === target.id)?.active).toBe(true);
  });

  it("refuses the owner, equipment and project writes too", async () => {
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const id = schedules[0]!.id;

    const owner = renderHook(() => useSetScheduleAssignedTo(), { wrapper: wrap });
    await expect(owner.result.current.mutateAsync({ id, person: ME })).rejects.toThrow(
      /maintenance admins/i,
    );

    const equipment = renderHook(() => useSetScheduleEquipment(), { wrapper: wrap });
    await expect(
      equipment.result.current.mutateAsync({ id, equipmentLookupId: 3 }),
    ).rejects.toThrow(/maintenance admins/i);

    const project = renderHook(() => useSetScheduleOperationsProject(), { wrapper: wrap });
    await expect(
      project.result.current.mutateAsync({ id, operationsProjectLookupId: 2 }),
    ).rejects.toThrow(/maintenance admins/i);
  });

  it("lets an admin make those same three writes", async () => {
    mocks.roles = ["admin"];
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const id = schedules[0]!.id;

    const owner = renderHook(() => useSetScheduleAssignedTo(), { wrapper: wrap });
    await expect(owner.result.current.mutateAsync({ id, person: ME })).resolves.toBeDefined();

    const equipment = renderHook(() => useSetScheduleEquipment(), { wrapper: wrap });
    await expect(
      equipment.result.current.mutateAsync({ id, equipmentLookupId: 3 }),
    ).resolves.toBeDefined();

    const project = renderHook(() => useSetScheduleOperationsProject(), { wrapper: wrap });
    await expect(
      project.result.current.mutateAsync({ id, operationsProjectLookupId: 2 }),
    ).resolves.toBeDefined();
  });

  // A watch is a personal subscription, not a change to the schedule — the
  // same call as commenting on a work order.
  it("does NOT gate the watcher list", async () => {
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const { result } = renderHook(() => useSetScheduleWatchers(), { wrapper: wrap });
    await expect(
      result.current.mutateAsync({ id: schedules[0]!.id, people: [ME] }),
    ).resolves.toBeDefined();
  });
});

describe("recording a completion needs only the tech role", () => {
  it("lets a TECH record one, though they may not edit the schedule", async () => {
    mocks.roles = ["tech"];
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const target = schedules.find((s) => s.active)!;

    const { result } = renderHook(() => useRecordScheduleCompletion(), { wrapper: wrap });
    const updated = await result.current.mutateAsync({
      id: target.id,
      completedOn: new Date("2026-08-20T12:00:00Z"),
    });
    expect(updated.lastCompletedBy?.email).toBe(ME.email);
  });

  it("refuses somebody holding neither tag, naming the Tech role", async () => {
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const { result } = renderHook(() => useRecordScheduleCompletion(), { wrapper: wrap });
    await expect(
      result.current.mutateAsync({ id: schedules[0]!.id, completedOn: new Date() }),
    ).rejects.toThrow(/Tech role/);
  });
});

// =============================================================================
// THE flag again, on this module's own gates.
// =============================================================================
describe("gating is OFF when MAINTENANCE_ROLES_ENFORCED is false", () => {
  beforeEach(() => {
    mocks.enforced = false;
    mocks.roles = [];
    mocks.arcAdmin = false;
  });

  it("lets an untagged, non-admin user create a schedule", async () => {
    const wrap = wrapper();
    const { result } = renderHook(() => useCreateScheduledMaintenance(), { wrapper: wrap });
    await expect(result.current.mutateAsync(NEW_SCHEDULE)).resolves.toBeDefined();
  });

  it("lets them edit and retire one", async () => {
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const target = schedules.find((s) => s.active)!;

    const edit = renderHook(() => useUpdateScheduleFields(), { wrapper: wrap });
    await expect(
      edit.result.current.mutateAsync({ id: target.id, fields: { Title: "Renamed" } }),
    ).resolves.toBeDefined();

    const active = renderHook(() => useSetScheduleActive(), { wrapper: wrap });
    await expect(
      active.result.current.mutateAsync({ id: target.id, active: false }),
    ).resolves.toBeDefined();
  });

  it("lets them record a completion", async () => {
    const wrap = wrapper();
    const schedules = await loaded(wrap);
    const { result } = renderHook(() => useRecordScheduleCompletion(), { wrapper: wrap });
    await expect(
      result.current.mutateAsync({ id: schedules[0]!.id, completedOn: new Date() }),
    ).resolves.toBeDefined();
  });
});
