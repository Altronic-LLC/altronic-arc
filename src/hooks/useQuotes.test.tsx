import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetQuoteMockStores } from "@/data/quoteMockData";
import type { Quote } from "@/types/quote";

// =============================================================================
// The Quote header hooks, in mock mode. Every gate is asked inside the
// mutationFn against access resolved from the mock Quote Roles list, so a
// refused role is shown to reach NO API call (call-through spies).
// =============================================================================

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));
vi.mock("@/api/quotes", async (orig) => {
  const a = await orig<typeof import("@/api/quotes")>();
  return {
    ...a,
    createQuote: vi.fn(a.createQuote),
    updateQuoteFields: vi.fn(a.updateQuoteFields),
    setQuoteWatchers: vi.fn(a.setQuoteWatchers),
    setQuoteLinks: vi.fn(a.setQuoteLinks),
    addQuoteComment: vi.fn(a.addQuoteComment),
    editQuoteComment: vi.fn(a.editQuoteComment),
  };
});
vi.mock("@/api/quoteRevisions", async (orig) => {
  const a = await orig<typeof import("@/api/quoteRevisions")>();
  return { ...a, createQuoteRevision: vi.fn(a.createQuoteRevision) };
});
const email = vi.hoisted(() => ({ notifyMentions: vi.fn(async (_input: unknown) => ({ sent: [] as string[], failed: [] })) }));
vi.mock("@/api/email", () => email);
vi.mock("@/api/operationsTasks", () => ({ resolvePmoSiteUserLookupId: vi.fn(async () => 501) }));
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast }));

import * as api from "@/api/quotes";
import * as revApi from "@/api/quoteRevisions";
import {
  QUOTES_KEY,
  useAddQuoteComment,
  useCreateQuote,
  useCreateQuoteRevision,
  useEditQuoteComment,
  useQuote,
  useQuoteRevisions,
  useSetQuoteLinks,
  useSetQuoteWatchers,
  useUpdateQuoteFields,
} from "./useQuotes";

const MANAGER = ["demo.user@altronic-llc.com"];
const QUOTER = ["katie.fleming@altronic-llc.com"];
const VIEWER = ["brandon.mirto@altronic-llc.com"];

const mention = (name: string, address: string) =>
  `<p><span class="mention" data-email="${address}">@${name}</span> please look</p>`;

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

/** Load the quotes list into the cache, as the detail page would have. */
async function primed(as: string[]) {
  who.emails = as;
  const s = setup();
  await s.qc.fetchQuery({ queryKey: QUOTES_KEY, queryFn: api.listQuotes });
  return s;
}

const NEW_QUOTE = {
  customerId: 3,
  customerCode: "INN",
  contactName: "A Buyer",
  contactEmail: "buyer@example.com",
  validityDays: 30,
  budgetary: false,
  budgetaryText: "",
  quoteNotes: "",
};

beforeEach(() => {
  __resetQuoteMockStores();
  who.emails = MANAGER;
  for (const fn of [
    api.createQuote,
    api.updateQuoteFields,
    api.setQuoteWatchers,
    api.setQuoteLinks,
    api.addQuoteComment,
    api.editQuoteComment,
    revApi.createQuoteRevision,
  ]) {
    vi.mocked(fn).mockClear();
  }
  email.notifyMentions.mockClear();
  pushToast.mockClear();
});

describe("reads", () => {
  it("useQuote derives one row from the list; useQuoteRevisions lists a base newest first", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ one: useQuote(2), revs: useQuoteRevisions("IQ-COO-0001") }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.one.data).toBeDefined());
    expect(result.current.one.data!.quoteNumber).toBe("IQ-COO-0001-R2");
    expect(result.current.revs.data.map((q) => q.rev)).toEqual([2, 1]);
  });
});

