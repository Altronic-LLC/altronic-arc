import { describe, it, expect } from "vitest";
import {
  addInterval,
  advanceSchedule,
  anchorDueDate,
  daysUntilDue,
  frequencyLabel,
  hasFrequency,
  isOverdue,
  isVisible,
  nextDueDates,
  toMiddayUtc,
  type SchedulePlan,
} from "./maintenanceSchedule";

// =============================================================================
// The PM scheduling maths. This is the one file in the CMMS module where a bug
// means a preventive-maintenance job silently never appears on anybody's list,
// so it is tested exhaustively rather than representatively.
// =============================================================================

const d = (isoDay: string) => new Date(`${isoDay}T12:00:00Z`);
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const days = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 10));

function plan(over: Partial<SchedulePlan> = {}): SchedulePlan {
  return {
    frequencyInterval: 1,
    frequencyUnit: "Months",
    scheduleBasis: "Fixed",
    firstDueDate: null,
    nextDueDate: null,
    lastCompleted: null,
    graceDays: 0,
    leadTimeDays: 0,
    active: true,
    ...over,
  };
}

describe("toMiddayUtc", () => {
  it("normalises any time of day onto midday UTC", () => {
    expect(toMiddayUtc(new Date("2026-03-04T23:41:07Z")).toISOString()).toBe(
      "2026-03-04T12:00:00.000Z",
    );
  });
});

describe("addInterval", () => {
  it("adds days and weeks", () => {
    expect(day(addInterval(d("2026-03-01"), 10, "Days"))).toBe("2026-03-11");
    expect(day(addInterval(d("2026-03-01"), 3, "Weeks"))).toBe("2026-03-22");
  });

  it("adds a month WITHOUT rolling 31 January into March", () => {
    // The whole reason this file exists rather than a `+30 days`.
    expect(day(addInterval(d("2026-01-31"), 1, "Months"))).toBe("2026-02-28");
  });

  it("clamps onto 29 February in a leap year", () => {
    expect(day(addInterval(d("2024-01-31"), 1, "Months"))).toBe("2024-02-29");
  });

  it("clamps a 31st onto a 30-day month", () => {
    expect(day(addInterval(d("2026-01-31"), 3, "Months"))).toBe("2026-04-30");
  });

  it("carries across a year boundary", () => {
    expect(day(addInterval(d("2026-11-30"), 3, "Months"))).toBe("2027-02-28");
    expect(day(addInterval(d("2026-12-15"), 1, "Months"))).toBe("2027-01-15");
  });

  it("adds years, clamping 29 February onto the 28th", () => {
    expect(day(addInterval(d("2024-02-29"), 1, "Years"))).toBe("2025-02-28");
    expect(day(addInterval(d("2026-06-10"), 2, "Years"))).toBe("2028-06-10");
  });

  it("normalises the result onto midday UTC whatever went in", () => {
    expect(addInterval(new Date("2026-03-01T23:00:00Z"), 1, "Days").toISOString()).toBe(
      "2026-03-02T12:00:00.000Z",
    );
  });

  it("REFUSES a zero or negative interval", () => {
    // Every caller steps in a loop; a zero interval there is an infinite one.
    expect(() => addInterval(d("2026-01-01"), 0, "Days")).toThrow(/positive number/);
    expect(() => addInterval(d("2026-01-01"), -2, "Months")).toThrow(/positive number/);
    expect(() => addInterval(d("2026-01-01"), Number.NaN, "Days")).toThrow(/positive number/);
  });

  it("REFUSES a unit it doesn't recognise rather than guessing at days", () => {
    expect(() =>
      addInterval(d("2026-01-01"), 1, "Fortnights" as unknown as "Days"),
    ).toThrow(/Unknown maintenance frequency unit/);
  });
});

describe("hasFrequency", () => {
  it("needs both an interval and a unit", () => {
    expect(hasFrequency(plan())).toBe(true);
    expect(hasFrequency(plan({ frequencyUnit: null }))).toBe(false);
    expect(hasFrequency(plan({ frequencyInterval: null }))).toBe(false);
    expect(hasFrequency(plan({ frequencyInterval: 0 }))).toBe(false);
  });
});

