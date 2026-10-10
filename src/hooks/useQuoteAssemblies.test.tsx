import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { priceQuoteAssembly } from "@/lib/quotePricing";
import type { QuoteAssembly } from "@/types/quote";

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));
vi.mock("@/api/quoteAssemblies", async (orig) => {
  const a = await orig<typeof import("@/api/quoteAssemblies")>();
  return {
    ...a,
    createQuoteAssembly: vi.fn(a.createQuoteAssembly),
    updateQuoteAssemblyFields: vi.fn(a.updateQuoteAssemblyFields),
    deleteQuoteAssembly: vi.fn(a.deleteQuoteAssembly),
  };
});
vi.mock("@/api/quoteItems", async (orig) => {
  const a = await orig<typeof import("@/api/quoteItems")>();
  return { ...a, deleteQuoteItem: vi.fn(a.deleteQuoteItem) };
});
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast }));

import * as asmApi from "@/api/quoteAssemblies";
import * as itemApi from "@/api/quoteItems";
import {
  QUOTE_ASSEMBLIES_KEY,
  QuoteAssemblyDeleteError,
  QuoteLineTypeChangeError,
  syncAssemblyCustomerPrice,
  useCreateQuoteAssembly,
  useDeleteQuoteAssembly,
  useQuoteAssemblies,
  useUpdateQuoteAssembly,
} from "./useQuoteAssemblies";

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

const NEW = {
  quoteId: 4,
  lineNo: 9,
  lineType: "Assembly" as const,
  quotedQty: 1,
  cost: null,
  materialOverheadPct: null,
  altronicPartNumber: "NEW-1",
  sapPartNumber: "",
  customerPartNumber: "",
  description: "",
  priceBreaks: [],
  targetGM: 35,
  manualPrice: null,
  customerPrice: null,
};

beforeEach(() => {
  __resetQuoteMockStores();
  who.emails = QUOTER;
  for (const fn of [
    asmApi.createQuoteAssembly,
    asmApi.updateQuoteAssemblyFields,
    asmApi.deleteQuoteAssembly,
    itemApi.deleteQuoteItem,
  ]) {
    vi.mocked(fn).mockClear();
  }
  vi.mocked(itemApi.deleteQuoteItem).mockImplementation(
    async (id) => (await vi.importActual<typeof import("@/api/quoteItems")>("@/api/quoteItems")).deleteQuoteItem(id),
  );
  pushToast.mockClear();
});

describe("useQuoteAssemblies", () => {
  it("scopes the one cached list to a quote", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useQuoteAssemblies(1), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.map((a) => a.id)).toEqual([1, 2]);
  });
});

describe("gates — editQuoteGate inside the mutationFn", () => {
  it("refuses a viewer's create, update and delete BEFORE any write", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ create: useCreateQuoteAssembly(), update: useUpdateQuoteAssembly(), del: useDeleteQuoteAssembly() }),
      { wrapper },
    );
    await act(() => expect(result.current.create.mutateAsync(NEW)).rejects.toThrow(/quoters and quote managers/));
    await act(() => expect(result.current.update.mutateAsync({ id: 1, patch: { description: "x" } })).rejects.toThrow());
    await act(() => expect(result.current.del.mutateAsync(2)).rejects.toThrow());
    expect(asmApi.createQuoteAssembly).not.toHaveBeenCalled();
    expect(asmApi.updateQuoteAssemblyFields).not.toHaveBeenCalled();
    expect(asmApi.deleteQuoteAssembly).not.toHaveBeenCalled();
    expect(itemApi.deleteQuoteItem).not.toHaveBeenCalled();
  });

  it("lets a quoter create an assembly", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteAssembly(), { wrapper });
    const created = await act(() => result.current.mutateAsync(NEW));
    expect(created.altronicPartNumber).toBe("NEW-1");
    expect(asmApi.createQuoteAssembly).toHaveBeenCalledTimes(1);
  });
});

