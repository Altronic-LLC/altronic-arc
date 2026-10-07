import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MonthlyFpy } from "@/lib/monthlyYield";
import { MonthTrendHeadline } from "./MonthTrendHeadline";

function month(label: string, unitsTested: number, unitsFailed: number): MonthlyFpy {
  return {
    monthKey: `2026-${label}`,
    label,
    unitsTested,
    unitsFailed,
    fpyPercent: unitsTested > 0 ? ((unitsTested - unitsFailed) / unitsTested) * 100 : null,
  };
}

describe("MonthTrendHeadline", () => {
  it("renders nothing with fewer than two months", () => {
    const { container } = render(
      <MonthTrendHeadline monthly={[month("Oct", 500, 5)]} metric="fpy" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows this month's FPY and a green Up chip when it improved", () => {
    render(
      <MonthTrendHeadline
        monthly={[month("Sep", 1000, 60), month("Oct", 1000, 40)]}
        metric="fpy"
      />,
    );
    expect(screen.getByText("96.0%")).toBeInTheDocument();
    expect(screen.getByText(/FPY · Oct so far/)).toBeInTheDocument();
    const chip = screen.getByTitle(/percentage points/);
    expect(chip).toHaveTextContent("Up 2.0 pts vs Sep");
    expect(chip.className).toContain("text-cooper-green");
  });

  it("shows a red Down chip when FPY got worse", () => {
    render(
      <MonthTrendHeadline
        monthly={[month("Sep", 1000, 40), month("Oct", 1000, 60)]}
        metric="fpy"
      />,
    );
    const chip = screen.getByTitle(/percentage points/);
    expect(chip).toHaveTextContent("Down 2.0 pts vs Sep");
    expect(chip.className).toContain("text-cooper-red");
  });

  it("colours a FALLING failure rate green, not red", () => {
    render(
      <MonthTrendHeadline
        monthly={[month("Sep", 1000, 60), month("Oct", 1000, 40)]}
        metric="failureRate"
      />,
    );
    expect(screen.getByText(/failure rate · Oct so far/)).toBeInTheDocument();
    const chip = screen.getByTitle(/percentage points/);
    expect(chip).toHaveTextContent("Down 2.0 pts vs Sep");
    expect(chip.className).toContain("text-cooper-green");
  });

  it("says No change, in a neutral tone, when the change rounds to zero", () => {
    render(
      <MonthTrendHeadline
        monthly={[month("Sep", 10000, 500), month("Oct", 10000, 503)]}
        metric="fpy"
      />,
    );
    const chip = screen.getByTitle(/percentage points/);
    expect(chip).toHaveTextContent("No change vs Sep");
    expect(chip.className).not.toContain("cooper-green");
    expect(chip.className).not.toContain("cooper-red");
  });

  it("holds the chip back while the month is too thin, saying when it will compare", () => {
    render(
      <MonthTrendHeadline
        monthly={[month("Sep", 4664, 252), month("Oct", 120, 20)]}
        metric="fpy"
        unitLabel="Boards"
      />,
    );
    expect(screen.queryByTitle(/percentage points/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Compared with Sep once 200 boards are tested (120 so far)."),
    ).toBeInTheDocument();
  });

  it("says nothing is tested yet on a month with no units", () => {
    render(
      <MonthTrendHeadline
        monthly={[month("Sep", 4664, 252), month("Oct", 0, 0)]}
        metric="fpy"
        unitLabel="Boards"
      />,
    );
    expect(screen.getByText("No boards tested in Oct yet.")).toBeInTheDocument();
    expect(screen.queryByTitle(/percentage points/)).not.toBeInTheDocument();
  });

  it("says there's nothing to compare with when last month tested nothing", () => {
    render(
      <MonthTrendHeadline
        monthly={[month("Sep", 0, 0), month("Oct", 500, 5)]}
        metric="fpy"
      />,
    );
    expect(screen.getByText("Nothing tested in Sep to compare with.")).toBeInTheDocument();
  });
});
