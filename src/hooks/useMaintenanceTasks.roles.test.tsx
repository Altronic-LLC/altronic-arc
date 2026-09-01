import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// The completion guard, now a ROLE check.
//
// It used to be an ASSIGNEE check — only the person a work order was assigned
// to, or an ARC admin, could close it out. Any maintenance tech can now close
// out any work order; accountability comes from `CompletedBy` being stamped.
//
// Three separate paths reach Complete (the status picker, a Kanban drag, the
// Complete form), so the rule lives in the `mutationFn`. These cases go through
// the two hooks that carry it.
//
// The case that matters most is the LAST describe block: with the Maintenance
// Roles list unconfigured, gating is OFF and nobody is refused. That flag is
// the whole reason the pattern exists, and a gate that quietly ignored it would
// lock the shop out of its own work orders at the next deploy.
// =============================================================================

const pushToast = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  enforced: true,
  arcAdmin: false,
  roles: [] as string[],
}));

vi.mock("@/components/Toast", () => ({ pushToast }));
vi.mock("@/api/email", () => ({
  fireFieldChangeAlert: vi.fn(),
  fireAssigneeChangeAlert: vi.fn(),
  notifyMentions: vi.fn(),
}));
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

// The roles LIST is mocked rather than the resolution, so these cases run the
// real chain: hook → resolveMaintenanceAccess → completeWorkOrderGate →
// completionFields.
vi.mock("@/api/maintenanceRoles", () => ({
  listMaintenanceRoles: vi.fn(async () => [
    { id: 1, email: ME.email, displayName: ME.displayName, roles: mocks.roles, note: "" },
  ]),
}));

import { resetMaintenanceMockStore, setMaintenanceTaskAssigned } from "@/api/maintenanceTasks";
import {
  useCompleteMaintenanceTask,
  useCreateMaintenanceTask,
  useMaintenanceTasks,
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

/** A work order assigned to somebody who is NOT the actor. */
async function assignedElsewhere(wrap: ReturnType<typeof wrapper>): Promise<MaintenanceTask> {
  const tasks = await loaded(wrap);
  const target = tasks.find((t) => t.status !== "Complete")!;
  await setMaintenanceTaskAssigned(target.id, {
    displayName: "Somebody Else",
    email: "somebody.else@altronic-llc.com",
    lookupId: 41,
  });
  return target;
}

beforeEach(() => {
  resetMaintenanceMockStore();
  mocks.enforced = true;
  mocks.arcAdmin = false;
  mocks.roles = [];
  pushToast.mockClear();
});

describe("completing a work order requires the tech role", () => {
  it("REFUSES somebody holding neither tag, naming what to ask for", async () => {
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await expect(
      result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } }),
    ).rejects.toThrow(/limited to maintenance techs/i);
  });

  it("says which role and which screen, not just 'denied'", async () => {
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);
    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await expect(
      result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } }),
    ).rejects.toThrow(/Maintenance Roles/);
  });

  // The rule this REPLACED: the assignee check is gone, so a tech closes out
  // anybody's job.
  it("lets a TECH close out a work order assigned to somebody else", async () => {
    mocks.roles = ["tech"];
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);

    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });

    const after = await loaded(wrapper());
    expect(after.find((t) => t.id === target.id)?.status).toBe("Complete");
  });

  it("lets a maintenance ADMIN who was never tagged tech close one out", async () => {
    mocks.roles = ["admin"];
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);
    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });
    const after = await loaded(wrapper());
    expect(after.find((t) => t.id === target.id)?.status).toBe("Complete");
  });

  // Lockout safety: a roles list nobody holds a tag on can't stop the shop.
  it("lets an ARC admin close one out with no roles row at all", async () => {
    mocks.arcAdmin = true;
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);
    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });
    const after = await loaded(wrapper());
    expect(after.find((t) => t.id === target.id)?.status).toBe("Complete");
  });

  it("guards useCompleteMaintenanceTask the same way", async () => {
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);
    const { result } = renderHook(() => useCompleteMaintenanceTask(), { wrapper: wrap });
    await expect(
      result.current.mutateAsync({ id: target.id, completedOn: new Date() }),
    ).rejects.toThrow(/limited to maintenance techs/i);
  });

  // The kept half of the old rule: whoever closes out an unassigned job gets
  // their name on it, so the row has an owner in every report that reads it.
  it("still assigns an UNASSIGNED work order to whoever completes it", async () => {
    mocks.roles = ["tech"];
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => !t.assigned && t.status !== "Complete")!;

    const { result } = renderHook(() => useCompleteMaintenanceTask(), { wrapper: wrap });
    const done = await result.current.mutateAsync({
      id: target.id,
      completedOn: new Date("2026-08-20T12:00:00Z"),
    });
    expect(done.status).toBe("Complete");
    expect(done.completedBy?.email).toBe(ME.email);
    expect(done.assigned?.email).toBe(ME.email);
  });

  // Raising and editing are open to everyone — only closing out is gated.
  it("does NOT gate any other status write", async () => {
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);
    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await result.current.mutateAsync({ id: target.id, fields: { Status: "On Hold" } });
    const after = await loaded(wrapper());
    expect(after.find((t) => t.id === target.id)?.status).toBe("On Hold");
  });

  it("does NOT gate raising a work order", async () => {
    const wrap = wrapper();
    await loaded(wrap);
    const { result } = renderHook(() => useCreateMaintenanceTask(), { wrapper: wrap });
    const created = await result.current.mutateAsync({ title: "Belt squealing" });
    expect(created.title).toBe("Belt squealing");
  });

  it("does NOT gate an ordinary field edit", async () => {
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);
    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await result.current.mutateAsync({ id: target.id, fields: { TechNotes: "Checked the belt" } });
    const after = await loaded(wrapper());
    expect(after.find((t) => t.id === target.id)?.techNotes).toBe("Checked the belt");
  });
});

// =============================================================================
// THE flag. An unconfigured Maintenance Roles list means "everyone keeps what
// they can do today", never "nobody can do anything".
// =============================================================================
describe("gating is OFF when MAINTENANCE_ROLES_ENFORCED is false", () => {
  beforeEach(() => {
    mocks.enforced = false;
    mocks.roles = [];
    mocks.arcAdmin = false;
  });

  it("lets an untagged, non-admin user close out somebody else's work order", async () => {
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);
    const { result } = renderHook(() => useUpdateMaintenanceTaskFields(), { wrapper: wrap });
    await result.current.mutateAsync({ id: target.id, fields: { Status: "Complete" } });
    const after = await loaded(wrapper());
    expect(after.find((t) => t.id === target.id)?.status).toBe("Complete");
  });

  it("lets the same user use the Complete form", async () => {
    const wrap = wrapper();
    const target = await assignedElsewhere(wrap);
    const { result } = renderHook(() => useCompleteMaintenanceTask(), { wrapper: wrap });
    const done = await result.current.mutateAsync({ id: target.id, completedOn: new Date() });
    expect(done.status).toBe("Complete");
  });

  it("still assigns an unassigned work order to the completer", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => !t.assigned && t.status !== "Complete")!;
    const { result } = renderHook(() => useCompleteMaintenanceTask(), { wrapper: wrap });
    const done = await result.current.mutateAsync({ id: target.id, completedOn: new Date() });
    expect(done.assigned?.email).toBe(ME.email);
  });
});
