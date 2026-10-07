import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { TeradyneDefectBreakdownReportView } from "./TeradyneDefectBreakdownReportView";

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

describe("TeradyneDefectBreakdownReportView", () => {
  it("shows a loading state while the log is loading", () => {
    state.isLoading = true;
    renderWithProviders(<TeradyneDefectBreakdownReportView />);
    expect(screen.getByText(/loading|the teradyne board test data/i)).toBeInTheDocument();
  });

  it("renders the latest month's total and defect breakdown", () => {
    state.monthly = [
      { monthKey: "2026-09", label: "Sep", unitsTested: 545, unitsFailed: 30, fpyPercent: 94.5 },
    ];
    state.latestMonthBreakdown = [{ label: "Cold solder", count: 30 }];
    renderWithProviders(<TeradyneDefectBreakdownReportView />);
    expect(screen.getByText("545")).toBeInTheDocument();
    expect(screen.getByText("Cold solder")).toBeInTheDocument();
    // "Sep" appears both in the page description and inside the donut's
    // center label — assert presence, not uniqueness.
    expect(screen.getAllByText(/Sep/).length).toBeGreaterThan(0);
  });

  it("shows the empty state when nothing failed that month", () => {
    state.monthly = [
      { monthKey: "2026-09", label: "Sep", unitsTested: 545, unitsFailed: 0, fpyPercent: 100 },
    ];
    state.latestMonthBreakdown = [];
    renderWithProviders(<TeradyneDefectBreakdownReportView />);
    expect(screen.getByText("No defects logged in Sep.")).toBeInTheDocument();
  });
});
