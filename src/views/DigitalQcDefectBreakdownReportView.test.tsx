import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { DigitalQcDefectBreakdownReportView } from "./DigitalQcDefectBreakdownReportView";

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

vi.mock("@/hooks/useDigitalQc", () => ({
  useDigitalQcMonthlyFpy: () => ({
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

describe("DigitalQcDefectBreakdownReportView", () => {
  it("shows a loading state while the data is loading", () => {
    state.isLoading = true;
    renderWithProviders(<DigitalQcDefectBreakdownReportView />);
    expect(screen.getByText(/loading|the digital qc test data/i)).toBeInTheDocument();
  });

  it("renders the latest month's total and defect breakdown", () => {
    state.monthly = [
      { monthKey: "2026-09", label: "Sep", unitsTested: 90, unitsFailed: 5, fpyPercent: 94.4 },
    ];
    state.latestMonthBreakdown = [{ label: "Process Solder Defect", count: 5 }];
    renderWithProviders(<DigitalQcDefectBreakdownReportView />);
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("Process Solder Defect")).toBeInTheDocument();
  });
});
