import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { TeradyneFpyReportView } from "./TeradyneFpyReportView";

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

vi.mock("@/hooks/useTeradyne", () => ({
  useTeradyneMonthlyFpy: () => ({
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

describe("TeradyneFpyReportView", () => {
  it("shows a loading state while the log is loading", () => {
    state.isLoading = true;
    renderWithProviders(<TeradyneFpyReportView />);
    expect(screen.getByText(/loading|the teradyne board test data/i)).toBeInTheDocument();
  });

  it("renders the chart with the month range once data is in", () => {
    state.monthly = [
      { monthKey: "2026-07", label: "Jul", unitsTested: 1000, unitsFailed: 20, fpyPercent: 98 },
      { monthKey: "2026-08", label: "Aug", unitsTested: 1200, unitsFailed: 30, fpyPercent: 97.5 },
      { monthKey: "2026-09", label: "Sep", unitsTested: 900, unitsFailed: 10, fpyPercent: 98.9 },
    ];
    renderWithProviders(<TeradyneFpyReportView />);
    expect(screen.getByText(/Jul.*Sep/)).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("shows when the data was last refreshed", () => {
    state.monthly = [
      { monthKey: "2026-09", label: "Sep", unitsTested: 900, unitsFailed: 10, fpyPercent: 98.9 },
    ];
    state.lastRefreshedAt = new Date(2026, 8, 17, 15, 42);
    renderWithProviders(<TeradyneFpyReportView />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("shows no refreshed timestamp before the first fetch has resolved", () => {
    state.monthly = [
      { monthKey: "2026-09", label: "Sep", unitsTested: 900, unitsFailed: 10, fpyPercent: 98.9 },
    ];
    state.lastRefreshedAt = null;
    renderWithProviders(<TeradyneFpyReportView />);
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });
});