describe("anchorDueDate", () => {
  it("Fixed reads the stored NextDueDate", () => {
    const s = plan({ nextDueDate: d("2026-05-01"), firstDueDate: d("2026-01-01") });
    expect(day(anchorDueDate(s))).toBe("2026-05-01");
  });

  it("Fixed falls back to FirstDueDate when nothing has been completed", () => {
    expect(day(anchorDueDate(plan({ firstDueDate: d("2026-01-01") })))).toBe("2026-01-01");
  });

  it("Floating derives it from LastCompleted, not from the stored date", () => {
    // The whole point of the basis: 90 days after the last one was DONE.
    const s = plan({
      scheduleBasis: "Floating",
      frequencyInterval: 90,
      frequencyUnit: "Days",
      lastCompleted: d("2026-03-01"),
      nextDueDate: d("2026-04-01"),
    });
    expect(day(anchorDueDate(s))).toBe("2026-05-30");
  });

  it("Floating falls back to the stored dates before the first completion", () => {
    const s = plan({ scheduleBasis: "Floating", firstDueDate: d("2026-02-10") });
    expect(day(anchorDueDate(s))).toBe("2026-02-10");
  });

  it("is null when the schedule was never given a date", () => {
    expect(anchorDueDate(plan())).toBeNull();
  });
});

