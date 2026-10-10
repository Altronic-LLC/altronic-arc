import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { priceQuoteAssembly } from "@/lib/quotePricing";
import type { QuoteItem } from "@/types/quote";

const who = vi.hoisted(() => ({ emails: ["katie.fleming@altronic-llc.com"] as string[] }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));
vi.mock("@/api/quoteItems", async (orig) => {
  const a = await orig<typeof import("@/api/quoteItems")>();
  return {
    ...a,
    createQuoteItem: vi.fn(a.createQuoteItem),
    updateQuoteItemFields: vi.fn(a.updateQuoteItemFields),
    deleteQuoteItem: vi.fn(a.deleteQuoteItem),
    setQuoteItemWatchers: vi.fn(a.setQuoteItemWatchers),
    addQuoteItemComment: vi.fn(a.addQuoteItemComment),
    editQuoteItemComment: vi.fn(a.editQuoteItemComment),
  };
});
vi.mock("@/api/quoteAssemblies", async (orig) => {
  const a = await orig<typeof import("@/api/quoteAssemblies")>();
  return { ...a, updateQuoteAssemblyFields: vi.fn(a.updateQuoteAssemblyFields) };
});
const email = vi.hoisted(() => ({ notifyMentions: vi.fn(async (_input: unknown) => ({ sent: [] as string[], failed: [] })) }));
vi.mock("@/api/email", () => email);
vi.mock("@/api/operationsTasks", () => ({ resolvePmoSiteUserLookupId: vi.fn(async () => 501) }));
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast }));

import * as api from "@/api/quoteItems";
import * as asmApi from "@/api/quoteAssemblies";
import { syncAssemblyCustomerPrice } from "./useQuoteAssemblies";
import { QUOTES_KEY } from "./useQuotes";
import {
  QUOTE_ITEMS_KEY,
  useAddQuoteItemComment,
  useCreateQuoteItem,
  useDeleteQuoteItem,
  useEditQuoteItemComment,
  useQuoteItems,
  useSetQuoteItemWatchers,
  useUpdateQuoteItem,
} from "./useQuoteItems";

const QUOTER = ["katie.fleming@altronic-llc.com"];
const VIEWER = ["brandon.mirto@altronic-llc.com"];

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

async function primed(as: string[]) {
  who.emails = as;
  const s = setup();
  await s.qc.fetchQuery({ queryKey: QUOTE_ITEMS_KEY, queryFn: api.listQuoteItems });
  await s.qc.fetchQuery({ queryKey: QUOTES_KEY, queryFn: (await import("@/api/quotes")).listQuotes });
  return s;
}

/** Make assembly 2's stored price match its components, so a sync that changes nothing is visible. */
function settleAssembly2() {
  const a = quoteMockDb.assemblies.find((x) => x.id === 2)!;
  a.customerPrice = priceQuoteAssembly(a, quoteMockDb.items).price;
}

const NEW = {
  quoteId: 1,
  assemblyId: 2,
  lineNo: 3,
  altronicPartNumber: "693005-BOOT",
  sapPartNumber: "",
  description: "Boot",
  quantity: 1,
  cost: 4,
  materialOverheadPct: null,
};

beforeEach(() => {
  __resetQuoteMockStores();
  who.emails = QUOTER;
  for (const fn of [
    api.createQuoteItem,
    api.updateQuoteItemFields,
    api.deleteQuoteItem,
    api.setQuoteItemWatchers,
    api.addQuoteItemComment,
    api.editQuoteItemComment,
    asmApi.updateQuoteAssemblyFields,
  ]) {
    vi.mocked(fn).mockClear();
  }
  email.notifyMentions.mockClear();
  pushToast.mockClear();
});

describe("useQuoteItems", () => {
  it("scopes the one cached list to a quote", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useQuoteItems(1), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.every((i) => i.quoteId === 1)).toBe(true);
    expect(result.current.data!.length).toBeGreaterThan(0);
  });
});

describe("gates — editQuoteGate inside the mutationFn", () => {
  it("refuses a viewer's create, update and delete BEFORE any write", async () => {
    const { wrapper } = await primed(VIEWER);
    const { result } = renderHook(
      () => ({ create: useCreateQuoteItem(), update: useUpdateQuoteItem(), del: useDeleteQuoteItem() }),
      { wrapper },
    );
    await act(() => expect(result.current.create.mutateAsync(NEW)).rejects.toThrow(/quoters and quote managers/));
    await act(() => expect(result.current.update.mutateAsync({ id: 5, patch: { cost: 1 } })).rejects.toThrow());
    await act(() => expect(result.current.del.mutateAsync(5)).rejects.toThrow());
    expect(api.createQuoteItem).not.toHaveBeenCalled();
    expect(api.updateQuoteItemFields).not.toHaveBeenCalled();
    expect(api.deleteQuoteItem).not.toHaveBeenCalled();
  });

  it("a quoter's new component is watched by its creator and re-prices its assembly", async () => {
    settleAssembly2();
    const { wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useCreateQuoteItem(), { wrapper });
    await act(() => result.current.mutateAsync(NEW));
    const sent = vi.mocked(api.createQuoteItem).mock.calls[0][0];
    expect(sent.watchers?.map((p) => p.email)).toContain("katie.fleming@altronic-llc.com");
    expect(vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls[0][0]).toBe(2);
  });
});

describe("a Part line has no components", () => {
  it("refuses a component added to a Part line, before any write", async () => {
    const { wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useCreateQuoteItem(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ ...NEW, quoteId: 3, assemblyId: 7 })).rejects.toThrow(/Part line has no components/),
    );
    expect(api.createQuoteItem).not.toHaveBeenCalled();
  });
});

