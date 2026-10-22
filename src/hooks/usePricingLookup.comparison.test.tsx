import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

// The SAP comparison's figures (2026-10-22). The part, its cost and its list
// price are live, but the per-MPG discount table isn't in the warehouse yet —
// so a "not connected" discount must read as the standard 34%, never as "SAP
// isn't connected" over a table full of real figures.

vi.mock("@/api/pricingLookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/pricingLookup")>();
  return {
    ...actual,
    lookupSapPart: vi.fn(async () => ({
      sapPartNumber: "9100-0007-15",
      altronicPartNumber: "910007-15",
      description: "HARNESS, DEMO",
      mpg: "HRN",
      listPrice: 200,
      cost: 66,
    })),
    sapMpgDistributorDiscounts: vi.fn(async () => {
      throw new actual.PricingDataNotConnectedError();
    }),
  };
});

import { useSapComparison } from "./usePricingLookup";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useSapComparison", () => {
  it("prices a live part at the standard 34% when the MPG discount table isn't connected", async () => {
    const { result } = renderHook(() => useSapComparison(["9100-0007-15"]), { wrapper });
    await waitFor(() => expect(result.current.rows[0].figures).not.toBeNull());
    expect(result.current.notConnected).toBe(false);
    expect(result.current.failed).toBe(false);
    const f = result.current.rows[0].figures!;
    expect(f.distributorDiscountPct).toBe(34);
    expect(f.discountFromSap).toBe(false);
    expect(f.distributorPrice).toBe(132);
    expect(f.baseGM).toBeCloseTo(50, 5);
  });
});
