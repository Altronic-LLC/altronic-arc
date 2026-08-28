import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// The completion guard.
//
// There are three separate ways to move a work order to Complete — the status
// picker, a Kanban drag, and the Complete form — so the rule lives in the
// `mutationFn`, not in a view. A rule enforced in one of three places is a
// rule that isn't enforced.
//
// Three cases:
//   assigned to me      → allowed
//   assigned to someone → refused, unless I'm an admin
//   unassigned          → allowed, AND it assigns me in the SAME write
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

describe("the completion guard", () => {
  it("lets the ASSIGNEE complete their own work order", async () => {
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

  it("REFUSES somebody who is neither the assignee nor an admin", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.status !== "Complete")!;
    await setMaintenanceTaskAssigned(target.id, {
      displayName: "David Bulkley",
      email: "david.bulkley@altronic-llc.com",
      lookupId: 24,
    });

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });
      }),
    ).rejects.toThrow(/Only the assignee/);

    const after = await updateMaintenanceTaskFields(target.id, {});
    expect(after.status).not.toBe("Complete");
  });

  it("lets an ADMIN complete somebody else's work order", async () => {
    isAdmin.value = true;
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
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.status !== "Complete")!;
    await setMaintenanceTaskAssigned(target.id, {
      displayName: "David Bulkley",
      email: "david.bulkley@altronic-llc.com",
      lookupId: 24,
    });

    const { result } = renderHook(() => useCompleteMaintenanceTask(), { wrapper: wrap });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: target.id, completedOn: new Date() });
      }),
    ).rejects.toThrow(/Only the assignee/);
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