describe("useCreateQuote", () => {
  it("refuses a viewer BEFORE any write", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuote(), { wrapper });
    await act(() => expect(result.current.mutateAsync(NEW_QUOTE)).rejects.toThrow(/quoters and quote managers/));
    expect(api.createQuote).not.toHaveBeenCalled();
  });

  it("lets a quoter create; the creator watches it, and the row is seeded into the cache", async () => {
    who.emails = QUOTER;
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateQuote(), { wrapper });
    const created = await act(() => result.current.mutateAsync(NEW_QUOTE));
    expect(created.quoteNumber).toMatch(/^IQ-INN-\d{4}-R1$/);
    const sent = vi.mocked(api.createQuote).mock.calls[0][0];
    expect(sent.watchers.map((p) => p.email)).toContain("katie.fleming@altronic-llc.com");
    expect(qc.getQueryData<Quote[]>(QUOTES_KEY)?.some((q) => q.id === created.id)).toBe(true);
  });
});

describe("useUpdateQuoteFields", () => {
  it("refuses a viewer BEFORE any write and rolls the optimistic patch back", async () => {
    const { qc, wrapper } = await primed(VIEWER);
    const { result } = renderHook(() => useUpdateQuoteFields(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: 2, patch: { quoteNotes: "x" } })).rejects.toThrow());
    expect(api.updateQuoteFields).not.toHaveBeenCalled();
    expect(qc.getQueryData<Quote[]>(QUOTES_KEY)?.find((q) => q.id === 2)?.quoteNotes).not.toBe("x");
  });

  it("refuses a QUOTER setting an outcome (Sent → Won) BEFORE any write", async () => {
    const { wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useUpdateQuoteFields(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 1, patch: { status: "Won" } })).rejects.toThrow(/quote manager/),
    );
    expect(api.updateQuoteFields).not.toHaveBeenCalled();
  });

  it("refuses a quoter reopening a Won quote", async () => {
    const { wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useUpdateQuoteFields(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: 3, patch: { status: "Draft" } })).rejects.toThrow());
    expect(api.updateQuoteFields).not.toHaveBeenCalled();
  });

  it("lets a quoter move Sent → Draft, diffed against the PRE-patch row", async () => {
    const { wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useUpdateQuoteFields(), { wrapper });
    const updated = await act(() => result.current.mutateAsync({ id: 1, patch: { status: "Draft" } }));
    expect(updated.status).toBe("Draft");
    const [, , previous] = vi.mocked(api.updateQuoteFields).mock.calls[0];
    expect(previous.status).toBe("Sent");
  });

  it("lets a manager mark a quote Won", async () => {
    const { wrapper } = await primed(MANAGER);
    const { result } = renderHook(() => useUpdateQuoteFields(), { wrapper });
    const updated = await act(() => result.current.mutateAsync({ id: 1, patch: { status: "Won" } }));
    expect(updated.status).toBe("Won");
  });
});