describe("price sync on assembly writes", () => {
  it("a manual price change re-syncs CustomerPrice; the edit is diffed against the pre-patch row", async () => {
    const { qc, wrapper } = setup();
    await qc.fetchQuery({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: asmApi.listQuoteAssemblies });
    const { result } = renderHook(() => useUpdateQuoteAssembly(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 2, patch: { manualPrice: 999.99 } }));
    const calls = vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls;
    expect(calls[0][1]).toEqual({ manualPrice: 999.99 });
    expect(calls[0][2].manualPrice).toBeNull();
    expect(calls[1][1]).toEqual({ customerPrice: 999.99 });
    expect(qc.getQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY)?.find((a) => a.id === 2)?.customerPrice).toBe(
      999.99,
    );
  });

  it("a TARGET GM change re-syncs CustomerPrice, exactly like a manual price", async () => {
    const { qc, wrapper } = setup();
    await qc.fetchQuery({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: asmApi.listQuoteAssemblies });
    const { result } = renderHook(() => useUpdateQuoteAssembly(), { wrapper });
    // Assembly 2: components cost 76.70; 35% → 118.00, 40% → 127.83.
    await act(() => result.current.mutateAsync({ id: 2, patch: { targetGM: 40 } }));
    const calls = vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls;
    expect(calls[0][1]).toEqual({ targetGM: 40 });
    expect(calls[1][1]).toEqual({ customerPrice: 127.83 });
  });

  it("a Part line's cost edit re-syncs CustomerPrice", async () => {
    const { qc, wrapper } = setup();
    await qc.fetchQuery({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: asmApi.listQuoteAssemblies });
    const { result } = renderHook(() => useUpdateQuoteAssembly(), { wrapper });
    // Part 7: 40 + 10% = 44 loaded; at 45% → 80.00.
    await act(() => result.current.mutateAsync({ id: 7, patch: { cost: 40 } }));
    const calls = vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls;
    expect(calls[1][1]).toEqual({ customerPrice: 80 });
  });

  it("syncAssemblyCustomerPrice writes nothing when the stored price already matches", async () => {
    const { qc } = setup();
    const a = quoteMockDb.assemblies.find((x) => x.id === 2)!;
    a.customerPrice = priceQuoteAssembly(a, quoteMockDb.items).price;
    expect(await syncAssemblyCustomerPrice(qc, 2)).toBe(false);
    expect(asmApi.updateQuoteAssemblyFields).not.toHaveBeenCalled();
  });

  it("a failed sync resolves false and warns, never throws", async () => {
    const { qc } = setup();
    quoteMockDb.assemblies.find((x) => x.id === 2)!.customerPrice = 1;
    vi.mocked(asmApi.updateQuoteAssemblyFields).mockRejectedValueOnce(new Error("Graph 503"));
    expect(await syncAssemblyCustomerPrice(qc, 2)).toBe(false);
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});

describe("line type changes", () => {
  it("REFUSES Assembly → Part while the line has components, and writes nothing", async () => {
    const { qc, wrapper } = setup();
    await qc.fetchQuery({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: asmApi.listQuoteAssemblies });
    const { result } = renderHook(() => useUpdateQuoteAssembly(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 2, patch: { lineType: "Part" } })).rejects.toBeInstanceOf(
        QuoteLineTypeChangeError,
      ),
    );
    expect(asmApi.updateQuoteAssemblyFields).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/2 components.*Delete them/) }),
    );
    expect(qc.getQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY)?.find((a) => a.id === 2)?.lineType).toBe(
      "Assembly",
    );
  });

  it("allows Assembly → Part with no components", async () => {
    const { qc, wrapper } = setup();
    await qc.fetchQuery({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: asmApi.listQuoteAssemblies });
    const create = renderHook(() => useCreateQuoteAssembly(), { wrapper });
    const created = await act(() => create.result.current.mutateAsync(NEW));
    const { result } = renderHook(() => useUpdateQuoteAssembly(), { wrapper });
    const updated = await act(() =>
      result.current.mutateAsync({ id: created.id, patch: { lineType: "Part", cost: 10 } }),
    );
    expect(updated.lineType).toBe("Part");
  });

  it("Part → Assembly clears the line's own cost and overhead in the SAME write", async () => {
    const { qc, wrapper } = setup();
    await qc.fetchQuery({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: asmApi.listQuoteAssemblies });
    const { result } = renderHook(() => useUpdateQuoteAssembly(), { wrapper });
    const updated = await act(() => result.current.mutateAsync({ id: 7, patch: { lineType: "Assembly" } }));
    expect(vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls[0][1]).toEqual({
      lineType: "Assembly",
      cost: null,
      materialOverheadPct: null,
    });
    expect(updated).toMatchObject({ lineType: "Assembly", cost: null, materialOverheadPct: null });
  });
});

describe("useDeleteQuoteAssembly", () => {
  it("deletes the assembly's components FIRST, then the assembly", async () => {
    const order: string[] = [];
    vi.mocked(itemApi.deleteQuoteItem).mockImplementation(async (id) => void order.push(`item ${id}`));
    vi.mocked(asmApi.deleteQuoteAssembly).mockImplementationOnce(async (id) => void order.push(`assembly ${id}`));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeleteQuoteAssembly(), { wrapper });
    await act(() => result.current.mutateAsync(2));
    expect(order).toEqual(["item 5", "item 6", "assembly 2"]);
  });

  it("keeps the assembly, and names the component, when one component delete fails", async () => {
    vi.mocked(itemApi.deleteQuoteItem).mockImplementation(async (id) => {
      if (id === 6) throw new Error("Graph 403");
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeleteQuoteAssembly(), { wrapper });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(2);
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(QuoteAssemblyDeleteError);
    expect((caught as Error).message).toMatch(/693005-CONN/);
    expect((caught as QuoteAssemblyDeleteError).deletedItemIds).toEqual([5]);
    expect(asmApi.deleteQuoteAssembly).not.toHaveBeenCalled();
  });
});
