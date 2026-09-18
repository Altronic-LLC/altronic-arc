import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTeradyneMonthlyFpy } from "./useTeradyne";
import * as teradyneLogApi from "@/api/teradyneLog";

// listTeradyneLog is wrapped in a real vi.fn() (not replaced) so it still
// reads from the mock store, letting us assert on WHICH years were asked for
// without hand-rolling a fake implementation.
vi.mock("@/api/teradyneLog", async (importOriginal) => {
  const actual = await importOriginal<typeof teradyneLogApi>();
  return { ...actual, listTeradyneLog: vi.fn(actual.listTeradyneLog) };
});

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function yearsRequested(): number[] {
  const mock = vi.mocked(teradyneLogApi.listTeradyneLog);
  return mock.mock.calls.map(([scope]) => (scope?.kind === "year" ? scope.year : -1));
}

describe("useTeradyneMonthlyFpy", () => {
  beforeEach(() => {
    vi.mocked(teradyneLogApi.listTeradyneLog).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches only the current year when the trailing window stays inside it", async () => {
    // Fake only Date — the mock API's artificial network delay still runs on
    // REAL timers, or waitFor's polling never sees it resolve.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15))); // June 2026 — Apr/May/Jun

    const wrapper = hookWrapper();
    const { result } = renderHook(() => useTeradyneMonthlyFpy(3), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.monthly.map((m) => m.label)).toEqual(["Apr", "May", "Jun"]);
    expect(yearsRequested()).toEqual([2026]);
    // Wiring only — every row in this static mock fixture sets boardsTested,
    // so none of them are genuinely defect-only rows and the real breakdown
    // math (batch rows excluded, defect rows grouped by remark) is empty
    // here regardless of month. That math is exercised properly, with the
    // right fixture shapes, in lib/teradyneFpy.test.ts.
    expect(Array.isArray(result.current.latestMonthBreakdown)).toBe(true);
  });

  it("reports lastRefreshedAt only once the fetch has actually landed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15)));

    const wrapper = hookWrapper();
    const { result } = renderHook(() => useTeradyneMonthlyFpy(3), { wrapper });

    expect(result.current.lastRefreshedAt).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.lastRefreshedAt).toBeInstanceOf(Date);
  });

  it("also fetches the previous year when the window reaches into January", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 15))); // Jan 2026 — Nov/Dec 2025, Jan 2026

    const wrapper = hookWrapper();
    const { result } = renderHook(() => useTeradyneMonthlyFpy(3), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.monthly.map((m) => m.label)).toEqual(["Nov", "Dec", "Jan"]);
    expect(yearsRequested().sort()).toEqual([2025, 2026]);
  });

  it("refreshes automatically after the report refetch interval, unattended", async () => {
    // Fake EVERY timer here (not just Date) so the 2-minute interval can be
    // advanced instantly instead of the test actually waiting on it — driven
    // by vi.advanceTimersByTimeAsync rather than waitFor, which polls on a
    // real setTimeout that fake timers would otherwise freeze.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15))); // June — no previous-year fetch

    const wrapper = hookWrapper();
    const { result } = renderHook(() => useTeradyneMonthlyFpy(3), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500); // let the initial mock fetch resolve
    });
    expect(result.current.isLoading).toBe(false);
    const callsAfterMount = vi.mocked(teradyneLogApi.listTeradyneLog).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000 + 500); // past the interval + its own fetch delay
    });

    expect(vi.mocked(teradyneLogApi.listTeradyneLog).mock.calls.length).toBeGreaterThan(
      callsAfterMount,
    );
  });
});
