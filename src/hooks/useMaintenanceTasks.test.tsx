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

// =============================================================================
// The work-order hooks.
//
// The completion guard's RULE — the maintenance `tech` / `admin` roles — is
// tested in useMaintenanceTasks.roles.test.tsx, which drives the real
// resolution chain. This file mocks full rights and covers what the completing
// write DOES: assign-on-complete, the write-up, the alerts, and the fact that
// no other status change is gated.
//
// It used to encode an ASSIGNEE rule (only the assignee or an ARC admin could
// close a work order out). That rule is gone: any tech closes out any job, and
// accountability comes from `CompletedBy` being stamped.
// =============================================================================

const pushToast = vi.hoisted(() => vi.fn());
const fireFieldChangeAlert = vi.hoisted(() => vi.fn());
const fireAssigneeChangeAlert = vi.hoisted(() => vi.fn());
const notifyMentions = vi.hoisted(() => vi.fn());
const isAdmin = vi.hoisted(() => ({ value: false }));

vi.mock("@/components/Toast", () => ({ pushToast }));

vi.mock("@/api/email", () => ({
  fireFieldChangeAlert,
  fireAssigneeChangeAlert,
  notifyMentions,
}));

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

const ME = {
  displayName: "Demo User",
  email: "demo.user@altronic-llc.com",
  lookupId: 999,
};

vi.mock("./useCurrentUser", () => ({ useCurrentUser: () => ME }));
vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => isAdmin.value,
  useAdminAccess: () => ({ isAdmin: isAdmin.value, isResolving: false }),
}));

import {
  resetMaintenanceMockStore,
  setMaintenanceTaskAssigned,
  updateMaintenanceTaskFields,
} from "@/api/maintenanceTasks";
import {
  useCompleteMaintenanceTask,
  useCreateMaintenanceTask,
  useMaintenanceTask,
  useMaintenanceTasks,
  useSetMaintenanceTaskAssigned,
  useUpdateMaintenanceTaskFields,
} from "./useMaintenanceTasks";
import type { MaintenanceTask } from "@/types/task";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function loaded(wrap: ReturnType<typeof wrapper>): Promise<MaintenanceTask[]> {
  const { result } = renderHook(() => useMaintenanceTasks(), { wrapper: wrap });
  await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  return result.current.data!;
}

beforeEach(() => {
  resetMaintenanceMockStore();
  isAdmin.value = false;
  maintenanceAccess.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
  pushToast.mockClear();
  fireFieldChangeAlert.mockClear();
  fireAssigneeChangeAlert.mockClear();
});

describe("useMaintenanceTasks", () => {
  it("loads the list and can pick one work order out of it", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const { result } = renderHook(() => useMaintenanceTask(tasks[0].id), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.id).toBe(tasks[0].id));
  });

  it("returns null for a null id rather than guessing", async () => {
    const wrap = wrapper();
    await loaded(wrap);
    const { result } = renderHook(() => useMaintenanceTask(null), { wrapper: wrap });
    expect(result.current.data).toBeNull();
  });
});

