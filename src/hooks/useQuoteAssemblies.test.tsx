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
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast }));

import * as asmApi from "@/api/quoteAssemblies";
import {
  QUOTE_ASSEMBLIES_KEY,
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
  quotedQty: 1,
  materialCost: 100,
  laborCost: 20,
  materialOverheadPct: 18,
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
  ]) {
    vi.mocked(fn).mockClear();
  }
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
  });

  it("lets a quoter create a line, and stores its computed price", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteAssembly(), { wrapper });
    const created = await act(() => result.current.mutateAsync(NEW));
    expect(created.altronicPartNumber).toBe("NEW-1");
    expect(asmApi.createQuoteAssembly).toHaveBeenCalledTimes(1);
    // 100 × 1.18 + 20 = 138 at 35% → 212.31.
    expect(qc.getQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY)?.find((a) => a.id === created.id)?.customerPrice).toBe(
      212.31,
    );
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
    // Line 2: 54 × 1.18 + 12 = 75.72; 35% → 116.49, 40% → 126.20.
    await act(() => result.current.mutateAsync({ id: 2, patch: { targetGM: 40 } }));
    const calls = vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls;
    expect(calls[0][1]).toEqual({ targetGM: 40 });
    expect(calls[1][1]).toEqual({ customerPrice: 126.2 });
  });

  it("a material, labor or overhead edit re-syncs CustomerPrice", async () => {
    const { qc, wrapper } = setup();
    await qc.fetchQuery({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: asmApi.listQuoteAssemblies });
    const { result } = renderHook(() => useUpdateQuoteAssembly(), { wrapper });
    // Line 7: 40 × 1.10 + 11 labor = 55 at 45% → 100.00.
    await act(() => result.current.mutateAsync({ id: 7, patch: { materialCost: 40, laborCost: 11 } }));
    const calls = vi.mocked(asmApi.updateQuoteAssemblyFields).mock.calls;
    expect(calls[0][1]).toEqual({ materialCost: 40, laborCost: 11 });
    expect(calls[1][1]).toEqual({ customerPrice: 100 });
  });

  it("syncAssemblyCustomerPrice writes nothing when the stored price already matches", async () => {
    const { qc } = setup();
    const a = quoteMockDb.assemblies.find((x) => x.id === 2)!;
    a.customerPrice = priceQuoteAssembly(a).price;
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

describe("useDeleteQuoteAssembly", () => {
  it("deletes the line and drops it from the cache", async () => {
    const { qc, wrapper } = setup();
    await qc.fetchQuery({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: asmApi.listQuoteAssemblies });
    const { result } = renderHook(() => useDeleteQuoteAssembly(), { wrapper });
    await act(() => result.current.mutateAsync(2));
    expect(asmApi.deleteQuoteAssembly).toHaveBeenCalledWith(2);
    expect(qc.getQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY)?.some((a) => a.id === 2)).toBe(false);
  });
});
