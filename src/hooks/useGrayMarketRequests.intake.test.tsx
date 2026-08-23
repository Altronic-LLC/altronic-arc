import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Every new gray market request tells the intake list (Ray, 2026-08-23).
// Nothing watches the SharePoint list itself, so without this a raised request
// sits until somebody opens ARC and notices it.
// =============================================================================

const fireNewGrayMarketRequestAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireNewGrayMarketRequestAlert,
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

import { useCreateGrayMarketRequest } from "./useGrayMarketRequests";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fireNewGrayMarketRequestAlert.mockClear();
});

function firedWith() {
  return fireNewGrayMarketRequestAlert.mock.calls[0]?.[0] as
    | {
        target: { kind: string; id: number; title: string };
        actor: { displayName: string };
        details?: Array<{ label: string; value: string }>;
      }
    | undefined;
}

async function raise(input: Partial<Parameters<
  ReturnType<typeof useCreateGrayMarketRequest>["mutateAsync"]
>[0]> = {}) {
  const { result } = renderHook(() => useCreateGrayMarketRequest(), { wrapper: wrapper() });
  await act(async () => {
    await result.current.mutateAsync({
      title: "1000-1234-00",
      status: "Open",
      requestDate: new Date("2026-08-23T12:00:00Z"),
      testingRequired: "",
      requestor: null,
      values: {},
      ...input,
    });
  });
  await waitFor(() => expect(fireNewGrayMarketRequestAlert).toHaveBeenCalledTimes(1));
}

describe("raising a gray market request", () => {
  it("alerts the intake list", async () => {
    await raise();
    expect(firedWith()?.target.kind).toBe("grayMarketRequest");
  });

  it("links the email to the request that was just created", async () => {
    await raise();
    const target = firedWith()!.target;
    expect(target.id).toBeGreaterThan(0);
    expect(target.title).toBeTruthy();
  });

  it("names the requestor as the actor, so they're left off their own alert", async () => {
    await raise();
    expect(firedWith()?.actor.displayName).toBe("Ray White");
  });

  it("carries the purchasing details that were filled in", async () => {
    await raise({ values: { vendor: "AERI", poNo: "PO-4417" } });
    const details = firedWith()?.details ?? [];
    expect(details).toEqual(
      expect.arrayContaining([
        { label: "Vendor", value: "AERI" },
        { label: "PO no.", value: "PO-4417" },
      ]),
    );
  });

  // Testing Required is decided later in the workflow, so a request raised
  // without it still has to reach the intake list.
  it("still alerts when Testing Required hasn't been decided", async () => {
    await raise({ testingRequired: "" });
    const details = firedWith()?.details ?? [];
    expect(details).toEqual(
      expect.arrayContaining([{ label: "Testing required", value: "" }]),
    );
  });

  it("carries Testing Required once it has been answered", async () => {
    await raise({ testingRequired: "Yes" });
    const details = firedWith()?.details ?? [];
    expect(details).toEqual(
      expect.arrayContaining([{ label: "Testing required", value: "Yes" }]),
    );
  });
});
