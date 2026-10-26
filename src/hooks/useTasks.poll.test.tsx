import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { Comment, Task } from "@/types/task";
import { MOCK_TASKS } from "@/data/mockData";

// =============================================================================
// An open task's detail page re-reads THAT TASK, not the whole list.
//
// DetailView used to invalidate the entire task list every 20 seconds to pick
// up new comments: ~17 pages, every comment thread on the list, per person
// with a task open (2026-10-26, investigating SharePoint 504s). useTaskPoll
// reads the one row and lands it in the cache instead — and must never paint
// an older read over an edit that is still landing.
//
// Real timers with a short interval: faking setInterval also freezes Testing
// Library's waitFor, which polls on it.
// =============================================================================

const listTasks = vi.hoisted(() => vi.fn());
const getTask = vi.hoisted(() => vi.fn());

vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  listTasks,
  getTask,
}));

import { TASK_LIST_KEY, useTaskPoll, useTasks } from "./useTasks";

const INTERVAL = 20;

const TASK: Task = { ...MOCK_TASKS[0], id: 15, comments: [], childTasks: [], parentTask: null };

const NEW_COMMENT: Comment = {
  timestamp: new Date(2026, 9, 26, 9, 30),
  authorName: "Brandon Mirto",
  authorEmail: "brandon.mirto@altronic-llc.com",
  bodyHtml: "<p>new from someone else</p>",
};

/** A never-settling task write, to stand in for one still in flight. */
function usePendingTaskWrite() {
  return useMutation({
    mutationKey: ["tasks", "write"],
    mutationFn: () => new Promise<never>(() => undefined),
  });
}

/** Mount with the poll off, let the list load, then turn the poll on. */
async function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ id }: { id: number | null }) => {
      useTasks();
      useTaskPoll(id, INTERVAL);
      return usePendingTaskWrite();
    },
    { wrapper, initialProps: { id: null as number | null } },
  );
  await waitFor(() => expect(cachedComments(qc)).toEqual([]));
  return { qc, start: () => hook.rerender({ id: 15 }), ...hook };
}

function cachedComments(qc: QueryClient): Comment[] | undefined {
  return qc.getQueryData<Task[]>(TASK_LIST_KEY)?.find((t) => t.id === 15)?.comments;
}

/** Let several poll intervals pass. */
async function letTicksPass() {
  await act(() => new Promise((resolve) => setTimeout(resolve, INTERVAL * 5)));
}

beforeEach(() => {
  listTasks.mockReset();
  getTask.mockReset();
  listTasks.mockResolvedValue([TASK]);
  getTask.mockResolvedValue({ ...TASK, comments: [NEW_COMMENT] });
});

afterEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("useTaskPoll", () => {
  it("re-reads the one task and lands its new comment in the cache", async () => {
    const { qc, start } = await setup();
    start();

    await waitFor(() => expect(cachedComments(qc)).toEqual([NEW_COMMENT]));
    expect(getTask).toHaveBeenCalledWith(15);
  });

  it("never downloads the whole list to do it", async () => {
    const { start } = await setup();
    start();

    await waitFor(() => expect(getTask.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(listTasks).toHaveBeenCalledTimes(1); // the page's own first load
  });

  it("skips while a task write is in flight", async () => {
    const { result, start } = await setup();
    act(() => result.current.mutate());
    start();

    await letTicksPass();
    expect(getTask).not.toHaveBeenCalled();
  });

  it("throws away a read that a write overtook — its row predates the write", async () => {
    let answer: (t: Task) => void = () => undefined;
    getTask.mockImplementationOnce(() => new Promise<Task>((resolve) => (answer = resolve)));
    const { qc, result, start } = await setup();
    start();

    await waitFor(() => expect(getTask).toHaveBeenCalledTimes(1));
    act(() => result.current.mutate());
    await act(async () => answer({ ...TASK, comments: [NEW_COMMENT] }));

    await letTicksPass();
    expect(cachedComments(qc)).toEqual([]);
  });

  it("never stacks a second read on one SharePoint is slow to answer", async () => {
    getTask.mockImplementation(() => new Promise<Task>(() => undefined));
    const { start } = await setup();
    start();

    await letTicksPass();
    expect(getTask).toHaveBeenCalledTimes(1);
  });

  it("doesn't read while the tab is hidden", async () => {
    const { start } = await setup();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    start();

    await letTicksPass();
    expect(getTask).not.toHaveBeenCalled();
  });

  it("stops when the page closes", async () => {
    const { start, unmount } = await setup();
    start();
    await waitFor(() => expect(getTask).toHaveBeenCalled());
    unmount();
    const calls = getTask.mock.calls.length;

    await act(() => new Promise((resolve) => setTimeout(resolve, INTERVAL * 5)));
    expect(getTask.mock.calls.length).toBe(calls);
  });

  it("refreshes the list when the task has gone, so the page can say so", async () => {
    getTask.mockResolvedValue(null);
    const { start } = await setup();
    start();

    await waitFor(() => expect(listTasks.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
