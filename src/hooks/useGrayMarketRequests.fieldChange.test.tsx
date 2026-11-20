import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GrayMarketRequest } from "@/types/task";

// =============================================================================
// BusinessIT#20 wiring: a field save compares the row BEFORE the optimistic
// patch with the row SharePoint returns, and alerts only on a watched change.
// =============================================================================

const fireGrayMarketFieldChangeAlert = vi.hoisted(() => vi.fn());
const updateGrayMarketFields = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireGrayMarketFieldChangeAlert,
  fireNewGrayMarketRequestAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/api/grayMarketRequests", () => ({
  updateGrayMarketFields,
  listGrayMarketRequests: vi.fn(async () => []),
  addGrayMarketComment: vi.fn(),
  createGrayMarketRequest: vi.fn(),
  editGrayMarketComment: vi.fn(),
  setGrayMarketWatchers: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

import { GRAY_MARKET_KEY, useUpdateGrayMarketFields } from "./useGrayMarketRequests";

const watcher = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" };

function row(over: Partial<GrayMarketRequest> = {}): GrayMarketRequest {
  return {
    id: 7,
    title: "1000-1234-00",
    logNo: "GMR_2026-007",
    status: "Open",
    requestDate: null,
    testingRequired: "No",
    requestor: null,
    partsLocation: null,
    watchers: [watcher],
    comments: [],
    hasAttachments: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    values: {},
    ...over,
  } as GrayMarketRequest;
}

async function save(before: GrayMarketRequest, after: GrayMarketRequest) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(GRAY_MARKET_KEY, [before]);
  updateGrayMarketFields.mockResolvedValue(after);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUpdateGrayMarketFields(), { wrapper });
  // The optimistic patch already shows the new value, so the hook must compare
  // against what was there BEFORE it — a patch returning `after` proves that.
  await act(() => result.current.mutateAsync({ id: 7, fields: {}, patch: () => after }));
}

beforeEach(() => {
  fireGrayMarketFieldChangeAlert.mockClear();
  updateGrayMarketFields.mockReset();
});

describe("saving gray market fields", () => {
  it("alerts on a Testing Required change, with the watchers and the actor", async () => {
    await save(row(), row({ testingRequired: "Yes" }));
    expect(fireGrayMarketFieldChangeAlert).toHaveBeenCalledTimes(1);
    const arg = fireGrayMarketFieldChangeAlert.mock.calls[0][0];
    expect(arg.changes).toEqual([{ label: "Testing Required", from: "No", to: "Yes" }]);
    expect(arg.watchers).toEqual([watcher]);
    expect(arg.actor.email).toBe("ray.white@altronic-llc.com");
    expect(arg.target).toMatchObject({ kind: "grayMarketRequest", id: 7 });
  });

  it("stays quiet when the value did not actually change", async () => {
    await save(row({ testingRequired: "Yes" }), row({ testingRequired: "Yes" }));
    expect(fireGrayMarketFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("stays quiet for a field outside the watched cards", async () => {
    await save(row(), row({ values: { vendor: "Acme" } }));
    expect(fireGrayMarketFieldChangeAlert).not.toHaveBeenCalled();
  });
});
