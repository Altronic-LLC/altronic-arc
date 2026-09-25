// A mentioned person becomes a watcher when Post is pressed — not after the
// comment's SharePoint round trip (Ray, 2026-09-25). The comment write is a
// promise WE control, so "before the server answers" is an assertable moment.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_TASKS } from "@/data/mockData";
import type { Task } from "@/types/task";

vi.mock("@/api/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/tasks")>();
  return { ...actual, listTasks: vi.fn(), addComment: vi.fn(), setWatchers: vi.fn() };
});
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/email", () => ({ notifyMentions: vi.fn() }));
vi.mock("./useCommentMirror", () => ({ fanOutComment: vi.fn() }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

import { useAddComment } from "./useTasks";
import { addComment, listTasks, setWatchers } from "@/api/tasks";

const KEY = ["tasks", "list"];
const TARGET: Task = { ...MOCK_TASKS[0], watchers: [] };
const NEW_PERSON = { email: "zed.newperson@altronic-llc.com", displayName: "Zed Newperson" };
const BODY = `<p>see <span class="mention" data-email="${NEW_PERSON.email}">@${NEW_PERSON.displayName}</span></p>`;
const COMMENT = { authorName: "Ray", authorEmail: "ray.white@altronic-llc.com", bodyHtml: BODY };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  qc.setQueryData(KEY, [TARGET]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const watchersOf = (qc: QueryClient) =>
  qc.getQueryData<Task[]>(KEY)?.find((t) => t.id === TARGET.id)?.watchers ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  (listTasks as Mock).mockResolvedValue([TARGET]);
  (setWatchers as Mock).mockResolvedValue(TARGET);
});

describe("useAddComment — mention auto-watch timing", () => {
  it("shows the mentioned person as a watcher while the comment write is still in flight", async () => {
    const write = deferred<Task>();
    (addComment as Mock).mockReturnValue(write.promise);
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useAddComment(), { wrapper });

    act(() => result.current.mutate({ id: TARGET.id, comment: COMMENT }));

    await waitFor(() =>
      expect(watchersOf(qc).map((w) => w.email)).toContain(NEW_PERSON.email),
    );
    expect(result.current.isPending).toBe(true);
    // Nothing is WRITTEN until the comment has landed.
    expect(setWatchers).not.toHaveBeenCalled();

    write.resolve({ ...TARGET });
    await waitFor(() => expect(setWatchers).toHaveBeenCalled());
    const written = (setWatchers as Mock).mock.calls[0][1];
    expect(written.map((w: { email: string }) => w.email)).toContain(NEW_PERSON.email);
  });

  it("a comment that fails adds nobody, on screen or in SharePoint", async () => {
    const write = deferred<Task>();
    (addComment as Mock).mockReturnValue(write.promise);
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useAddComment(), { wrapper });

    act(() => result.current.mutate({ id: TARGET.id, comment: COMMENT }));
    await waitFor(() => expect(watchersOf(qc)).toHaveLength(1));

    write.reject(new Error("503"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(watchersOf(qc)).toEqual([]);
    expect(setWatchers).not.toHaveBeenCalled();
  });

  it("the post-comment refetch waits for the watcher write, so it can't wipe the chip", async () => {
    (addComment as Mock).mockResolvedValue({ ...TARGET });
    const watch = deferred<Task>();
    (setWatchers as Mock).mockReturnValue(watch.promise);
    const { qc, wrapper } = harness();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useAddComment(), { wrapper });

    act(() => result.current.mutate({ id: TARGET.id, comment: COMMENT }));
    await waitFor(() => expect(setWatchers).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The returned row predates the watcher — it must not have been reconciled over the chip.
    expect(watchersOf(qc).map((w) => w.email)).toContain(NEW_PERSON.email);
    expect(invalidate).not.toHaveBeenCalled();

    watch.resolve({ ...TARGET });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
});
