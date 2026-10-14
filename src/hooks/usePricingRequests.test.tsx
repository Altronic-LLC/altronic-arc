import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetPricingMockStores, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// Pricing Requests hooks, in mock mode. Who is signed in is a hoisted variable:
//   demo.user — pricing admin, brandon.mirto — manager, katie.fleming — requester.
// The API modules are wrapped in call-through spies, so a refused write can be
// shown to have reached NOTHING, and the History-before-request order checked.
// =============================================================================

const PEOPLE = {
  admin: { displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 1 },
  manager: { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com", lookupId: 2 },
  requester: { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 3 },
};
const who = vi.hoisted(() => ({ person: { displayName: "", email: "", lookupId: 0 } }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => who.person,
  useCurrentUserEmails: () => (who.person.email ? [who.person.email] : []),
}));

vi.mock("@/api/email", () => ({
  notifyChangeEmails: vi.fn(async () => ({ sent: 0, failed: [] })),
  notifyMentions: vi.fn(async () => ({ sent: 0, failed: [] })),
}));

vi.mock("@/api/pricingRequests", async (orig) => {
  const a = await orig<typeof import("@/api/pricingRequests")>();
  return {
    ...a,
    createPricingRequest: vi.fn(a.createPricingRequest),
    updatePricingRequest: vi.fn(a.updatePricingRequest),
  };
});
vi.mock("@/api/pricingHistory", async (orig) => {
  const a = await orig<typeof import("@/api/pricingHistory")>();
  return { ...a, recordPricing: vi.fn(a.recordPricing) };
});

import * as requestsApi from "@/api/pricingRequests";
import * as historyApi from "@/api/pricingHistory";
import { notifyChangeEmails } from "@/api/email";
import {
  routeNewRequest,
  useCreatePricingRequest,
  useMarkAddedToSap,
  usePriceRequest,
  useReopenPricingRequest,
  type PriceRequestVars,
  type PricingRequestFormInput,
} from "./usePricingRequests";
import type { SapPart } from "@/types/pricing";

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function form(overrides: Partial<PricingRequestFormInput> = {}): PricingRequestFormInput {
  return {
    altronicPartNumber: "791950-08",
    sapPartNumber: "",
    description: "typed description",
    requestedBy: PEOPLE.requester,
    notes: "",
    customerSoldTo: "",
    customerName: "",
    customerGroup: "",
    ...overrides,
  };
}

const ENTRY: PriceRequestVars["entry"] = {
  cost: 1180,
  costSource: "SAP",
  distributorDiscountPct: 36,
  discountSource: "SAP",
  input: { kind: "list", value: 3600 },
  listPrice: 3600,
  baseGM: 48.8,
  customerGroup: "",
  customerDiscountPct: null,
  customerPrice: null,
  customerGM: null,
  mpg: null,
  family: null,
  note: "test",
};

/** Run a mutation that must be REFUSED, inside act (the rejection asserted in it). */
async function expectRefused(run: () => Promise<unknown>, message: RegExp) {
  await act(() => expect(run()).rejects.toThrow(message));
}

beforeEach(() => {
  __resetPricingMockStores();
  who.person = PEOPLE.admin;
  vi.mocked(requestsApi.createPricingRequest).mockClear();
  vi.mocked(requestsApi.updatePricingRequest).mockClear();
  vi.mocked(historyApi.recordPricing).mockClear();
  vi.mocked(notifyChangeEmails).mockClear();
});

