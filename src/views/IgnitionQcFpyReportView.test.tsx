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
