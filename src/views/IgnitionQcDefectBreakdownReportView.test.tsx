import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { IgnitionQcDefectBreakdownReportView } from "./IgnitionQcDefectBreakdownReportView";

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

describe("IgnitionQcDefectBreakdownReportView", () => {
  it("shows a loading state while the data is loading", () => {
    state.isLoading = true;
    renderWithProviders(<IgnitionQcDefectBreakdownReportView />);
    expect(screen.getByText(/loading|the ignition qc test data/i)).toBeInTheDocument();
  });

  it("renders the latest month's total and defect breakdown", () => {
    state.monthly = [
      { monthKey: "2026-09", label: "Sep", unitsTested: 50, unitsFailed: 2, fpyPercent: 96 },
    ];
    state.latestMonthBreakdown = [{ label: "AE Wiring Deficiency", count: 2 }];
    renderWithProviders(<IgnitionQcDefectBreakdownReportView />);
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("AE Wiring Deficiency")).toBeInTheDocument();
  });
});
