import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DefectBreakdownDonut } from "./DefectBreakdownDonut";

describe("DefectBreakdownDonut", () => {
  it("renders an accessible label naming the total tested and each category", () => {
    render(
      <DefectBreakdownDonut
        monthLabel="Sep"
        total={545}
        unitLabel="Units"
        segments={[
          { label: "Process Solder Defect", count: 10 },
          { label: "Physical Damage", count: 5 },
        ]}
      />,
    );
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toContain("545 units tested");
    expect(chart.getAttribute("aria-label")).toContain("Process Solder Defect: 10");
    expect(chart.getAttribute("aria-label")).toContain("Physical Damage: 5");
  });

  it("shows the total tested in the center and each category with a count and percentage", () => {
    render(
      <DefectBreakdownDonut
        monthLabel="Sep"
        total={545}
        segments={[
          { label: "Process Solder Defect", count: 15 },
          { label: "Physical Damage", count: 5 },
        ]}
      />,
    );
    expect(screen.getByText("545")).toBeInTheDocument();
    expect(screen.getByText("Process Solder Defect")).toBeInTheDocument();
    expect(screen.getByText("15 (75%)")).toBeInTheDocument();
    expect(screen.getByText("5 (25%)")).toBeInTheDocument();
  });

  it("shows a plain empty state when nothing failed that month", () => {
    render(<DefectBreakdownDonut monthLabel="Sep" total={545} segments={[]} />);
    expect(screen.getByText("No defects logged in Sep.")).toBeInTheDocument();
  });

  it("uses a much larger legend in kiosk mode, readable from across the room", () => {
    const segments = [{ label: "Wire bridge", count: 41 }];
    const { unmount } = render(
      <DefectBreakdownDonut monthLabel="Oct" total={2315} segments={segments} large />,
    );
    expect(screen.getByText("Wire bridge").parentElement?.parentElement).toHaveClass("text-xl");
    unmount();

    render(<DefectBreakdownDonut monthLabel="Oct" total={2315} segments={segments} />);
    expect(screen.getByText("Wire bridge").parentElement?.parentElement).toHaveClass("text-sm");
  });

  it("splits the center caption over two lines in kiosk mode so it fits inside the ring", () => {
    const { unmount } = render(
      <DefectBreakdownDonut monthLabel="Oct" total={2315} unitLabel="Boards" segments={[]} large />,
    );
    expect(screen.getByText("Boards tested")).toBeInTheDocument();
    expect(screen.getByText("Oct")).toBeInTheDocument();
    expect(screen.queryByText("Boards tested · Oct")).not.toBeInTheDocument();
    unmount();

    render(<DefectBreakdownDonut monthLabel="Oct" total={2315} unitLabel="Boards" segments={[]} />);
    expect(screen.getByText("Boards tested · Oct")).toBeInTheDocument();
  });

  it("renders without crashing when total is zero too", () => {
    render(<DefectBreakdownDonut monthLabel="Sep" total={0} segments={[]} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});