describe("nextDueDates", () => {
  it("projects a Fixed monthly schedule from the due date", () => {
    const s = plan({ nextDueDate: d("2026-06-01") });
    expect(days(nextDueDates(s, d("2026-06-01"), 3))).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
  });

  it("does NOT let the month-end clamp compound across a projection", () => {
    // Stepping off the previous result gives 31 Jan, 28 Feb, 28 Mar, 28 Apr —
    // the 31st never comes back. Measured from the anchor it is right.
    const s = plan({ nextDueDate: d("2026-01-31") });
    expect(days(nextDueDates(s, d("2026-01-01"), 4))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("projects a Floating schedule from the last completion", () => {
    const s = plan({
      scheduleBasis: "Floating",
      frequencyInterval: 90,
      frequencyUnit: "Days",
      lastCompleted: d("2026-01-01"),
    });
    expect(days(nextDueDates(s, d("2026-01-01"), 2))).toEqual(["2026-04-01", "2026-06-30"]);
  });

  it("KEEPS RETURNING an overdue occurrence — it does not roll forward", () => {
    // The single most important behaviour in this file. A schedule that
    // quietly re-dated itself every time it was missed is one nobody ever does.
    const s = plan({ nextDueDate: d("2026-01-15") });
    const projected = nextDueDates(s, d("2026-06-20"), 3);
    expect(day(projected[0])).toBe("2026-01-15");
  });

  it("still returns the overdue occurrence a year later", () => {
    const s = plan({ frequencyInterval: 1, frequencyUnit: "Weeks", nextDueDate: d("2025-06-02") });
    expect(day(nextDueDates(s, d("2026-06-02"), 1)[0])).toBe("2025-06-02");
  });

  it("skips the occurrences that were MISSED between the overdue one and now", () => {
    // A weekly schedule left alone for a year must not fill the list with
    // fifty-two dates that have all been and gone.
    const s = plan({ frequencyInterval: 1, frequencyUnit: "Weeks", nextDueDate: d("2026-01-05") });
    const projected = nextDueDates(s, d("2026-03-01"), 3);
    expect(day(projected[0])).toBe("2026-01-05");
    for (const occurrence of projected.slice(1)) {
      expect(occurrence.getTime()).toBeGreaterThanOrEqual(d("2026-03-01").getTime());
    }
  });

  it("combines skipping and month-end clamping correctly", () => {
    const s = plan({ nextDueDate: d("2026-01-31") });
    expect(days(nextDueDates(s, d("2026-04-10"), 3))).toEqual([
      "2026-01-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("projects NOTHING for an inactive schedule, whatever its dates say", () => {
    const s = plan({ active: false, nextDueDate: d("2026-06-01") });
    expect(nextDueDates(s, d("2026-06-01"), 5)).toEqual([]);
  });

  it("projects exactly ONE occurrence when there is no usable frequency", () => {
    // Dates but no repeat is a one-off, not an infinite series.
    const s = plan({ frequencyUnit: null, nextDueDate: d("2026-06-01") });
    expect(days(nextDueDates(s, d("2026-01-01"), 5))).toEqual(["2026-06-01"]);
  });

  it("returns nothing without a date to start from, or for a count of zero", () => {
    expect(nextDueDates(plan(), d("2026-06-01"), 3)).toEqual([]);
    expect(nextDueDates(plan({ nextDueDate: d("2026-06-01") }), d("2026-06-01"), 0)).toEqual([]);
    expect(nextDueDates(plan({ nextDueDate: d("2026-06-01") }), d("2026-06-01"), -1)).toEqual([]);
  });

  it("terminates instead of hanging when `from` is absurdly far ahead", () => {
    const s = plan({ frequencyInterval: 1, frequencyUnit: "Days", nextDueDate: d("2026-01-01") });
    const projected = nextDueDates(s, d("2999-01-01"), 3);
    // It gives up rather than walking a million days; the overdue occurrence
    // is still there, which is what the screen needs.
    expect(day(projected[0])).toBe("2026-01-01");
    expect(projected.length).toBeLessThanOrEqual(3);
  });
});

describe("isOverdue", () => {
  it("is not overdue ON the due date", () => {
    const s = plan({ nextDueDate: d("2026-06-10") });
    expect(isOverdue(s, d("2026-06-10"))).toBe(false);
  });

  it("is overdue the day after, with no grace", () => {
    const s = plan({ nextDueDate: d("2026-06-10") });
    expect(isOverdue(s, d("2026-06-11"))).toBe(true);
  });

  it("respects GraceDays — the last grace day is still not late", () => {
    const s = plan({ nextDueDate: d("2026-06-10"), graceDays: 3 });
    expect(isOverdue(s, d("2026-06-13"))).toBe(false);
    expect(isOverdue(s, d("2026-06-14"))).toBe(true);
  });

  it("treats a missing or nonsense GraceDays as none", () => {
    const s = plan({ nextDueDate: d("2026-06-10"), graceDays: null });
    expect(isOverdue(s, d("2026-06-11"))).toBe(true);
    expect(isOverdue(plan({ nextDueDate: d("2026-06-10"), graceDays: -5 }), d("2026-06-11"))).toBe(
      true,
    );
  });

  it("is never overdue when inactive, or with no due date", () => {
    expect(isOverdue(plan({ active: false, nextDueDate: d("2020-01-01") }), d("2026-06-10"))).toBe(
      false,
    );
    expect(isOverdue(plan(), d("2026-06-10"))).toBe(false);
  });

  it("reads a Floating schedule's due date off its last completion", () => {
    const s = plan({
      scheduleBasis: "Floating",
      frequencyInterval: 30,
      frequencyUnit: "Days",
      lastCompleted: d("2026-01-01"),
    });
    expect(isOverdue(s, d("2026-01-31"))).toBe(false);
    expect(isOverdue(s, d("2026-02-01"))).toBe(true);
  });
});

describe("isVisible", () => {
  it("appears exactly LeadTimeDays before it is due, and not a day earlier", () => {
    const s = plan({ nextDueDate: d("2026-06-10"), leadTimeDays: 7 });
    expect(isVisible(s, d("2026-06-02"))).toBe(false);
    expect(isVisible(s, d("2026-06-03"))).toBe(true);
  });

  it("is visible on and after the due date, and while overdue", () => {
    const s = plan({ nextDueDate: d("2026-06-10"), leadTimeDays: 7 });
    expect(isVisible(s, d("2026-06-10"))).toBe(true);
    expect(isVisible(s, d("2026-09-01"))).toBe(true);
  });

  it("with no lead time, appears on the due date", () => {
    const s = plan({ nextDueDate: d("2026-06-10") });
    expect(isVisible(s, d("2026-06-09"))).toBe(false);
    expect(isVisible(s, d("2026-06-10"))).toBe(true);
  });

  it("is never visible when inactive, or with no due date", () => {
    expect(isVisible(plan({ active: false, nextDueDate: d("2026-06-10") }), d("2026-06-10"))).toBe(
      false,
    );
    expect(isVisible(plan({ leadTimeDays: 30 }), d("2026-06-10"))).toBe(false);
  });
});

describe("advanceSchedule", () => {
  it("Floating advances from the COMPLETION date", () => {
    const s = plan({
      scheduleBasis: "Floating",
      frequencyInterval: 90,
      frequencyUnit: "Days",
      nextDueDate: d("2026-01-01"),
    });
    expect(day(advanceSchedule(s, d("2026-02-15")))).toBe("2026-05-16");
  });

  it("Fixed advances from the DUE date, not the completion date", () => {
    // A monthly inspection stays on the 1st however late it was actually done.
    const s = plan({ nextDueDate: d("2026-06-01") });
    expect(day(advanceSchedule(s, d("2026-06-04")))).toBe("2026-07-01");
  });

  it("Fixed completed exactly on the due date still moves one interval", () => {
    const s = plan({ nextDueDate: d("2026-06-01") });
    expect(day(advanceSchedule(s, d("2026-06-01")))).toBe("2026-07-01");
  });

  it("Fixed catches up past a long overdue run rather than writing a date already gone", () => {
    // Due 1 January, monthly, finally done on 15 March → next due 1 April.
    const s = plan({ nextDueDate: d("2026-01-01") });
    expect(day(advanceSchedule(s, d("2026-03-15")))).toBe("2026-04-01");
  });

  it("Fixed catch-up does not compound the month-end clamp", () => {
    const s = plan({ nextDueDate: d("2026-01-31") });
    expect(day(advanceSchedule(s, d("2026-04-10")))).toBe("2026-04-30");
  });

  it("returns null for an inactive schedule", () => {
    expect(advanceSchedule(plan({ active: false, nextDueDate: d("2026-06-01") }), d("2026-06-01")))
      .toBeNull();
  });

  it("returns null with no usable frequency, or no date to advance from", () => {
    expect(
      advanceSchedule(plan({ frequencyUnit: null, nextDueDate: d("2026-06-01") }), d("2026-06-01")),
    ).toBeNull();
    expect(advanceSchedule(plan(), d("2026-06-01"))).toBeNull();
  });

  it("advances a yearly Fixed schedule onto the same day next year", () => {
    const s = plan({ frequencyInterval: 1, frequencyUnit: "Years", nextDueDate: d("2026-04-12") });
    expect(day(advanceSchedule(s, d("2026-04-12")))).toBe("2027-04-12");
  });
});

describe("daysUntilDue", () => {
  it("counts forward, and negative once late", () => {
    const s = plan({ nextDueDate: d("2026-06-10") });
    expect(daysUntilDue(s, d("2026-06-01"))).toBe(9);
    expect(daysUntilDue(s, d("2026-06-10"))).toBe(0);
    expect(daysUntilDue(s, d("2026-06-15"))).toBe(-5);
  });

  it("is null with no due date", () => {
    expect(daysUntilDue(plan(), d("2026-06-10"))).toBeNull();
  });
});

describe("frequencyLabel", () => {
  it("reads naturally for one and for many", () => {
    expect(frequencyLabel(1, "Months")).toBe("Every Month");
    expect(frequencyLabel(3, "Months")).toBe("Every 3 Months");
    expect(frequencyLabel(1, "Days")).toBe("Every Day");
    expect(frequencyLabel(90, "Days")).toBe("Every 90 Days");
  });

  it("says so plainly when there is no frequency", () => {
    expect(frequencyLabel(null, "Months")).toBe("No frequency set");
    expect(frequencyLabel(3, null)).toBe("No frequency set");
    expect(frequencyLabel(0, "Days")).toBe("No frequency set");
  });
});