describe("routeNewRequest", () => {
  const part: SapPart = {
    altronicPartNumber: "791950-08",
    sapPartNumber: "1003-0114-08",
    description: "CPU-95",
    mpg: "IGN",
    listPrice: 1,
    cost: 1,
  };

  it("a part SAP has is in SAP, with SAP's number, description and MPG", () => {
    expect(routeNewRequest({ altronicPartNumber: "", sapPartNumber: "", description: "typed" }, { part, notConnected: false })).toEqual({
      inSap: true,
      altronicPartNumber: "791950-08",
      sapPartNumber: "1003-0114-08",
      description: "CPU-95",
      mpg: "IGN",
    });
  });

  it("only the SAP # known: the Altronic (old) number is pulled in from SAP", () => {
    const r = routeNewRequest({ altronicPartNumber: "", sapPartNumber: "1003-0114-08", description: "" }, { part, notConnected: false });
    expect(r.altronicPartNumber).toBe("791950-08");
  });

  it("an Altronic # that was typed is kept, never replaced by SAP's", () => {
    const r = routeNewRequest({ altronicPartNumber: "791950-8", sapPartNumber: "", description: "" }, { part, notConnected: false });
    expect(r.altronicPartNumber).toBe("791950-8");
  });
  it("not connected: a typed SAP # counts as in SAP", () => {
    const r = routeNewRequest({ altronicPartNumber: "", sapPartNumber: " 1003-0114-40 ", description: "typed" }, { part: null, notConnected: true });
    expect(r.inSap).toBe(true);
    expect(r.sapPartNumber).toBe("1003-0114-40");
  });

  it("not connected without a SAP # is NOT in SAP", () => {
    expect(routeNewRequest({ altronicPartNumber: "X", sapPartNumber: "  ", description: "t" }, { part: null, notConnected: true }).inSap).toBe(false);
  });

  it("connected and not found is NOT in SAP, even with a typed number", () => {
    expect(routeNewRequest({ altronicPartNumber: "X", sapPartNumber: "1003", description: "t" }, { part: null, notConnected: false }).inSap).toBe(false);
  });
});

describe("useCreatePricingRequest", () => {
  it("routes a part found in SAP to Submitted, with the SAP # and description filled in, and emails the managers", async () => {
    who.person = PEOPLE.requester;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreatePricingRequest(), { wrapper });
    const out = await act(() => result.current.mutateAsync(form()));
    expect(out.inSap).toBe(true);
    expect(out.created.status).toBe("Submitted");
    expect(out.created.sapPartNumber).toBe("1003-0114-08");
    expect(out.created.description).toBe("CPU-95 IGNITION MODULE, 8 CYL");
    expect(out.created.requestedDescription).toBe("typed description");
    expect(out.created.mpg).toBe("IGN");

    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    const sent = vi.mocked(notifyChangeEmails).mock.calls[0][0].emails.map((e) => e.email);
    expect(sent).toContain("brandon.mirto@altronic-llc.com");
    expect(sent).not.toContain("demo.user@altronic-llc.com"); // admins aren't the pricing queue
    expect(sent).toContain("katie.fleming@altronic-llc.com"); // the receipt
  });

  it("routes an unknown part to Awaiting SAP and emails the ADMINS to set it up", async () => {
    who.person = PEOPLE.requester;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreatePricingRequest(), { wrapper });
    const out = await act(() => result.current.mutateAsync(form({ altronicPartNumber: "999999-99", sapPartNumber: "" })));
    expect(out.inSap).toBe(false);
    expect(out.created.status).toBe("Awaiting SAP");
    expect(out.created.sapPartNumber).toBe("");
    expect(out.created.description).toBe("typed description");

    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    const emails = vi.mocked(notifyChangeEmails).mock.calls[0][0].emails;
    const queue = emails.filter((e) => /Set up in SAP/.test(e.subject)).map((e) => e.email);
    expect(queue).toEqual(["demo.user@altronic-llc.com"]);
    expect(emails.map((e) => e.email)).not.toContain("brandon.mirto@altronic-llc.com");
  });

  it("the admin raising an unknown part is still emailed — the queue never goes silent", async () => {
    who.person = PEOPLE.admin;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreatePricingRequest(), { wrapper });
    await act(() => result.current.mutateAsync(form({ altronicPartNumber: "999999-99", requestedBy: PEOPLE.admin })));
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    const queue = vi
      .mocked(notifyChangeEmails)
      .mock.calls[0][0].emails.filter((e) => /Set up in SAP/.test(e.subject))
      .map((e) => e.email);
    expect(queue).toEqual(["demo.user@altronic-llc.com"]);
  });

  it("refuses somebody with no pricing role", async () => {
    who.person = { displayName: "Nobody", email: "nobody@altronic-llc.com", lookupId: 9 };
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreatePricingRequest(), { wrapper });
    await expectRefused(() => result.current.mutateAsync(form()), /pricing role/);
    expect(requestsApi.createPricingRequest).not.toHaveBeenCalled();
  });
});

