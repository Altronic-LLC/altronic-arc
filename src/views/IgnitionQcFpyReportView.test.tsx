import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { IgnitionQcFpyReportView } from "./IgnitionQcFpyReportView";

const state = vi.hoisted(() => ({
  monthly: [] as Array<{
    monthKey: string;
    label: string;
    unitsTested: number;
    unitsFailed: number;
    fpyPercent: number | null;
  }>,
  isLoading: false,
  lastRefreshedAt: null as Date | null,
  latestMonthBreakdown: [] as Array<{ label: string; count: number }>,
}));

vi.mock("@/hooks/useIgnitionQc", () => ({
  useIgnitionQcMonthlyFpy: () => ({
    monthly: state.monthly,
    isLoading: state.isLoading,
    lastRefreshedAt: state.lastRefreshedAt,
    latestMonthBreakdown: state.latestMonthBreakdown,
  }),
}));

beforeEach(() => {
  state.monthly = [];
  state.isLoading = false;
  state.lastRefreshedAt = null;
  state.latestMonthBreakdown = [];
});

describe("IgnitionQcFpyReportView", () => {
  it("shows a loading state while the data is loading", () => {
    state.isLoading = true;
    renderWithProviders(<IgnitionQcFpyReportView />);
    expect(screen.getByText(/loading|the ignition qc test data/i)).toBeInTheDocument();
  });

  it("renders the chart with the month range once data is in", () => {
    state.monthly = [
      { monthKey: "2026-07", label: "Jul", unitsTested: 60, unitsFailed: 1, fpyPercent: 98 },
      { monthKey: "2026-08", label: "Aug", unitsTested: 70, unitsFailed: 2, fpyPercent: 97 },
      { monthKey: "2026-09", label: "Sep", unitsTested: 50, unitsFailed: 0, fpyPercent: 100 },
    ];
    renderWithProviders(<IgnitionQcFpyReportView />);
    expect(screen.getByText(/Jul.*Sep/)).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText("Units passed")).toBeInTheDocument();
  });
});

describe("IgnitionQcFpyReportView — trend vs last month", () => {
  it("shows this month's FPY with an Up chip against last month", () => {
    state.monthly = [
      { monthKey: "2026-09", label: "Sep", unitsTested: 1000, unitsFailed: 60, fpyPercent: 94 },
      { monthKey: "2026-10", label: "Oct", unitsTested: 1000, unitsFailed: 40, fpyPercent: 96 },
    ];
    renderWithProviders(<IgnitionQcFpyReportView />);
    expect(screen.getByText(/FPY · Oct so far/)).toBeInTheDocument();
    expect(screen.getByTitle(/percentage points/)).toHaveTextContent("Up 2.0 pts vs Sep");
  });
});