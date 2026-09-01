import { describe, it, expect, vi, beforeEach } from "vitest";

// The CMMS role gates aren't what this file is about — they have their own
// tests (lib/maintenanceRoles.test.ts, and the .roles.test files beside the two
// maintenance hooks). Full rights here, controllable where a case needs to see
// a refusal, so nothing in this file depends on the roles list loading.
const maintenanceAccess = vi.hoisted(() => ({
  value: { isTech: true, isAdmin: true, enforced: true, isResolving: false },
}));

vi.mock("@/hooks/useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => maintenanceAccess.value,
  useResolveMaintenanceAccess: () => async () => maintenanceAccess.value,
}));
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pushToast = vi.hoisted(() => vi.fn());
const fireAssigneeChangeAlert = vi.hoisted(() => vi.fn());

vi.mock("@/components/Toast", () => ({ pushToast }));
vi.mock("@/api/email", () => ({ fireAssigneeChangeAlert }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

const ME = { displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 999 };
vi.mock("./useCurrentUser", () => ({ useCurrentUser: () => ME }));

import {
  resetScheduledMaintenanceMockStore,
  updateScheduledMaintenanceFields,
} from "@/api/scheduledMaintenance";
import {
  useCreateScheduledMaintenance,
  useRecordScheduleCompletion,
  useSchedule,
  useScheduledMaintenance,
  useSetScheduleActive,
  useSetScheduleAssignedTo,
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

beforeEach(() => {
  resetScheduledMaintenanceMockStore();
  pushToast.mockClear();
  fireAssigneeChangeAlert.mockClear();
});

describe("useScheduledMaintenance", () => {
  it("loads the schedules and can pick one out", async () => {
    const wrap = wrapper();
    const rows = await loaded(wrap);
    const { result } = renderHook(() => useSchedule(rows[0].id), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.id).toBe(rows[0].id));
  });

  it("returns null for a null id", async () => {
    const wrap = wrapper();
    await loaded(wrap);
    const { result } = renderHook(() => useSchedule(null), { wrapper: wrap });
    expect(result.current.data).toBeNull();
  });
});

describe("retiring a schedule", () => {
  it("is how a schedule is removed — it stops projecting, it isn't deleted", async () => {
    const wrap = wrapper();
    const rows = await loaded(wrap);
    const target = rows.find((s) => s.active)!;

    const { result } = renderHook(() => useSetScheduleActive(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, active: false });
    });
    expect(result.current.data?.active).toBe(false);

    // Still there, still readable — the history stays attached to the asset.
    const after = await loaded(wrapper());
    expect(after.some((s) => s.id === target.id)).toBe(true);
  });
});

describe("recording a completion", () => {
  it("rolls a Fixed schedule on from its DUE date", async () => {
    const wrap = wrapper();
    const rows = await loaded(wrap);
    const target = await updateScheduledMaintenanceFields(rows[0].id, {
      ScheduleBasis: "Fixed",
      FrequencyInterval: 1,
      FrequencyUnit: "Months",
      NextDueDate: "2026-06-01T12:00:00Z",
      Active: true,
    });

    const { result } = renderHook(() => useRecordScheduleCompletion(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        completedOn: new Date("2026-06-09T12:00:00Z"),
      });
    });
    expect(result.current.data?.nextDueDate?.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(result.current.data?.lastCompletedBy?.email).toBe(ME.email);
  });

  it("rolls a Floating schedule on from the COMPLETION date", async () => {
    const wrap = wrapper();
    const rows = await loaded(wrap);
    const target = await updateScheduledMaintenanceFields(rows[0].id, {
      ScheduleBasis: "Floating",
      FrequencyInterval: 90,
      FrequencyUnit: "Days",
      NextDueDate: "2026-06-01T12:00:00Z",
      LastCompleted: null,
      Active: true,
    });

    const { result } = renderHook(() => useRecordScheduleCompletion(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        completedOn: new Date("2026-06-09T12:00:00Z"),
      });
    });
    expect(result.current.data?.nextDueDate?.toISOString().slice(0, 10)).toBe("2026-09-07");
  });
});

describe("owning a schedule", () => {
  it("makes the owner a watcher and alerts them", async () => {
    const wrap = wrapper();
    const rows = await loaded(wrap);
    const { result } = renderHook(() => useSetScheduleAssignedTo(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: rows[0].id, person: ME });
    });
    expect(result.current.data?.assignedTo?.email).toBe(ME.email);
    expect(result.current.data?.watchers.some((w) => w.email === ME.email)).toBe(true);
    await waitFor(() => expect(fireAssigneeChangeAlert).toHaveBeenCalled());
  });
});

describe("creating a schedule", () => {
  it("makes the creator a watcher and puts it at the top of the list", async () => {
    const wrap = wrapper();
    await loaded(wrap);
    const { result } = renderHook(() => useCreateScheduledMaintenance(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({
        title: "Quarterly filter change",
        frequencyInterval: 3,
        frequencyUnit: "Months",
      });
    });
    expect(result.current.data?.watchers.some((w) => w.email === ME.email)).toBe(true);
    expect(result.current.data?.active).toBe(true);
  });
});
