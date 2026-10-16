import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetPricingMockStores, pricingMockClone, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// Customer Quotes hooks, in mock mode: MANAGERS AND ADMINS ONLY. Every write
// asks priceGate inside its mutationFn, so a requester reaches nothing — the
// API is wrapped in call-through spies to prove it.
// =============================================================================

const who = vi.hoisted(() => ({
  person: { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 3 },
}));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => who.person,
  useCurrentUserEmails: () => (who.person.email ? [who.person.email] : []),
}));
vi.mock("@/api/email", () => ({
  notifyChangeEmails: vi.fn(async () => ({ sent: 0, failed: [] })),
  notifyMentions: vi.fn(async () => ({ sent: 0, failed: [] })),
}));
vi.mock("@/api/customerQuotes", async (orig) => {
  const a = await orig<typeof import("@/api/customerQuotes")>();
  return {
    ...a,
    createCustomerQuote: vi.fn(a.createCustomerQuote),
    updateCustomerQuote: vi.fn(a.updateCustomerQuote),
    createCustomerQuoteRevision: vi.fn(a.createCustomerQuoteRevision),
    setCustomerQuoteWatchers: vi.fn(a.setCustomerQuoteWatchers),
    addCustomerQuoteComment: vi.fn(a.addCustomerQuoteComment),
    editCustomerQuoteComment: vi.fn(a.editCustomerQuoteComment),
  };
});

import * as api from "@/api/customerQuotes";
import {
  useAddCustomerQuoteComment,
  useCreateCustomerQuote,
  useCreateCustomerQuoteRevision,
  useEditCustomerQuoteComment,
  useSetCustomerQuoteWatchers,
  useUpdateCustomerQuote,
} from "./useCustomerQuotes";
import { EMPTY_CUSTOMER } from "@/lib/customerQuotes";

const REQUESTER = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 3 };
const MANAGER = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com", lookupId: 2 };
const REFUSED = /managers and admins/;

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const quote = () => pricingMockClone(pricingMockDb.quotes[0]);

beforeEach(() => {
  __resetPricingMockStores();
  who.person = REQUESTER;
  for (const fn of Object.values(api)) if (vi.isMockFunction(fn)) fn.mockClear();
});

describe("every Customer Quote write is refused for a requester", () => {
  // [label, render the hook, call it, the API function that must not be reached]
  type Case = [string, () => { mutateAsync: (v: never) => Promise<unknown> }, () => unknown, keyof typeof api];
  const cases: Case[] = [
    ["create", useCreateCustomerQuote, () => ({ validityDays: 30, customer: { ...EMPTY_CUSTOMER }, lines: [], notes: "" }), "createCustomerQuote"],
    ["update", useUpdateCustomerQuote, () => ({ id: quote().id, patch: { notes: "x" } }), "updateCustomerQuote"],
    ["new revision", useCreateCustomerQuoteRevision, () => quote(), "createCustomerQuoteRevision"],
    ["watchers", useSetCustomerQuoteWatchers, () => ({ id: quote().id, people: [REQUESTER] }), "setCustomerQuoteWatchers"],
    [
      "comment",
      useAddCustomerQuoteComment,
      () => ({ id: quote().id, comment: { authorName: "Katie", authorEmail: REQUESTER.email, bodyHtml: "<p>hi</p>" } }),
      "addCustomerQuoteComment",
    ],
    [
      "edit comment",
      useEditCustomerQuoteComment,
      () => ({
        id: quote().id,
        target: { timestamp: new Date(), authorEmail: REQUESTER.email },
        bodyHtml: "<p>b</p>",
        previousBodyHtml: "<p>a</p>",
      }),
      "editCustomerQuoteComment",
    ],
  ];

  it.each(cases)("%s", async (_label, useHook, args, apiFn) => {
    const before = pricingMockClone(pricingMockDb.quotes);
    const { wrapper } = setup();
    const { result } = renderHook(() => useHook(), { wrapper });
    await act(() => expect(result.current.mutateAsync(args() as never)).rejects.toThrow(REFUSED));
    expect(api[apiFn]).not.toHaveBeenCalled();
    expect(pricingMockDb.quotes).toEqual(before);
  });
});

describe("a manager may write", () => {
  it("creates a quote at R1 and a new revision as a new row", async () => {
    who.person = MANAGER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateCustomerQuote(), { wrapper });
    const created = await act(() =>
      result.current.mutateAsync({ validityDays: 30, customer: { ...EMPTY_CUSTOMER, name: "Acme" }, lines: [], notes: "" }),
    );
    expect(created.rev).toBe(1);
    expect(created.quoteNumber).toMatch(/^SQ-\d{4}-\d{4}-R1$/);

    const rev = renderHook(() => useCreateCustomerQuoteRevision(), { wrapper });
    const r2 = await act(() => rev.result.current.mutateAsync(created));
    expect(r2.id).not.toBe(created.id);
    expect(r2.quoteBase).toBe(created.quoteBase);
    expect(r2.rev).toBe(2);
    expect(pricingMockDb.quotes.find((q) => q.id === created.id)?.rev).toBe(1);
  });
});
