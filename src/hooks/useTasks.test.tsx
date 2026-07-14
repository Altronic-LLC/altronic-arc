import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_TASKS } from "@/data/mockData";

vi.mock("@/api/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/tasks")>();
  return { ...actual, createTask: vi.fn(), listTasks: vi.fn() };
});

import { useCreateTask, useTasks } from "./useTasks";
import { createTask, listTasks } from "@/api/tasks";

const TASK_LIST_KEY = ["tasks", "list"];
const NEW_TASK = { ...MOCK_TASKS[0], id: 999, title: "Brand new task" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCreateTask", () => {
  it("seeds the new task into the tasks-list cache immediately — before the background refetch (triggered by invalidateTasks) resolves — so a page that reads useTasks() sees it right away instead of a stale list", async () => {
    (createTask as Mock).mockResolvedValue(NEW_TASK);

    // Make the background refetch hang so we can assert on the
    // in-between state, matching what a slow real-SharePoint round-trip
    // looks like (as opposed to the near-instant mock list).
    let resolveList!: (tasks: typeof MOCK_TASKS) => void;
    (listTasks as Mock).mockImplementation(
      () => new Promise((resolve) => { resolveList = resolve; }),
    );

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    // Pre-seed the list cache (fresh, within useTasks' staleTime) so the
    // initial mount serves this data without calling listTasks — isolating
    // the assertion to what invalidateTasks' refetch does.
    qc.setQueryData(TASK_LIST_KEY, MOCK_TASKS);

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }

    const { result: listResult } = renderHook(() => useTasks(), { wrapper });
    const { result: createResult } = renderHook(() => useCreateTask(), { wrapper });

    expect(listResult.current.data?.some((t) => t.id === NEW_TASK.id)).toBe(false);

    await createResult.current.mutateAsync({ title: NEW_TASK.title });

    // The invalidated refetch is still pending (listTasks hasn't resolved,
    // and we haven't told it to) — the new task must already be visible
    // regardless. waitFor just gives React a tick to flush the cache
    // update into this render; it does NOT wait on the hung listTasks call.
    expect(listTasks).toHaveBeenCalled();
    await waitFor(() =>
      expect(listResult.current.data?.some((t) => t.id === NEW_TASK.id)).toBe(true),
    );

    resolveList(MOCK_TASKS); // let the background refetch settle so nothing hangs
    await waitFor(() => expect(listResult.current.isFetching).toBe(false));
  });
});
