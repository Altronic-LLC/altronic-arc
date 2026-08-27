import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Every new cost impact notice tells the fixed intake list (Ray, 2026-08-27).
// Nothing watches the SharePoint list itself, so without this a raised notice
// sits until somebody opens ARC and notices it.
// =============================================================================

const fireNewCostImpactNoticeAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireNewCostImpactNoticeAlert,
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

import { useCreateCostImpactNotice } from "./useCostImpactNotices";
import type { CostImpactNoticeInput } from "@/types/task";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fireNewCostImpactNoticeAlert.mockClear();
});

function firedWith() {
  return fireNewCostImpactNoticeAlert.mock.calls[0]?.[0] as
    | {
        target: { kind: string; id: number; title: string };
        actor: { displayName: string };
        details?: Array<{ label: string; value: string }>;
      }
    | undefined;
}

const REQUIRED: CostImpactNoticeInput = {
  title: "TEST PART",
  supplier: "Redlion",
  sapNumber: "1000-5110-00",
  oldPartNumber: "",
  mpn: "",
  originalCost: "10.00",
  newCost: "12.50",
  timeOfImpact: "Immediate",
  usedOnPanels: null,
  whereUsed: "Test fixture only.",
  eau: "",
  bpReference: "",
  notes: "",
};

async function raise(input: Partial<CostImpactNoticeInput> = {}) {
  const { result } = renderHook(() => useCreateCostImpactNotice(), { wrapper: wrapper() });
  await act(async () => {
    await result.current.mutateAsync({ ...REQUIRED, ...input });
  });
  await waitFor(() => expect(fireNewCostImpactNoticeAlert).toHaveBeenCalledTimes(1));
}

describe("raising a cost impact notice", () => {
  it("alerts the intake list", async () => {
    await raise();
    expect(firedWith()?.target.kind).toBe("costImpactNotice");
  });

  it("links the email to the notice that was just created", async () => {
    await raise();
    const target = firedWith()!.target;
    expect(target.id).toBeGreaterThan(0);
    expect(target.title).toBeTruthy();
  });

  it("names the raiser as the actor, so they're left off their own alert", async () => {
    await raise();
    expect(firedWith()?.actor.displayName).toBe("Ray White");
  });

  it("carries the cost figures the alert exists for", async () => {
    await raise();
    const details = firedWith()?.details ?? [];
    expect(details).toEqual(
      expect.arrayContaining([
        { label: "Supplier", value: "Redlion" },
        { label: "Original Cost", value: "10.00" },
        { label: "New Cost", value: "12.50" },
        { label: "Time of Impact", value: "Immediate" },
      ]),
    );
  });
});