describe("workflow writes are gated inside the mutationFn", () => {
  it("a requester can't PRICE — nothing is written", async () => {
    who.person = PEOPLE.requester;
    const { wrapper } = setup();
    const { result } = renderHook(() => usePriceRequest(), { wrapper });
    await expectRefused(() => result.current.mutateAsync({ id: 3, entry: ENTRY }), /managers and admins/);
    expect(historyApi.recordPricing).not.toHaveBeenCalled();
    expect(requestsApi.updatePricingRequest).not.toHaveBeenCalled();
  });

  it("a requester can't press Added to SAP", async () => {
    who.person = PEOPLE.requester;
    const { wrapper } = setup();
    const { result } = renderHook(() => useMarkAddedToSap(), { wrapper });
    await expectRefused(() => result.current.mutateAsync({ id: 4, sapPartNumber: "" }), /pricing admin/);
    expect(requestsApi.updatePricingRequest).not.toHaveBeenCalled();
  });

  it("a MANAGER can't press Added to SAP — admin only", async () => {
    who.person = PEOPLE.manager;
    const { wrapper } = setup();
    const { result } = renderHook(() => useMarkAddedToSap(), { wrapper });
    await expectRefused(() => result.current.mutateAsync({ id: 4, sapPartNumber: "" }), /pricing admin/);
    expect(requestsApi.updatePricingRequest).not.toHaveBeenCalled();
    expect(pricingMockDb.requests.find((r) => r.id === 4)?.status).toBe("Awaiting SAP");
  });

  it("an admin's Added to SAP moves the request on to Submitted", async () => {
    who.person = PEOPLE.admin;
    const { wrapper } = setup();
    const { result } = renderHook(() => useMarkAddedToSap(), { wrapper });
    const updated = await act(() => result.current.mutateAsync({ id: 4, sapPartNumber: "" }));
    expect(updated.status).toBe("Submitted");
    expect(updated.addedToSapBy?.email).toBe("demo.user@altronic-llc.com");
  });

  it("a requester can't reopen a priced request", async () => {
    who.person = PEOPLE.requester;
    const { wrapper } = setup();
    const { result } = renderHook(() => useReopenPricingRequest(), { wrapper });
    await expectRefused(() => result.current.mutateAsync(1), /managers and admins/);
    expect(requestsApi.updatePricingRequest).not.toHaveBeenCalled();
    expect(pricingMockDb.requests.find((r) => r.id === 1)?.status).toBe("Priced");
  });

  it("a manager can reopen one", async () => {
    who.person = PEOPLE.manager;
    const { wrapper } = setup();
    const { result } = renderHook(() => useReopenPricingRequest(), { wrapper });
    const updated = await act(() => result.current.mutateAsync(1));
    expect(updated.status).toBe("In Review");
  });
});

describe("usePriceRequest", () => {
  it("writes History FIRST, then the request — Priced, with the list price and who priced it", async () => {
    who.person = PEOPLE.manager;
    const { wrapper } = setup();
    const { result } = renderHook(() => usePriceRequest(), { wrapper });
    const out = await act(() => result.current.mutateAsync({ id: 3, entry: ENTRY }));

    const recordOrder = vi.mocked(historyApi.recordPricing).mock.invocationCallOrder[0];
    const updateOrder = vi.mocked(requestsApi.updatePricingRequest).mock.invocationCallOrder[0];
    expect(recordOrder).toBeLessThan(updateOrder);

    expect(out.updated.status).toBe("Priced");
    expect(out.updated.listPrice).toBe(3600);
    expect(out.updated.pricedBy?.email).toBe("brandon.mirto@altronic-llc.com");
    expect(out.record.history.at(-1)?.pricedBy.email).toBe("brandon.mirto@altronic-llc.com");
    expect(out.record.history.at(-1)?.listPrice).toBe(3600);
    expect(pricingMockDb.requests.find((r) => r.id === 3)?.status).toBe("Priced");
  });

  it("refuses an Awaiting SAP request without writing History", async () => {
    who.person = PEOPLE.manager;
    const { wrapper } = setup();
    const { result } = renderHook(() => usePriceRequest(), { wrapper });
    await expectRefused(() => result.current.mutateAsync({ id: 4, entry: ENTRY }), /isn't in SAP/);
    expect(historyApi.recordPricing).not.toHaveBeenCalled();
  });
});
