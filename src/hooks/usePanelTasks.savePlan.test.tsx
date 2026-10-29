import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Saving a Capacity plan (demo mode): one write per task, and the assignment
// emails only AFTER the writes — one per task whose assignee changed, with
// the new due date. A failed task doesn't stop the others.

const alerts = vi.hoisted(() => vi.fn());
vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  fireAssigneeChangeAlert: alerts,
}));
const plan = vi.hoisted(() => ({ failId: null as number | null }));
vi.mock("@/api/panelTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/panelTasks")>();
  return {
    ...actual,
    setPanelTaskPlan: vi.fn(async (id: number, p: Parameters<typeof actual.setPanelTaskPlan>[1]) => {
      if (id === plan.failId) throw new Error("refused");
      return actual.setPanelTaskPlan(id, p);
    }),
  };
});

import { resetPanelTasksMockStore, setPanelTaskPlan } from "@/api/panelTasks";
import { MOCK_PANEL_TASKS } from "@/data/panelMockData";
import { PANEL_TASKS_KEY, useSavePanelTaskPlan } from "./usePanelTasks";

const ERIC = { displayName: "Eric Gilkinson", email: "eric.gilkinson@altronic-llc.com", lookupId: 65 };
const day = (k: string) => new Date(`${k}T12:00:00Z`);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(PANEL_TASKS_KEY, MOCK_PANEL_TASKS.map((t) => ({ ...t })));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSavePanelTaskPlan(), { wrapper });
}

beforeEach(() => {
  resetPanelTasksMockStore();
  alerts.mockReset();
  vi.mocked(setPanelTaskPlan).mockClear();
  plan.failId = null;
});

describe("useSavePanelTaskPlan", () => {
  it("writes each task once and emails only the ones whose assignee changed", async () => {
    const { result } = setup();
    const out = await act(() =>
      result.current.mutateAsync([
        { id: 6, assigned: [ERIC], startDate: day("2026-11-04"), dueDate: day("2026-11-05") },
        { id: 2, startDate: day("2026-11-09"), dueDate: day("2026-11-10") },
      ]),
    );
    expect(setPanelTaskPlan).toHaveBeenCalledTimes(2);
    expect(out.saved.map((s) => s.after.id)).toEqual([6, 2]);
    expect(out.saved[0].after.assigned).toEqual([ERIC]);
    expect(out.saved[0].after.watchers.map((w) => w.email)).toContain(ERIC.email);
    expect(alerts).toHaveBeenCalledTimes(1);
    const [args] = alerts.mock.calls[0];
    expect(args.target.id).toBe(6);
    expect(args.next).toEqual([ERIC]);
    expect(args.details.dueDate.toISOString()).toBe("2026-11-05T12:00:00.000Z");
  });

  it("keeps going past a task that fails, and reports it", async () => {
    plan.failId = 6;
    const { result } = setup();
    const out = await act(() =>
      result.current.mutateAsync([
        { id: 6, assigned: [ERIC] },
        { id: 2, assigned: [ERIC] },
      ]),
    );
    expect(out.failed.map((f) => f.id)).toEqual([6]);
    expect(out.saved.map((s) => s.after.id)).toEqual([2]);
    expect(alerts).toHaveBeenCalledTimes(1);
  });
});