describe("price sync", () => {
  it("PATCHes the assembly's CustomerPrice when a component's cost changes", async () => {
    settleAssembly2();
    const { wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useUpdateQuoteItem(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 5, patch: { cost: 40 } }));
    const a = quoteMockDb.assemblies.find((x) => x.id === 2)!;
    const expected = priceQuoteAssembly(a, quoteMockDb.items).price;
    expect(asmApi.updateQuoteAssemblyFields).toHaveBeenCalledTimes(1);
    const [id, patch] = vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls[0];
    expect(id).toBe(2);
    expect(patch).toEqual({ customerPrice: expected });
    expect(a.customerPrice).toBe(expected);
  });

  it("does NOT patch the assembly when the change doesn't move the price", async () => {
    settleAssembly2();
    const { wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useUpdateQuoteItem(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 5, patch: { description: "Renamed" } }));
    expect(api.updateQuoteItemFields).toHaveBeenCalledTimes(1);
    expect(asmApi.updateQuoteAssemblyFields).not.toHaveBeenCalled();
  });

  it("the component edit is diffed against the PRE-patch row", async () => {
    const { wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useUpdateQuoteItem(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 5, patch: { cost: 40 } }));
    expect(vi.mocked(api.updateQuoteItemFields).mock.calls[0][2].cost).toBe(31.2);
  });

  it("a failed sync does not make the component write look failed", async () => {
    settleAssembly2();
    vi.mocked(asmApi.updateQuoteAssemblyFields).mockRejectedValueOnce(new Error("Graph 503"));
    const { qc, wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useUpdateQuoteItem(), { wrapper });
    const updated = await act(() => result.current.mutateAsync({ id: 5, patch: { cost: 40 } }));
    expect(updated.cost).toBe(40);
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(await syncAssemblyCustomerPrice(qc, 2)).toBe(true); // the next sync corrects it
  });

  it("deleting a component re-prices its assembly", async () => {
    settleAssembly2();
    const { qc, wrapper } = await primed(QUOTER);
    const { result } = renderHook(() => useDeleteQuoteItem(), { wrapper });
    await act(() => result.current.mutateAsync(6));
    expect(qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY)?.some((i) => i.id === 6)).toBe(false);
    expect(vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls[0][0]).toBe(2);
  });
});

describe("component comments and watchers — open to a viewer", () => {
  const mention = (name: string, address: string) =>
    `<p><span class="mention" data-email="${address}">@${name}</span> see this</p>`;

  it("a viewer can comment; the component's watchers are emailed, linked to its quote", async () => {
    const { qc, wrapper } = await primed(VIEWER);
    const { result } = renderHook(() => useAddQuoteItemComment(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        id: 6,
        comment: {
          authorName: "Brandon Mirto",
          authorEmail: "brandon.mirto@altronic-llc.com",
          bodyHtml: mention("Katie Fleming", "katie.fleming@altronic-llc.com"),
        },
      }),
    );
    expect(api.addQuoteItemComment).toHaveBeenCalledTimes(1);
    const sent = email.notifyMentions.mock.calls[0][0] as unknown as {
      recipients: { email: string }[];
      target: { kind: string; id: number; title: string };
    };
    expect(sent.target).toMatchObject({ kind: "quote", id: 1 });
    expect(sent.target.title).toMatch(/IQ-COO-0001-R1.*693005-CONN/);
    const to = sent.recipients.map((r) => r.email);
    expect(to).toContain("amanda.hoagland@altronic-llc.com"); // watching the component
    expect(to).toContain("katie.fleming@altronic-llc.com"); // mentioned
    await waitFor(() => expect(api.setQuoteItemWatchers).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        qc
          .getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY)
          ?.find((i) => i.id === 6)
          ?.watchers.some((w) => w.email === "katie.fleming@altronic-llc.com"),
      ).toBe(true),
    );
  });

  it("a viewer can edit a comment and set watchers", async () => {
    const { wrapper } = await primed(VIEWER);
    const { result } = renderHook(() => ({ edit: useEditQuoteItemComment(), watch: useSetQuoteItemWatchers() }), {
      wrapper,
    });
    const item = quoteMockDb.items.find((i) => i.id === 6)!;
    await act(() =>
      result.current.edit.mutateAsync({
        id: 6,
        target: { timestamp: item.comments[0].timestamp, authorEmail: item.comments[0].authorEmail },
        previousBodyHtml: item.comments[0].bodyHtml,
        bodyHtml: "<p>edited</p>",
      }),
    );
    expect(api.editQuoteItemComment).toHaveBeenCalledTimes(1);
    expect(email.notifyMentions).not.toHaveBeenCalled(); // nobody newly mentioned
    await act(() => result.current.watch.mutateAsync({ id: 6, people: [] }));
    expect(api.setQuoteItemWatchers).toHaveBeenCalledWith(6, []);
  });

  it("refuses somebody with no quote role BEFORE any write", async () => {
    const { wrapper } = await primed(["nobody@altronic-llc.com"]);
    const { result } = renderHook(() => useAddQuoteItemComment(), { wrapper });
    await act(() =>
      expect(
        result.current.mutateAsync({ id: 6, comment: { authorName: "N", authorEmail: "n@x.com", bodyHtml: "<p>x</p>" } }),
      ).rejects.toThrow(),
    );
    expect(api.addQuoteItemComment).not.toHaveBeenCalled();
  });
});
