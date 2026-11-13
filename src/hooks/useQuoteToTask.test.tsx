import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

// =============================================================================
// A won quote → an Engineering / Operations task, end to end in mock mode:
// what the task carries, what the quote records, and then the shared
// conversation in BOTH directions — with a hand-linked task left out (Ray:
// "only button links"). Nothing between the hooks and the API's mock branch
// is mocked except email, toasts and who is signed in.
// =============================================================================

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: who.emails[0], lookupId: 1 }),
  useCurrentUserEmails: () => who.emails,
}));
const email = vi.hoisted(() => ({
  notifyMentions: vi.fn(async () => ({ sent: [], failed: [] })),
  notifyChangeEmails: vi.fn(async () => ({ sent: [], failed: [] })),
}));
vi.mock("@/api/email", () => email);
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import { listQuotes } from "@/api/quotes";
import { listTasks } from "@/api/tasks";
import { listOperationsTasks, resetOperationsMockStore } from "@/api/operationsTasks";
import { fanOutComment } from "./useCommentMirror";
import { QUOTES_KEY } from "./useQuotes";
import { TASK_LIST_KEY } from "./useTasks";
import { OPERATIONS_TASK_LIST_KEY } from "./useOperationsTasks";
import { useCreateTaskFromQuote } from "./useQuoteToTask";
import { quoteOriginOfTask } from "@/lib/quoteToTask";
import type { Quote } from "@/types/quote";

const DEMO = { displayName: "Demo User", email: "demo.user@altronic-llc.com" };

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

async function quote(id: number): Promise<Quote> {
  return (await listQuotes()).find((q) => q.id === id)!;
}

/** Reload the three lists into the cache, as the pages would have. */
async function prime(qc: QueryClient) {
  qc.setQueryData(QUOTES_KEY, await listQuotes());
  qc.setQueryData(TASK_LIST_KEY, await listTasks());
  qc.setQueryData(OPERATIONS_TASK_LIST_KEY, await listOperationsTasks());
}

beforeEach(() => {
  __resetQuoteMockStores();
  resetOperationsMockStore();
  who.emails = ["demo.user@altronic-llc.com"];
  email.notifyChangeEmails.mockClear();
});

describe("useCreateTaskFromQuote", () => {
  it("creates an Engineering task carrying the discussion, and records it on the quote", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateTaskFromQuote(), { wrapper });
    const won = await quote(3);
    // Give the quote a discussion to carry.
    const { addQuoteComment } = await import("@/api/quotes");
    await addQuoteComment(3, { authorName: "Katie Fleming", authorEmail: "katie.fleming@altronic-llc.com", bodyHtml: "<p>PO received.</p>" });

    const out = await act(() =>
      result.current.mutateAsync({
        quote: won,
        department: "engineering",
        title: "Wabtec retrofit",
        project: { lookupId: 501, title: "0017-AMP-5000 Refresh" },
        numberedTitle: "T9-0017-Wabtec retrofit",
        createdBy: DEMO,
      }),
    );
    expect(out.warning).toBeNull();
    const task = (await listTasks()).find((t) => t.id === out.taskId)!;
    expect(task.numberedTitle).toBe("T9-0017-Wabtec retrofit");
    expect(task.parentProject?.lookupId).toBe(501);
    expect(task.description).toContain("Won quote IQ-WAB-0002-R1");
    expect(quoteOriginOfTask(task.comments)?.quoteId).toBe(3);
    const carried = task.comments.find((c) => c.bodyHtml.includes("PO received."))!;
    expect(carried.authorName).toBe("Katie Fleming");
    expect(carried.bodyHtml).toContain("carried over from quote IQ-WAB-0002-R1");
    // The quote's watchers watch the task, and so does whoever created it.
    expect(task.watchers.map((p) => p.email)).toEqual(
      expect.arrayContaining(["katie.fleming@altronic-llc.com", "demo.user@altronic-llc.com"]),
    );

    const after = await quote(3);
    expect(after.engineeringTaskId).toBe(task.id);
    expect(after.engineeringProjectRef).toBe("0017-AMP-5000 Refresh");
    expect(after.comments[0].bodyHtml).toContain("T9-0017-Wabtec retrofit");
    expect(email.notifyChangeEmails).toHaveBeenCalledTimes(1);
  });

  it("numbers an Operations task from the fresh list and records it", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateTaskFromQuote(), { wrapper });
    const won = await quote(3);
    const out = await act(() =>
      result.current.mutateAsync({
        quote: won,
        department: "operations",
        title: "Wabtec build",
        project: { lookupId: 35, title: "0035-Aqueous" },
        createdBy: DEMO,
      }),
    );
    const task = (await listOperationsTasks()).find((t) => t.id === out.taskId)!;
    expect(task.taskNumber).toMatch(/^Task 0035-\d+$/);
    expect(quoteOriginOfTask(task.comments)?.quoteBase).toBe("IQ-WAB-0002");
    expect((await quote(3)).operationsTaskId).toBe(task.id);
  });

  it("refuses a quote that isn't Won, and a viewer, before writing anything", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateTaskFromQuote(), { wrapper });
    const before = (await listTasks()).length;
    const input = { department: "engineering" as const, title: "x", project: { lookupId: 17, title: "0017" }, createdBy: DEMO };
    const draft = await quote(4);
    const won = await quote(3);
    await act(() => expect(result.current.mutateAsync({ ...input, quote: draft })).rejects.toThrow(/once the quote is Won/));
    who.emails = ["brandon.mirto@altronic-llc.com"]; // a viewer
    const asViewer = renderHook(() => useCreateTaskFromQuote(), { wrapper }).result;
    await act(() => expect(asViewer.current.mutateAsync({ ...input, quote: won })).rejects.toThrow(/quoter|manager|permission|can't|only/i));
    expect((await listTasks()).length).toBe(before);
  });
});

