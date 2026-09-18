import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { DigitalQcFpyReportView } from "./DigitalQcFpyReportView";

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

describe("DigitalQcFpyReportView", () => {
  it("shows a loading state while the data is loading", () => {
    state.isLoading = true;
    renderWithProviders(<DigitalQcFpyReportView />);
    expect(screen.getByText(/loading|the digital qc test data/i)).toBeInTheDocument();
  });

  it("renders the chart with the month range once data is in", () => {
    state.monthly = [
      { monthKey: "2026-07", label: "Jul", unitsTested: 100, unitsFailed: 2, fpyPercent: 98 },
      { monthKey: "2026-08", label: "Aug", unitsTested: 120, unitsFailed: 3, fpyPercent: 97.5 },
      { monthKey: "2026-09", label: "Sep", unitsTested: 90, unitsFailed: 1, fpyPercent: 98.9 },
    ];
    renderWithProviders(<DigitalQcFpyReportView />);
    expect(screen.getByText(/Jul.*Sep/)).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText("Units passed")).toBeInTheDocument();
  });
});
