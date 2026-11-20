import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task } from "@/types/task";
import { MOCK_TASKS } from "@/data/mockData";

// =============================================================================
// The task List and Kanban show the most recently changed tasks while the
// full list (~16 s, 2026-10-26) downloads — WITHOUT the partial set ever
// reaching TASK_LIST_KEY. Task numbering, the project-delete guard, the
// open-child completion gate, the mention marker and EIR task links all read
// that key as "every task", and each goes wrong on a partial one.
// =============================================================================

const listTasks = vi.hoisted(() => vi.fn());
const listRecentTasks = vi.hoisted(() => vi.fn());

vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  listTasks,
  listRecentTasks,
}));

import { TASK_LIST_KEY, useTaskListWithPreview } from "./useTasks";

const ALL: Task[] = MOCK_TASKS.slice(0, 6).map((t) => ({ ...t }));
const RECENT: Task[] = ALL.slice(0, 2);

/** A full-list download that finishes only when the test says so. */
function slowFullList() {
  let finish: (tasks: Task[]) => void = () => undefined;
  listTasks.mockImplementation(() => new Promise<Task[]>((resolve) => (finish = resolve)));
  return (tasks: Task[]) => finish(tasks);
}

function setup(seed?: Task[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) qc.setQueryData(TASK_LIST_KEY, seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => useTaskListWithPreview(), { wrapper }) };
}

beforeEach(() => {
  listTasks.mockReset();
  listRecentTasks.mockReset();
  listRecentTasks.mockResolvedValue(RECENT);
});

describe("useTaskListWithPreview", () => {
  it("shows the recent tasks while the full list is still downloading", async () => {
    slowFullList();
    const { result } = setup();

    await waitFor(() => expect(result.current.preview).toBe(true));
    expect(result.current.data).toEqual(RECENT);
    expect(result.current.isLoading).toBe(false);
  });

  it("never puts the partial set where 'every task' is read", async () => {
    slowFullList();
    const { result, qc } = setup();

    await waitFor(() => expect(result.current.preview).toBe(true));
    expect(qc.getQueryData(TASK_LIST_KEY)).toBeUndefined();
  });

  it("gives way to the full list the moment it lands", async () => {
    const finish = slowFullList();
    const { result } = setup();
    await waitFor(() => expect(result.current.preview).toBe(true));

    finish(ALL);

    await waitFor(() => expect(result.current.data).toEqual(ALL));
    expect(result.current.preview).toBe(false);
  });

  it("doesn't ask for a preview when the full list is already here", async () => {
    listTasks.mockResolvedValue(ALL);
    const { result } = setup(ALL);

    expect(result.current.data).toEqual(ALL);
    expect(result.current.preview).toBe(false);
    expect(listRecentTasks).not.toHaveBeenCalled();
  });

  it("a preview that fails leaves the screen loading, as it was before", async () => {
    slowFullList();
    listRecentTasks.mockRejectedValue(new Error("Graph 400 — the list passed 5,000 items"));
    const { result } = setup();

    await waitFor(() => expect(listRecentTasks).toHaveBeenCalled());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.preview).toBe(false);
  });
});
