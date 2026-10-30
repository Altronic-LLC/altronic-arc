import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A Panel Order's chain and hold, end to end in demo mode (rules:
// lib/panelOrderChain.ts). Completing a step opens the next one as Ready and
// emails its assignee; putting the order On Hold holds its open tasks and
// taking it off gives each its own status back.

const mail = vi.hoisted(() => ({ change: vi.fn(), field: vi.fn() }));
vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  notifyChangeEmails: mail.change,
  fireFieldChangeAlert: mail.field,
}));

import { listPanelTasks, resetPanelTasksMockStore } from "@/api/panelTasks";
import { resetPanelOrdersMockStore } from "@/api/panelOrders";
import { resetPanelTaskTemplatesMockStore } from "@/api/panelTaskTemplates";
import { listPanelOrders } from "@/api/panelOrders";
import { PANEL_ORDERS_KEY, useCreatePanelOrder, useUpdatePanelOrderFields } from "./usePanelOrders";
import { PANEL_TASKS_KEY, useUpdatePanelTaskFields } from "./usePanelTasks";
import { tasksForOrder } from "@/lib/panelOrderTasks";

const ANA = { displayName: "Ana Ruiz", email: "ana.ruiz@example.com", lookupId: 71 };

let qc: QueryClient;
function wrapper() {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** The status writes read the row as it stood from the cache, as on screen. */
async function primeCaches() {
  qc.setQueryData(PANEL_TASKS_KEY, await listPanelTasks());
  qc.setQueryData(PANEL_ORDERS_KEY, await listPanelOrders());
}

async function newOrder() {
  const { result } = renderHook(() => useCreatePanelOrder(), { wrapper: wrapper() });
  const { order } = await act(() =>
    result.current.mutateAsync({ title: "New skid", engineerAssigned: ANA, standardTasks: true }),
  );
  mail.change.mockReset();
  await primeCaches();
  return order;
}

const statuses = async (orderId: number) =>
  tasksForOrder(await listPanelTasks(), orderId).map((t) => t.status);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  resetPanelTasksMockStore();
  resetPanelOrdersMockStore();
  resetPanelTaskTemplatesMockStore();
  mail.change.mockReset();
  mail.field.mockReset();
});

describe("the chain", () => {
  it("opens the next step as Ready when one is Completed, and emails its assignee", async () => {
    const order = await newOrder();
    const [drawing, bom] = tasksForOrder(await listPanelTasks(), order.id);
    const { result } = renderHook(() => useUpdatePanelTaskFields(), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync({ id: drawing.id, fields: { Status: "In Progress" } }));
    await primeCaches();
    await act(() => result.current.mutateAsync({ id: drawing.id, fields: { Status: "Completed" } }));

    await waitFor(async () =>
      expect(await statuses(order.id)).toEqual(["Completed", "Ready", "Awaiting Pre-Req", "Awaiting Pre-Req"]),
    );
    await waitFor(() => expect(mail.change).toHaveBeenCalled());
    const { target, emails } = mail.change.mock.calls[0][0];
    expect(target).toMatchObject({ kind: "panelTask", id: bom.id });
    expect(emails.map((e: { email: string }) => e.email)).toEqual([ANA.email]);
  });
});

describe("the order's hold", () => {
  it("holds the open tasks and gives each its own status back", async () => {
    const order = await newOrder();
    const [drawing] = tasksForOrder(await listPanelTasks(), order.id);
    const tasks = renderHook(() => useUpdatePanelTaskFields(), { wrapper: wrapper() });
    await act(() => tasks.result.current.mutateAsync({ id: drawing.id, fields: { Status: "In Progress" } }));

    const orders = renderHook(() => useUpdatePanelOrderFields(), { wrapper: wrapper() });
    await primeCaches();
    await act(() => orders.result.current.mutateAsync({ id: order.id, fields: { Status: "On Hold" } }));
    await waitFor(async () => expect(await statuses(order.id)).toEqual(Array(4).fill("On Hold - Internal")));
    await primeCaches();

    await act(() => orders.result.current.mutateAsync({ id: order.id, fields: { Status: "In Engineering" } }));
    await waitFor(async () =>
      expect(await statuses(order.id)).toEqual(["In Progress", "Awaiting Pre-Req", "Awaiting Pre-Req", "Awaiting Pre-Req"]),
    );
    const after = tasksForOrder(await listPanelTasks(), order.id);
    expect(after.every((t) => t.statusBeforeHold === null)).toBe(true);
  });
});
