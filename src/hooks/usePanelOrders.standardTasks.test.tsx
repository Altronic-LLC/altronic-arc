import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Creating a Panel Order raises its standard tasks (demo mode): one task per
// active template, each assigned to the order's engineer or to nobody, linked
// to the order — then ONE email to the engineer listing them. A refused task
// never fails the order, and the order page's button adds only what's missing.

const mail = vi.hoisted(() => ({ change: vi.fn(), assignee: vi.fn() }));
vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  notifyChangeEmails: mail.change,
  fireAssigneeChangeAlert: mail.assignee,
}));
const fail = vi.hoisted(() => ({ title: null as string | null }));
vi.mock("@/api/panelTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/panelTasks")>();
  return {
    ...actual,
    createPanelTask: vi.fn(async (input: Parameters<typeof actual.createPanelTask>[0]) => {
      if (fail.title && input.title.endsWith(fail.title)) throw new Error("refused");
      return actual.createPanelTask(input);
    }),
  };
});

import { createPanelTask, listPanelTasks, resetPanelTasksMockStore } from "@/api/panelTasks";
import { resetPanelOrdersMockStore } from "@/api/panelOrders";
import { resetPanelTaskTemplatesMockStore } from "@/api/panelTaskTemplates";
import { useCreatePanelOrder } from "./usePanelOrders";
import { useRaiseMissingStandardTasks } from "./usePanelOrderTasks";
import { tasksForOrder } from "@/lib/panelOrderTasks";

const ANA = { displayName: "Ana Ruiz", email: "ana.ruiz@example.com", lookupId: 71 };

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  resetPanelTasksMockStore();
  resetPanelOrdersMockStore();
  resetPanelTaskTemplatesMockStore();
  mail.change.mockReset();
  mail.assignee.mockReset();
  vi.mocked(createPanelTask).mockClear();
  fail.title = null;
});

