import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));
vi.mock("@/api/quoteCustomers", async (orig) => {
  const a = await orig<typeof import("@/api/quoteCustomers")>();
  return {
    ...a,
    createQuoteCustomer: vi.fn(a.createQuoteCustomer),
    updateQuoteCustomer: vi.fn(a.updateQuoteCustomer),
  };
});

import * as api from "@/api/quoteCustomers";
import { QuoteCustomerCodeTakenError } from "@/api/quoteCustomers";
import { useCreateQuoteCustomer, useQuoteCustomers, useUpdateQuoteCustomer } from "./useQuoteCustomers";

const MANAGER = ["demo.user@altronic-llc.com"];
const QUOTER = ["katie.fleming@altronic-llc.com"];

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const NEW = { name: "Acme Compression", code: "ACM", customerNumber: "0009001", note: "" };

beforeEach(() => {
  __resetQuoteMockStores();
  who.emails = MANAGER;
  vi.mocked(api.createQuoteCustomer).mockClear();
  vi.mocked(api.updateQuoteCustomer).mockClear();
});

describe("useQuoteCustomers", () => {
  it("lists every customer, retired ones included", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useQuoteCustomers(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.some((c) => !c.active)).toBe(true);
  });
});

describe("customer writes — quote manager only", () => {
  it("refuses a quoter's create BEFORE any write", async () => {
    who.emails = QUOTER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteCustomer(), { wrapper });
    await act(() => expect(result.current.mutateAsync(NEW)).rejects.toThrow(/quote manager/));
    expect(api.createQuoteCustomer).not.toHaveBeenCalled();
  });

  it("lets a manager create, and seeds the cache", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteCustomer(), { wrapper });
    const created = await act(() => result.current.mutateAsync(NEW));
    expect(created.code).toBe("ACM");
    expect(qc.getQueryData<{ id: number }[]>(["quote-customers", "list"])?.some((c) => c.id === created.id)).toBe(
      true,
    );
  });

  it("surfaces QuoteCustomerCodeTakenError UNCHANGED, so the form can re-propose", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteCustomer(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ ...NEW, code: "COO" })).rejects.toBeInstanceOf(QuoteCustomerCodeTakenError),
    );
  });

  it("refuses a quoter's edit BEFORE any write; a manager's edit is diffed against the cached row", async () => {
    who.emails = QUOTER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateQuoteCustomer(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: 1, patch: { note: "x" } })).rejects.toThrow());
    expect(api.updateQuoteCustomer).not.toHaveBeenCalled();

    who.emails = MANAGER;
    const second = setup();
    const { result: r2 } = renderHook(() => useUpdateQuoteCustomer(), { wrapper: second.wrapper });
    const updated = await act(() => r2.current.mutateAsync({ id: 1, patch: { active: false } }));
    expect(updated.active).toBe(false);
    const [id, patch, previous] = vi.mocked(api.updateQuoteCustomer).mock.calls[0];
    expect(id).toBe(1);
    expect(patch).toEqual({ active: false });
    expect(previous.active).toBe(true);
  });
});
