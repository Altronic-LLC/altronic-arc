// Optimistic-edit behaviour for task writes.
//
// SharePoint-via-Graph writes take a second or more, so nothing in the task
// UI is allowed to wait on the round-trip. These tests pin the whole contract
// by driving the write with a promise WE control, so "before the server
// answers" is an actual assertable moment rather than a race:
//
//   1. the edit is in the cache before the write resolves
//   2. the server's returned Task replaces it without waiting for a list
//      refetch (reconcile)
//   3. a failed write rolls the cache back to exactly what it was, loudly
//   4. an in-flight list refetch can't eat the optimistic patch
//   5. a sibling write still in flight can't be clobbered by an earlier
//      write's reconcile/invalidate
//
// See the "Optimistic update + toast/undo infrastructure" block in
// useTasks.ts for the design these tests hold in place.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_TASKS } from "@/data/mockData";
import type { Task } from "@/types/task";

vi.mock("@/api/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/tasks")>();
  return {
    ...actual,
    listTasks: vi.fn(),
    updateTaskFields: vi.fn(),
    setTaskStatus: vi.fn(),
  };
});

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

// Notification side effects are fire-and-forget in onSuccess; stub them so a
// cache assertion never depends on mail.
vi.mock("@/api/email", () => ({
  fireAssigneeChangeAlert: vi.fn(),
  fireChecklistToggleAlert: vi.fn(),
  fireFieldChangeAlert: vi.fn(),
  notifyMentions: vi.fn(),
}));

// useCurrentUser reads MSAL context; there's no MsalProvider in a hook test.
vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

import { useSetStatus, useTasks, useUpdateTaskFields } from "./useTasks";
import { listTasks, setTaskStatus, updateTaskFields } from "@/api/tasks";
import { pushToast } from "@/components/Toast";

const TASK_LIST_KEY = ["tasks", "list"];

/** Two rows is enough: one we edit, one that must be left alone. */
const TARGET = MOCK_TASKS[0];
const OTHER = MOCK_TASKS[1];
const SEED: Task[] = [TARGET, OTHER];

