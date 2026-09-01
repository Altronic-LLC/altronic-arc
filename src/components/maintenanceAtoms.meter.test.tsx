import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  type MeterStatus,
  meterStatus,
  type SchedulePlan,
} from "@/lib/maintenanceSchedule";
import {
  MeterReadingAsOf,
  MeterStatusLine,
  ScheduleBasisChip,
} from "./maintenanceAtoms";

// =============================================================================
// The run-hours atoms.
//
// One rule runs through every case here: **"can't tell" is rendered as its own
// state, never as a quiet "fine."** A meter PM whose asset has no reading — or
// no asset at all — can never come due, which is worse than being overdue, and
// these three components are the only place on any screen that would say so.
// =============================================================================

function meterPlan(over: Partial<SchedulePlan> = {}): SchedulePlan {
  return {
    frequencyInterval: 500,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    firstDueDate: null,
    nextDueDate: null,
    lastCompleted: null,
    lastCompletedHours: 4300,
    nextDueHours: null,
    graceDays: null,
    leadTimeDays: null,
    active: true,
    ...over,
  };
}

const NOW = new Date("2026-09-15T12:00:00Z");

function status(
  hours: number | null,
  opts: { linked?: boolean; readingAsOf?: string; plan?: Partial<SchedulePlan> } = {},
): MeterStatus {
  return meterStatus(
    meterPlan(opts.plan),
    {
      linked: opts.linked ?? true,
      hours,
      readingAsOf: opts.readingAsOf ? new Date(`${opts.readingAsOf}T12:00:00Z`) : null,
    },
    NOW,
  );
}

describe("ScheduleBasisChip", () => {
  it("renders the Hourmeter basis, and explains it is not a date", () => {
    render(<ScheduleBasisChip basis="Hourmeter" />);
    const chip = screen.getByText("Hourmeter");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("title", expect.stringContaining("READING"));
    expect(chip).toHaveAttribute("title", expect.stringContaining("rather than on a date"));
  });

  it("still explains Fixed and Floating", () => {
    const { unmount } = render(<ScheduleBasisChip basis="Fixed" />);
    expect(screen.getByText("Fixed")).toHaveAttribute("title", expect.stringContaining("DUE date"));
    unmount();
    render(<ScheduleBasisChip basis="Floating" />);
    expect(screen.getByText("Floating")).toHaveAttribute(
      "title",
      expect.stringContaining("COMPLETION date"),
    );
  });

  it("renders nothing with no basis", () => {
    const { container } = render(<ScheduleBasisChip basis={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MeterStatusLine", () => {
  it("shows the target, the reading and the gap", () => {
    render(<MeterStatusLine status={status(4643)} />);
    expect(screen.getByText("Due at 4,800 hrs · now 4,643 hrs · 157 to go")).toBeInTheDocument();
  });

  it("says how far past due it is", () => {
    render(<MeterStatusLine status={status(4820)} />);
    expect(screen.getByText(/20 hrs past due/)).toBeInTheDocument();
  });

  it("names the fault when the asset has no reading, and does NOT read as fine", () => {
    render(<MeterStatusLine status={status(null)} />);
    const line = screen.getByText(/no hourmeter reading/i);
    expect(line).toBeInTheDocument();
    expect(line.textContent).toMatch(/can't tell/i);
    // Never rendered as a quiet grey aside — it is a fault on the schedule.
    expect(line.className).toContain("text-cooper-red");
  });

  it("names the fault when there is no asset at all", () => {
    render(<MeterStatusLine status={status(null, { linked: false })} />);
    expect(screen.getByText(/No asset linked/i)).toBeInTheDocument();
    expect(screen.getByText(/can never come due/i)).toBeInTheDocument();
  });

  it("shows a genuine ZERO reading as a reading, not as a fault", () => {
    render(
      <MeterStatusLine
        status={status(0, { plan: { frequencyInterval: 100, lastCompletedHours: 0 } })}
      />,
    );
    expect(screen.getByText(/now 0 hrs/)).toBeInTheDocument();
    expect(screen.queryByText(/can't tell/i)).not.toBeInTheDocument();
  });

  it("renders nothing for a schedule it does not apply to", () => {
    const retired = status(4820, { plan: { active: false } });
    const { container } = render(<MeterStatusLine status={retired} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MeterReadingAsOf", () => {
  it("labels the date as the asset ROW's edit, not as when the meter was read", () => {
    // SharePoint keeps no per-column timestamp, so claiming to know when the
    // hours were read would be a stronger claim than the data supports.
    render(<MeterReadingAsOf status={status(4643, { readingAsOf: "2026-09-13" })} />);
    const line = screen.getByText(/Asset last edited/);
    expect(line.textContent).toMatch(/2 days ago/);
    expect(line).toHaveAttribute("title", expect.stringContaining("no per-column timestamp"));
  });

  it("warns when the row has gone untouched long enough to hide a whole interval", () => {
    // 500-hour interval → stale after 21 days at the fastest a meter can move.
    render(<MeterReadingAsOf status={status(4643, { readingAsOf: "2026-06-01" })} />);
    expect(screen.getByText(/Reading may be stale/i)).toBeInTheDocument();
  });

  it("calls the staleness a guess rather than a fact", () => {
    render(<MeterReadingAsOf status={status(4643, { readingAsOf: "2026-06-01" })} />);
    expect(screen.getByText(/Reading may be stale/i)).toHaveAttribute(
      "title",
      expect.stringContaining("A guess, not a fact"),
    );
  });

  it("says so when the asset row has no edit date at all", () => {
    render(<MeterReadingAsOf status={status(4643)} />);
    expect(screen.getByText(/no way to tell how old this reading is/i)).toBeInTheDocument();
  });

  it("says today for a row edited today", () => {
    render(<MeterReadingAsOf status={status(4643, { readingAsOf: "2026-09-15" })} />);
    expect(screen.getByText(/\(today\)/)).toBeInTheDocument();
  });

  it("renders nothing when the state can't be told — the status line carries that", () => {
    const { container } = render(
      <MeterReadingAsOf status={status(null, { readingAsOf: "2026-06-01" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a retired schedule", () => {
    const { container } = render(
      <MeterReadingAsOf status={status(4643, { readingAsOf: "2026-09-13", plan: { active: false } })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
