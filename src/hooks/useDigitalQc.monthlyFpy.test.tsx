import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAllDigitalQcRecords, useDigitalQcMonthlyFpy } from "./useDigitalQc";
import { DIGITAL_QC_SAMPLE_RECORDS } from "@/data/digitalQcMockData";

afterEach(() => {
  vi.useRealTimers();
});

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useAllDigitalQcRecords", () => {
  it("merges records across every product family's own list", async () => {
    const { result } = renderHook(() => useAllDigitalQcRecords(), { wrapper: hookWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // One list per family, fanned out in parallel and flattened — the union
    // should be every seeded mock record, whichever family it belongs to.
    expect(result.current.entries.length).toBe(DIGITAL_QC_SAMPLE_RECORDS.length);
  });

  it("reports lastRefreshedAt only once every family has actually resolved", async () => {
    const { result } = renderHook(() => useAllDigitalQcRecords(), { wrapper: hookWrapper() });

    expect(result.current.lastRefreshedAt).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.lastRefreshedAt).toBeInstanceOf(Date);
  });
});

describe("useDigitalQcMonthlyFpy", () => {
  it("buckets the merged records into 3 trailing months", async () => {
    const { result } = renderHook(() => useDigitalQcMonthlyFpy(3), { wrapper: hookWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.monthly).toHaveLength(3);
  });

  it("exposes a real defect-category breakdown for a month the mock data actually falls in", async () => {
    // The seeded mock records are dated Oct/Nov 2025 — pick a "now" whose
    // trailing window reaches them, rather than asserting against whatever
    // month real "now" happens to be.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2025, 10, 15))); // Nov 15, 2025

    const { result } = renderHook(() => useDigitalQcMonthlyFpy(3), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.latestMonthBreakdown.length).toBeGreaterThan(0);
    for (const category of result.current.latestMonthBreakdown) {
      expect(category.count).toBeGreaterThan(0);
      expect(typeof category.label).toBe("string");
    }
  });
});