/** A promise whose settlement this test decides — i.e. "the SharePoint write". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing awaits a rejection until the hook does; keep Node quiet meanwhile.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function harness({ seed = true }: { seed?: boolean } = {}) {
  const qc = new QueryClient({
    // gcTime must NOT be 0 here: a seeded query with no mounted observer is
    // collected immediately at 0, so the cache these tests assert on would
    // vanish before the mutation ran.
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000 },
      mutations: { retry: false },
    },
  });
  if (seed) qc.setQueryData(TASK_LIST_KEY, SEED);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper };
}

function cachedTask(qc: QueryClient, id: number): Task | undefined {
  return qc.getQueryData<Task[]>(TASK_LIST_KEY)?.find((t) => t.id === id);
}

beforeEach(() => {
  vi.clearAllMocks();
  (listTasks as Mock).mockResolvedValue(SEED);
});

describe("useUpdateTaskFields — optimistic edit", () => {
  it("puts the edited value in the cache before the SharePoint write resolves", async () => {
    const write = deferred<Task>();
    (updateTaskFields as Mock).mockReturnValue(write.promise);
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    expect(cachedTask(qc, TARGET.id)?.priority).toBe("Medium");

    act(() => {
      result.current.mutate({ id: TARGET.id, fields: { Priority: "High" } });
    });

    // The write is still in flight — the UI must already read "High".
    await waitFor(() => expect(cachedTask(qc, TARGET.id)?.priority).toBe("High"));
    expect(result.current.isPending).toBe(true);
    // The untouched row is untouched.
    expect(cachedTask(qc, OTHER.id)).toBe(OTHER);

    write.resolve({ ...TARGET, priority: "High" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("reconciles with the Task the write returned, without waiting for the list refetch", async () => {
    const write = deferred<Task>();
    (updateTaskFields as Mock).mockReturnValue(write.promise);
    // Hang the post-write refetch, the way a slow SharePoint list download
    // would. The server's own copy must land regardless.
    const refetch = deferred<Task[]>();
    (listTasks as Mock).mockReturnValue(refetch.promise);

    const { qc, wrapper } = harness();
    renderHook(() => useTasks(), { wrapper }); // makes the list query active
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    act(() => {
      result.current.mutate({ id: TARGET.id, fields: { Title: "Typed by the user" } });
    });
    await waitFor(() => expect(cachedTask(qc, TARGET.id)?.title).toBe("Typed by the user"));

    // SharePoint normalised the title on save — that's the value that must win.
    write.resolve({ ...TARGET, title: "Typed by the user (server)" });

    await waitFor(() =>
      expect(cachedTask(qc, TARGET.id)?.title).toBe("Typed by the user (server)"),
    );
    // …and it won while the invalidated refetch was still outstanding.
    expect(listTasks).toHaveBeenCalled();
    refetch.resolve(SEED);
  });

  it("rolls the cache back to exactly its previous contents when the write fails, and says so", async () => {
    const write = deferred<Task>();
    (updateTaskFields as Mock).mockReturnValue(write.promise);
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    act(() => {
      result.current.mutate({
        id: TARGET.id,
        fields: { Priority: "High", Category: "Software" },
      });
    });
    await waitFor(() => expect(cachedTask(qc, TARGET.id)?.priority).toBe("High"));

    write.reject(new Error("Graph 403 accessDenied"));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(qc.getQueryData<Task[]>(TASK_LIST_KEY)).toStrictEqual(SEED);
    expect(cachedTask(qc, TARGET.id)?.priority).toBe("Medium");
    expect(cachedTask(qc, TARGET.id)?.category).toBe("Hardware");
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
  });

  it("leaves an empty tasks cache empty — patching it with [] would render 'no tasks' and give the rollback nothing to restore", async () => {
    const write = deferred<Task>();
    (updateTaskFields as Mock).mockReturnValue(write.promise);
    const { qc, wrapper } = harness({ seed: false });
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    act(() => {
      result.current.mutate({ id: TARGET.id, fields: { Priority: "High" } });
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(qc.getQueryData(TASK_LIST_KEY)).toBeUndefined();

    write.reject(new Error("nope"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(TASK_LIST_KEY)).toBeUndefined();
  });

  it("survives a list refetch that was already in flight when the edit was made", async () => {
    const staleRefetch = deferred<Task[]>();
    (listTasks as Mock).mockReturnValueOnce(staleRefetch.promise);
    const write = deferred<Task>();
    (updateTaskFields as Mock).mockReturnValue(write.promise);

    const { qc, wrapper } = harness();
    renderHook(() => useTasks(), { wrapper });
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    // Something else kicks off a list fetch (DetailView polls every 20s).
    await act(async () => {
      void qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    });
    await waitFor(() => expect(listTasks).toHaveBeenCalled());

    // User edits while that fetch is outstanding.
    act(() => {
      result.current.mutate({ id: TARGET.id, fields: { Priority: "High" } });
    });
    await waitFor(() => expect(cachedTask(qc, TARGET.id)?.priority).toBe("High"));

    // The poll now comes back with pre-edit data. onMutate cancelled it, so it
    // must NOT be written over the optimistic value.
    await act(async () => {
      staleRefetch.resolve(SEED);
      await Promise.resolve();
    });
    expect(cachedTask(qc, TARGET.id)?.priority).toBe("High");

    write.resolve({ ...TARGET, priority: "High" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("does not let one write's reconcile or refetch clobber a sibling write that is still in flight", async () => {
    const first = deferred<Task>();
    const second = deferred<Task>();
    (updateTaskFields as Mock)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { qc, wrapper } = harness();
    renderHook(() => useTasks(), { wrapper });
    const a = renderHook(() => useUpdateTaskFields(), { wrapper });
    const b = renderHook(() => useUpdateTaskFields(), { wrapper });

    act(() => {
      a.result.current.mutate({ id: TARGET.id, fields: { Priority: "High" } });
    });
    act(() => {
      b.result.current.mutate({ id: TARGET.id, fields: { Category: "Software" } });
    });
    await waitFor(() => {
      expect(cachedTask(qc, TARGET.id)?.priority).toBe("High");
      expect(cachedTask(qc, TARGET.id)?.category).toBe("Software");
    });

    // The first write returns a row read before the second was even sent —
    // it still says Category: Hardware.
    first.resolve({ ...TARGET, priority: "High" });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));

    expect(cachedTask(qc, TARGET.id)?.category).toBe("Software");
    expect(listTasks).not.toHaveBeenCalled(); // no mid-burst refetch either

    // The last write to settle reconciles and invalidates, so the server still
    // gets the final say.
    second.resolve({ ...TARGET, priority: "High", category: "Software" });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(listTasks).toHaveBeenCalled());
  });
});

describe("useSetStatus — optimistic drag on the Kanban board", () => {
  it("moves the card before SharePoint confirms", async () => {
    const write = deferred<Task>();
    (setTaskStatus as Mock).mockReturnValue(write.promise);
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useSetStatus(), { wrapper });

    act(() => {
      result.current.mutate({ id: TARGET.id, status: "In Progress" });
    });

    await waitFor(() => expect(cachedTask(qc, TARGET.id)?.status).toBe("In Progress"));
    expect(result.current.isPending).toBe(true);

    write.resolve({ ...TARGET, status: "In Progress" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("puts the card back where it was if the status write fails", async () => {
    const write = deferred<Task>();
    (setTaskStatus as Mock).mockReturnValue(write.promise);
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useSetStatus(), { wrapper });

    act(() => {
      result.current.mutate({ id: TARGET.id, status: "Blocked" });
    });
    await waitFor(() => expect(cachedTask(qc, TARGET.id)?.status).toBe("Blocked"));

    write.reject(new Error("SharePoint said no"));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(qc.getQueryData<Task[]>(TASK_LIST_KEY)).toStrictEqual(SEED);
    expect(cachedTask(qc, TARGET.id)?.status).toBe("Complete");
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
  });
});
