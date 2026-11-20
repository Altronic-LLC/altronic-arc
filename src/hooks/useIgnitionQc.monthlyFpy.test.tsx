import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAllIgnitionQcRecords, useIgnitionQcMonthlyFpy } from "./useIgnitionQc";
import { IGNITION_QC_SAMPLE_RECORDS } from "@/data/ignitionQcMockData";

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

describe("useAllIgnitionQcRecords", () => {
  it("merges records across every product family's own list", async () => {
    const { result } = renderHook(() => useAllIgnitionQcRecords(), { wrapper: hookWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries.length).toBe(IGNITION_QC_SAMPLE_RECORDS.length);
  });

  it("reports lastRefreshedAt only once every family has actually resolved", async () => {
    const { result } = renderHook(() => useAllIgnitionQcRecords(), { wrapper: hookWrapper() });

    expect(result.current.lastRefreshedAt).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.lastRefreshedAt).toBeInstanceOf(Date);
  });
});

describe("useIgnitionQcMonthlyFpy", () => {
  it("buckets the merged records into 3 trailing months", async () => {
    const { result } = renderHook(() => useIgnitionQcMonthlyFpy(3), { wrapper: hookWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.monthly).toHaveLength(3);
  });

  it("exposes a real defect-category breakdown for a month the mock data actually falls in", async () => {
    // IQC-1005 is dated Aug 21, 2025 with real defect counts — pick a "now"
    // whose trailing window's LAST month (the one latestMonthBreakdown
    // reads) lands on August, rather than asserting against whatever month
    // real "now" happens to be.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2025, 7, 25))); // Aug 25, 2025

    const { result } = renderHook(() => useIgnitionQcMonthlyFpy(3), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.latestMonthBreakdown.length).toBeGreaterThan(0);
    for (const category of result.current.latestMonthBreakdown) {
      expect(category.count).toBeGreaterThan(0);
      expect(typeof category.label).toBe("string");
    }
  });
});