describe("completing a work order", () => {
  it("lets the assignee complete their own work order", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.status !== "Complete")!;
    await setMaintenanceTaskAssigned(target.id, ME);

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });
    });
    expect(result.current.data?.status).toBe("Complete");
  });

  // The assignee rule is GONE. A tech closes out anybody's job — which is
  // ordinary shop-floor behaviour, and what the old rule refused.
  it("lets a tech complete a work order ASSIGNED TO SOMEBODY ELSE", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.status !== "Complete")!;
    await setMaintenanceTaskAssigned(target.id, {
      displayName: "David Bulkley",
      email: "david.bulkley@altronic-llc.com",
      lookupId: 24,
    });

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });
    });
    expect(result.current.data?.status).toBe("Complete");
    // Completing somebody else's job does NOT reassign it — the assignee is
    // untouched, and CompletedBy records who actually closed it.
    const after = await updateMaintenanceTaskFields(target.id, {});
    expect(after.assigned?.email).toBe("david.bulkley@altronic-llc.com");
  });

  // Still refused, but on the ROLE now. The full role matrix lives in
  // useMaintenanceTasks.roles.test.tsx; this case only proves the guard is
  // wired into this hook at all.
  it("refuses somebody holding neither maintenance role", async () => {
    maintenanceAccess.value = {
      isTech: false,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.status !== "Complete")!;

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });
      }),
    ).rejects.toThrow(/limited to maintenance techs/i);

    const after = await updateMaintenanceTaskFields(target.id, {});
    expect(after.status).not.toBe("Complete");
  });

  it("ASSIGNS an unassigned work order to whoever completes it, in the same write", async () => {
    // The common case on the shop floor: somebody picks a job off the backlog,
    // does it, and closes it. Refusing them would be pedantic; leaving it
    // complete with nobody against it would lose who did it.
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => !t.assigned && t.status !== "Complete")!;

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });
    });
    expect(result.current.data?.status).toBe("Complete");
    expect(result.current.data?.assigned?.email).toBe(ME.email);
  });

  it("does NOT guard any other status change", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.assigned && t.assigned.email !== ME.email)!;

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, fields: { Status: "On Hold" } });
    });
    expect(result.current.data?.status).toBe("On Hold");
  });

  it("guards useCompleteMaintenanceTask the same way", async () => {
    maintenanceAccess.value = {
      isTech: false,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.status !== "Complete")!;

    const { result } = renderHook(() => useCompleteMaintenanceTask(), { wrapper: wrap });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: target.id, completedOn: new Date() });
      }),
    ).rejects.toThrow(/limited to maintenance techs/i);
  });

  it("useCompleteMaintenanceTask records the write-up and who did it", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => !t.assigned && t.status !== "Complete")!;

    const { result } = renderHook(() => useCompleteMaintenanceTask(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        completedOn: new Date("2026-08-20T12:00:00Z"),
        resolution: "Replaced the element.",
        laborHours: 3,
      });
    });
    const done = result.current.data!;
    expect(done.status).toBe("Complete");
    expect(done.completedBy?.email).toBe(ME.email);
    // Unassigned → assigned to the person closing it, in the same write.
    expect(done.assigned?.email).toBe(ME.email);
    expect(done.resolution).toBe("Replaced the element.");
    expect(done.laborHours).toBe(3);
  });
});

describe("status alerts", () => {
  it("tells the watchers and the assignee when the status moves", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.status === "Backlog")!;

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, fields: { Status: "Started" } });
    });

    await waitFor(() => expect(fireFieldChangeAlert).toHaveBeenCalled());
    const call = fireFieldChangeAlert.mock.calls[0][0];
    expect(call.target).toMatchObject({ kind: "maintenanceTask", id: target.id });
    expect(call.from).toBe("Backlog");
    expect(call.to).toBe("Started");
  });

  it("stays quiet about a change that isn't the status", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: tasks[0].id, fields: { TechNotes: "Noted." } });
    });
    expect(fireFieldChangeAlert).not.toHaveBeenCalled();
  });
});

describe("assigning", () => {
  it("makes the assignee a watcher and alerts them", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => !t.assigned)!;

    const { result } = renderHook(() => useSetMaintenanceTaskAssigned(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, person: ME });
    });
    expect(result.current.data?.assigned?.email).toBe(ME.email);
    expect(result.current.data?.watchers.some((w) => w.email === ME.email)).toBe(true);
    await waitFor(() => expect(fireAssigneeChangeAlert).toHaveBeenCalled());
  });
});

describe("raising a work order", () => {
  it("makes the creator and the assignee watchers, and records who raised it", async () => {
    const wrap = wrapper();
    await loaded(wrap);
    const tech = { displayName: "Alyssa Garrett", email: "a.g@altronic-llc.com", lookupId: 63 };

    const { result } = renderHook(() => useCreateMaintenanceTask(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ title: "Belt squealing", assigned: tech });
    });
    const created = result.current.data!;
    const emails = created.watchers.map((w) => w.email);
    expect(emails).toContain(ME.email);
    expect(emails).toContain(tech.email);
    expect(created.reportedBy?.email).toBe(ME.email);
    expect(created.woNumber).toMatch(/^WO-\d{4}-\d{4}$/);
    await waitFor(() => expect(fireAssigneeChangeAlert).toHaveBeenCalled());
  });
});
