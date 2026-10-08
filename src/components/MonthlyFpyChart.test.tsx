import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlyFpyChart, niceMax, percentFloorFor } from "./MonthlyFpyChart";
import type { MonthlyFpy } from "@/lib/monthlyYield";

function month(overrides: Partial<MonthlyFpy>): MonthlyFpy {
  return {
    monthKey: "2026-07",
    label: "Jul",
    unitsTested: 0,
    unitsFailed: 0,
    fpyPercent: null,
    ...overrides,
  };
}

describe("niceMax", () => {
  it("rounds up to a friendly ceiling", () => {
    expect(niceMax(437)).toBe(500);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(0)).toBe(10);
  });
});

describe("percentFloorFor", () => {
  it("floors at 50 when every real value clears 50%", () => {
    expect(percentFloorFor([93, 95.4, 94.7])).toBe(50);
  });

  it("floors at 0 when any real value is under 50%", () => {
    expect(percentFloorFor([93, 42, 94.7])).toBe(0);
  });

  it("floors at 0 when every value is null — nothing to crop toward", () => {
    expect(percentFloorFor([null, null])).toBe(0);
  });

  it("treats exactly 50 as clearing the floor", () => {
    expect(percentFloorFor([50, 100])).toBe(50);
  });

  it("ignores nulls when deciding, rather than treating them as failing", () => {
    expect(percentFloorFor([93, null, 94.7])).toBe(50);
  });
});

describe("MonthlyFpyChart", () => {
  it("renders an accessible label naming each month's figures, using the unit label", () => {
    render(
      <MonthlyFpyChart
        unitLabel="Boards"
        data={[
          month({ monthKey: "2026-07", label: "Jul", unitsTested: 1000, unitsFailed: 20, fpyPercent: 98 }),
          month({ monthKey: "2026-08", label: "Aug", unitsTested: 0, unitsFailed: 0, fpyPercent: null }),
        ]}
      />,
    );
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toContain("Boards tested and failed by month");
    expect(chart.getAttribute("aria-label")).toContain("Jul: 1,000 tested, 20 failed, 98.0% FPY");
    expect(chart.getAttribute("aria-label")).toContain("Aug: 0 tested, 0 failed, no data");
  });

  it("defaults the unit label to Units when none is given", () => {
    render(<MonthlyFpyChart data={[month({})]} />);
    expect(screen.getByText("Units passed")).toBeInTheDocument();
    expect(screen.getByText("Units failed")).toBeInTheDocument();
  });

  it("shows the month labels and the Units Tested total on each bar", () => {
    render(
      <MonthlyFpyChart
        data={[month({ monthKey: "2026-07", label: "Jul", unitsTested: 1234, unitsFailed: 5 })]}
      />,
    );
    expect(screen.getByText("Jul")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("shows the passed count (total minus failed) inside the blue segment", () => {
    render(
      <MonthlyFpyChart
        data={[month({ monthKey: "2026-07", label: "Jul", unitsTested: 1234, unitsFailed: 34 })]}
      />,
    );
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });

  it("skips the passed-count label when the passed segment is too thin to hold it", () => {
    render(
      <MonthlyFpyChart
        data={[month({ monthKey: "2026-07", label: "Jul", unitsTested: 5000, unitsFailed: 4990 })]}
      />,
    );
    // Total (5,000) still shows above the bar (it also happens to land on a
    // tick label, hence getAllByText); the near-invisible sliver of passed
    // (10) does not get a label crammed into it.
    expect(screen.getAllByText("5,000").length).toBeGreaterThan(0);
    expect(screen.queryByText("10")).not.toBeInTheDocument();
  });

  it("renders the three-part legend using a custom unit label", () => {
    render(<MonthlyFpyChart unitLabel="Boards" data={[month({})]} />);
    expect(screen.getByText("Boards passed")).toBeInTheDocument();
    expect(screen.getByText("Boards failed")).toBeInTheDocument();
    expect(screen.getByText("FPY%")).toBeInTheDocument();
  });

  it("bumps the legend text size when large is set, for the kiosk cycle", () => {
    render(<MonthlyFpyChart data={[month({})]} large />);
    expect(screen.getByText("Units passed").closest("div")).toHaveClass("text-base");
  });

  it("renders without crashing when given no months", () => {
    render(<MonthlyFpyChart data={[]} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("drops the 0% and 25% ticks when every month's FPY clears 50%", () => {
    render(
      <MonthlyFpyChart
        data={[month({ unitsTested: 1000, unitsFailed: 20, fpyPercent: 93 })]}
      />,
    );
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("25%")).not.toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("keeps the full 0-100% axis when a month's FPY is under 50%", () => {
    render(
      <MonthlyFpyChart
        data={[month({ unitsTested: 1000, unitsFailed: 600, fpyPercent: 40 })]}
      />,
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });
});