describe("useCreatePanelOrder with standard tasks", () => {
  it("raises the four tasks, assigned to the engineer and linked to the order", async () => {
    const { result } = renderHook(() => useCreatePanelOrder(), { wrapper: wrapper() });
    const { order, raised } = await act(() =>
      result.current.mutateAsync({
        title: "New skid",
        projectLookupId: 1,
        engineerAssigned: ANA,
        standardTasks: true,
      }),
    );
    expect(raised?.tasks.map((t) => t.title)).toEqual([
      "P-0001 — Drawing Creation",
      "P-0001 — BOM Creation",
      "P-0001 — SOO Creation",
      "P-0001 — Programming",
    ]);
    const stored = tasksForOrder(await listPanelTasks(), order.id);
    expect(stored).toHaveLength(4);
    // Chained in template order: the first is New, the rest wait their turn.
    expect(stored.map((t) => t.status)).toEqual(["New", "Awaiting Pre-Req", "Awaiting Pre-Req", "Awaiting Pre-Req"]);
    expect(stored.map((t) => t.chainStep)).toEqual([1, 2, 3, 4]);
    for (const t of stored) {
      expect(t.assigned).toEqual([ANA]);
      expect(t.workType).toBe("Production Order");
      expect(t.startDate).toBeNull();
      expect(t.projectRef?.lookupId).toBe(1);
      expect(t.watchers.some((w) => w.email === ANA.email)).toBe(true);
    }
    expect(stored.map((t) => t.estimatedHours)).toEqual([24, 2, 6, 16]);
  });

  it("sends the engineer ONE email listing every task, and no per-task emails", async () => {
    const { result } = renderHook(() => useCreatePanelOrder(), { wrapper: wrapper() });
    await act(() =>
      result.current.mutateAsync({ title: "New skid", engineerAssigned: ANA, standardTasks: true }),
    );
    expect(mail.change).toHaveBeenCalledTimes(1);
    const { emails, target } = mail.change.mock.calls[0][0];
    expect(target.kind).toBe("panelOrder");
    expect(emails).toHaveLength(1);
    expect(emails[0].email).toBe(ANA.email);
    expect(emails[0].detailHtml).toContain("Programming");
    expect(mail.assignee).not.toHaveBeenCalled();
  });

  it("leaves every task unassigned, and emails nobody, when the engineer is blank", async () => {
    const { result } = renderHook(() => useCreatePanelOrder(), { wrapper: wrapper() });
    const { order } = await act(() =>
      result.current.mutateAsync({ title: "New skid", engineerAssigned: null, standardTasks: true }),
    );
    const stored = tasksForOrder(await listPanelTasks(), order.id);
    expect(stored).toHaveLength(4);
    expect(stored.every((t) => t.assigned.length === 0)).toBe(true);
    expect(mail.change).not.toHaveBeenCalled();
  });

  it("raises nothing when standard tasks aren't asked for", async () => {
    const { result } = renderHook(() => useCreatePanelOrder(), { wrapper: wrapper() });
    const { raised } = await act(() => result.current.mutateAsync({ title: "Just an order" }));
    expect(raised).toBeNull();
    expect(createPanelTask).not.toHaveBeenCalled();
  });

  it("still creates the order when a task is refused, and names the one that failed", async () => {
    fail.title = "BOM Creation";
    const { result } = renderHook(() => useCreatePanelOrder(), { wrapper: wrapper() });
    const { order, raised } = await act(() =>
      result.current.mutateAsync({ title: "New skid", engineerAssigned: ANA, standardTasks: true }),
    );
    expect(order.id).toBeGreaterThan(0);
    expect(raised?.tasks).toHaveLength(3);
    expect(raised?.failed.map((f) => f.title)).toEqual(["New skid — BOM Creation"]);
    // The refused step still holds back the ones after it.
    expect(raised?.tasks.map((t) => t.status)).toEqual(["New", "Awaiting Pre-Req", "Awaiting Pre-Req"]);
  });

  it("copies the order's SAP # onto every task", async () => {
    const { result } = renderHook(() => useCreatePanelOrder(), { wrapper: wrapper() });
    const { order } = await act(() =>
      result.current.mutateAsync({ title: "New skid", sapNumber: "9200-0009-00", standardTasks: true }),
    );
    const stored = tasksForOrder(await listPanelTasks(), order.id);
    expect(stored.map((t) => t.sapNumber)).toEqual(Array(4).fill("9200-0009-00"));
  });
});

describe("useRaiseMissingStandardTasks", () => {
  it("adds only the missing tasks, to the order's engineer, in one email", async () => {
    fail.title = "BOM Creation";
    const create = renderHook(() => useCreatePanelOrder(), { wrapper: wrapper() });
    const { order } = await act(() =>
      create.result.current.mutateAsync({ title: "New skid", engineerAssigned: ANA, standardTasks: true }),
    );
    fail.title = null;
    mail.change.mockReset();
    vi.mocked(createPanelTask).mockClear();

    const existing = tasksForOrder(await listPanelTasks(), order.id);
    const raise = renderHook(() => useRaiseMissingStandardTasks(), { wrapper: wrapper() });
    const raised = await act(() => raise.result.current.mutateAsync({ order, existing }));
    expect(raised.tasks.map((t) => t.title)).toEqual(["New skid — BOM Creation"]);
    // Drawing isn't done yet, so the missing BOM waits behind it.
    expect(raised.tasks[0].status).toBe("Awaiting Pre-Req");
    expect(raised.tasks[0].chainStep).toBe(2);
    expect(createPanelTask).toHaveBeenCalledTimes(1);
    expect(tasksForOrder(await listPanelTasks(), order.id)).toHaveLength(4);
    expect(mail.change).toHaveBeenCalledTimes(1);
    expect(mail.change.mock.calls[0][0].emails[0].subject).toMatch(/assigned 1 task on New skid/);
  });
});