describe("comments and watchers — open to a viewer", () => {
  it("a viewer can comment; watchers are emailed and a mention becomes a watcher", async () => {
    const { qc, wrapper } = await primed(VIEWER);
    const { result } = renderHook(() => useAddQuoteComment(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        id: 1,
        comment: {
          authorName: "Brandon Mirto",
          authorEmail: "brandon.mirto@altronic-llc.com",
          bodyHtml: mention("Amanda Hoagland", "amanda.hoagland@altronic-llc.com"),
        },
      }),
    );
    expect(api.addQuoteComment).toHaveBeenCalledTimes(1);
    expect(email.notifyMentions).toHaveBeenCalledTimes(1);
    const sent = email.notifyMentions.mock.calls[0][0] as unknown as {
      recipients: { email: string; reason: string }[];
      target: { kind: string; id: number };
    };
    expect(sent.target).toMatchObject({ kind: "quote", id: 1 });
    const to = sent.recipients.map((r) => r.email);
    expect(to).toContain("katie.fleming@altronic-llc.com"); // a watcher
    expect(to).toContain("amanda.hoagland@altronic-llc.com"); // mentioned
    await waitFor(() => expect(api.setQuoteWatchers).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        qc
          .getQueryData<Quote[]>(QUOTES_KEY)
          ?.find((q) => q.id === 1)
          ?.watchers.some((w) => w.email === "amanda.hoagland@altronic-llc.com"),
      ).toBe(true),
    );
  });

  it("refuses somebody with no quote role BEFORE any write", async () => {
    const { wrapper } = await primed(["nobody@altronic-llc.com"]);
    const { result } = renderHook(() => useAddQuoteComment(), { wrapper });
    await act(() =>
      expect(
        result.current.mutateAsync({ id: 1, comment: { authorName: "N", authorEmail: "nobody@x.com", bodyHtml: "<p>hi</p>" } }),
      ).rejects.toThrow(),
    );
    expect(api.addQuoteComment).not.toHaveBeenCalled();
  });

  it("an edit emails only the NEWLY mentioned", async () => {
    const { wrapper } = await primed(VIEWER);
    const { result } = renderHook(() => useEditQuoteComment(), { wrapper });
    const quote = (await api.listQuotes()).find((q) => q.id === 1)!;
    const target = { timestamp: quote.comments[0].timestamp, authorEmail: quote.comments[0].authorEmail };
    const old = mention("Katie Fleming", "katie.fleming@altronic-llc.com");
    await act(() =>
      result.current.mutateAsync({
        id: 1,
        target,
        previousBodyHtml: old,
        bodyHtml: old + mention("Amanda Hoagland", "amanda.hoagland@altronic-llc.com"),
      }),
    );
    expect(api.editQuoteComment).toHaveBeenCalledTimes(1);
    const sent = email.notifyMentions.mock.calls[0][0] as unknown as { recipients: { email: string }[] };
    expect(sent.recipients.map((r) => r.email)).toEqual(["amanda.hoagland@altronic-llc.com"]);
  });

  it("a viewer can set watchers", async () => {
    const { wrapper } = await primed(VIEWER);
    const { result } = renderHook(() => useSetQuoteWatchers(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ id: 1, people: [{ displayName: "B", email: "brandon.mirto@altronic-llc.com" }] }),
    );
    expect(api.setQuoteWatchers).toHaveBeenCalledTimes(1);
  });
});

describe("revisions and links", () => {
  it("refuses a viewer's new rev BEFORE any write", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteRevision(), { wrapper });
    await act(() => expect(result.current.mutateAsync(2)).rejects.toThrow());
    expect(revApi.createQuoteRevision).not.toHaveBeenCalled();
  });

  it("lets a quoter make a new rev, seeds it, and toasts any warnings", async () => {
    who.emails = QUOTER;
    vi.mocked(revApi.createQuoteRevision).mockImplementationOnce(async (id) => {
      const real = await vi.importActual<typeof import("@/api/quoteRevisions")>("@/api/quoteRevisions");
      const out = await real.createQuoteRevision(id);
      return { ...out, warnings: ["One attachment didn't copy."] };
    });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteRevision(), { wrapper });
    const { quote } = await act(() => result.current.mutateAsync(2));
    expect(quote.quoteNumber).toBe("IQ-COO-0001-R3");
    expect(qc.getQueryData<Quote[]>(QUOTES_KEY)?.some((q) => q.id === quote.id)).toBe(true);
    expect(pushToast).toHaveBeenCalledWith({ message: "One attachment didn't copy.", variant: "error" });
  });

  it("refuses a viewer's task link BEFORE any write; a quoter may set one", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useSetQuoteLinks(), { wrapper });
    const links = { engineeringTaskLink: { url: "https://x/task/1", description: "T1" } };
    await act(() => expect(result.current.mutateAsync({ id: 1, links })).rejects.toThrow());
    expect(api.setQuoteLinks).not.toHaveBeenCalled();

    who.emails = QUOTER;
    const s2 = setup();
    const { result: r2 } = renderHook(() => useSetQuoteLinks(), { wrapper: s2.wrapper });
    await act(() => r2.current.mutateAsync({ id: 1, links }));
    expect(api.setQuoteLinks).toHaveBeenCalledWith(1, links);
  });
});