describe("the shared conversation", () => {
  async function created(department: "engineering" | "operations") {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateTaskFromQuote(), { wrapper });
    const won = await quote(3);
    const out = await act(() =>
      result.current.mutateAsync({
        quote: won,
        department,
        title: "Shared",
        project: department === "engineering" ? { lookupId: 17, title: "0017" } : { lookupId: 35, title: "0035-Aqueous" },
        numberedTitle: "T9-0017-Shared",
        createdBy: DEMO,
      }),
    );
    await prime(qc);
    return { qc, taskId: out.taskId };
  }
  const comment = (text: string) => ({ authorName: "Katie Fleming", authorEmail: "katie.fleming@altronic-llc.com", bodyHtml: `<p>${text}</p>` });

  it("a quote comment reaches its Engineering task, and a task comment reaches the quote", async () => {
    const { qc, taskId } = await created("engineering");
    await fanOutComment({ qc, source: { kind: "quote", id: 3 }, comment: comment("From the quote"), alreadyNotified: [] });
    const task = (await listTasks()).find((t) => t.id === taskId)!;
    const mirrored = task.comments.find((c) => c.bodyHtml.includes("From the quote"))!;
    expect(mirrored.bodyHtml).toContain("Posted on quote IQ-WAB-0002-R1");
    expect(mirrored.authorName).toBe("Katie Fleming");

    await fanOutComment({ qc, source: { kind: "task", id: taskId }, comment: comment("From the task"), alreadyNotified: [] });
    expect((await quote(3)).comments.some((c) => c.bodyHtml.includes("From the task"))).toBe(true);
  });

  it("an Operations task comment reaches the quote — even with the quotes list not loaded", async () => {
    const { qc, taskId } = await created("operations");
    qc.removeQueries({ queryKey: QUOTES_KEY });
    await fanOutComment({ qc, source: { kind: "operationsTask", id: taskId }, comment: comment("From ops"), alreadyNotified: [] });
    expect((await quote(3)).comments.some((c) => c.bodyHtml.includes("From ops"))).toBe(true);
  });

  it("a task linked BY HAND shares nothing", async () => {
    const { qc } = setup();
    await prime(qc);
    // Quote 4 names task 47 under Linked work, picked by hand.
    const before = (await listTasks()).find((t) => t.id === 47)!.comments.length;
    await fanOutComment({ qc, source: { kind: "quote", id: 4 }, comment: comment("Hand linked"), alreadyNotified: [] });
    expect((await listTasks()).find((t) => t.id === 47)!.comments.length).toBe(before);
  });
});
