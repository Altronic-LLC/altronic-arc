import { describe, it, expect } from "vitest";
import {
  MAX_METER_HOURS_PER_DAY,
  MIN_STALE_READING_DAYS,
  UNLINKED_METER_READING,
  addInterval,
  advanceMeterSchedule,
  advanceSchedule,
  anchorDueDate,
  anchorDueHours,
  daysUntilDue,
  formatMeterHours,
  frequencyLabel,
  hasFrequency,
  isMeterDue,
  isMeterSchedule,
  isOverdue,
  isVisible,
  meterAssetIndex,
  meterReadingFor,
  meterReadingStaleAfterDays,
  meterStatus,
  meterStatusLine,
  nextDueDates,
  toMiddayUtc,
  type MeterReading,
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
    lastCompletedHours: null,
    nextDueHours: null,
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

// =============================================================================
// The METER (Hourmeter / run-hours) path.
//
// Covered as thoroughly as the date path, and for the same reason: a bug here
// means a PM silently never comes due. The cases that matter most are the ones
// where NOTHING is due and nothing looks wrong — a null reading, no asset, a
// stale row — so each has its own test asserting the state is "unknown" rather
// than merely "not due".
// =============================================================================

/** A run-hours plan. Meter defaults, so each test states only what it is about. */
function meterPlan(over: Partial<SchedulePlan> = {}): SchedulePlan {
  return plan({
    frequencyInterval: 500,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    firstDueDate: null,
    nextDueDate: null,
    ...over,
  });
}

/** A reading with an asset behind it. `hours: null` means never recorded. */
function reading(hours: number | null, asOfDay?: string): MeterReading {
  return {
    linked: true,
    hours,
    readingAsOf: asOfDay ? d(asOfDay) : null,
  };
}

describe("isMeterSchedule", () => {
  it("is true for the Hourmeter basis", () => {
    expect(isMeterSchedule(meterPlan())).toBe(true);
  });

  it("is true for a unit of Hours whatever the basis says", () => {
    // Contradictory data somebody can produce in SharePoint. Reading it as a
    // meter schedule is the safe direction — the alternative is projecting
    // "every 500 hours" as 500 DAYS.
    expect(isMeterSchedule(meterPlan({ scheduleBasis: "Fixed" }))).toBe(true);
    expect(isMeterSchedule(meterPlan({ scheduleBasis: "Floating" }))).toBe(true);
  });

  it("is true for an Hourmeter basis with a date unit", () => {
    expect(isMeterSchedule(meterPlan({ frequencyUnit: "Months" }))).toBe(true);
  });

  it("is false for an ordinary calendar schedule", () => {
    expect(isMeterSchedule(plan())).toBe(false);
    expect(isMeterSchedule(plan({ scheduleBasis: "Floating" }))).toBe(false);
  });
});

describe("the date functions refuse a meter schedule", () => {
  // Each of these would otherwise reach `addInterval`, which THROWS on a unit
  // of Hours — so a missing guard is not a wrong number, it is a crash.
  it("anchorDueDate is null even when a date is stored", () => {
    expect(anchorDueDate(meterPlan({ nextDueDate: d("2026-06-01") }))).toBeNull();
  });

  it("anchorDueDate is null for a Floating basis with a last completion", () => {
    expect(
      anchorDueDate(meterPlan({ scheduleBasis: "Floating", lastCompleted: d("2026-05-01") })),
    ).toBeNull();
  });

  it("nextDueDates is empty, and does not throw on an Hours interval", () => {
    // `addInterval` throws on a unit of Hours, so the risk here is a CRASH
    // rather than a wrong date. Note the guard inside `nextDueDates` is
    // belt-and-braces: `anchorDueDate` already refuses the same schedules, so
    // removing either one on its own leaves this passing. It stays because a
    // later change to one must not silently arm the other.
    expect(nextDueDates(meterPlan({ nextDueDate: d("2026-06-01") }), d("2026-06-01"), 3)).toEqual(
      [],
    );
    expect(() =>
      nextDueDates(
        meterPlan({ scheduleBasis: "Floating", lastCompleted: d("2026-05-01") }),
        d("2026-06-01"),
        3,
      ),
    ).not.toThrow();
  });

  it("daysUntilDue is null", () => {
    expect(daysUntilDue(meterPlan({ nextDueDate: d("2026-06-01") }), d("2026-06-10"))).toBeNull();
  });

  it("advanceSchedule is null", () => {
    expect(advanceSchedule(meterPlan({ nextDueDate: d("2026-06-01") }), d("2026-06-05"))).toBeNull();
  });
});

describe("anchorDueHours", () => {
  it("prefers the last completion reading plus the interval", () => {
    // Even when a target is stored — the same rule `anchorDueDate` follows for
    // a Floating schedule, so editing the completion reading in SharePoint
    // keeps working without anybody touching the target.
    const got = anchorDueHours(
      meterPlan({ lastCompletedHours: 4300, nextDueHours: 9999 }),
      reading(4400),
    );
    expect(got).toEqual({ hours: 4800, anchoredOnCurrentReading: false });
  });

  it("falls back to the stored target when nothing has been completed", () => {
    const got = anchorDueHours(meterPlan({ nextDueHours: 1000 }), reading(400));
    expect(got).toEqual({ hours: 1000, anchoredOnCurrentReading: false });
  });

  it("uses the stored target when there is a completion but no interval", () => {
    const got = anchorDueHours(
      meterPlan({ frequencyInterval: null, lastCompletedHours: 100, nextDueHours: 900 }),
      reading(400),
    );
    expect(got).toEqual({ hours: 900, anchoredOnCurrentReading: false });
  });

  it("anchors on the CURRENT reading plus the interval as a last resort, and says so", () => {
    const got = anchorDueHours(meterPlan(), reading(5000));
    expect(got).toEqual({ hours: 5500, anchoredOnCurrentReading: true });
  });

  it("treats a completion reading of ZERO as a real reading", () => {
    // 0 is a genuine reading off a new machine. Truthiness here would skip
    // straight past it to the stored target (or to today's reading).
    const got = anchorDueHours(meterPlan({ frequencyInterval: 100, lastCompletedHours: 0 }), reading(0));
    expect(got).toEqual({ hours: 100, anchoredOnCurrentReading: false });
  });

  it("treats a stored target of ZERO as a real target", () => {
    const got = anchorDueHours(meterPlan({ frequencyInterval: null, nextDueHours: 0 }), reading(0));
    expect(got).toEqual({ hours: 0, anchoredOnCurrentReading: false });
  });

  it("is null with no completion, no target and no reading to anchor on", () => {
    expect(anchorDueHours(meterPlan(), reading(null))).toBeNull();
  });

  it("is null with no interval and no stored target", () => {
    expect(anchorDueHours(meterPlan({ frequencyInterval: null }), reading(5000))).toBeNull();
  });
});

describe("meterStatus", () => {
  it("is DUE when the reading has reached the target", () => {
    const got = meterStatus(meterPlan({ lastCompletedHours: 4300 }), reading(4820));
    expect(got.state).toBe("due");
    expect(got.dueAtHours).toBe(4800);
    expect(got.currentHours).toBe(4820);
    expect(got.hoursRemaining).toBe(-20);
    expect(got.reason).toBeNull();
  });

  it("is DUE on the exact target reading, not one hour later", () => {
    // The interval is a target, and hitting it exactly is due. `>` rather than
    // `>=` would leave a PM one hour short of due for ever on a stopped meter.
    const got = meterStatus(meterPlan({ lastCompletedHours: 4300 }), reading(4800));
    expect(got.state).toBe("due");
    expect(got.hoursRemaining).toBe(0);
  });

  it("is NOT DUE while the reading is short of the target", () => {
    const got = meterStatus(meterPlan({ lastCompletedHours: 17800, frequencyInterval: 1000 }), reading(18240));
    expect(got.state).toBe("not-due");
    expect(got.dueAtHours).toBe(18800);
    expect(got.hoursRemaining).toBe(560);
  });

  it("is UNKNOWN — not 'not due' — when the asset has no reading", () => {
    // The single most important case in this file. A blank hourmeter means a
    // PM that can never come due, and reporting it as "not due" is exactly the
    // silent failure the three-state design exists to prevent.
    const got = meterStatus(meterPlan({ lastCompletedHours: 4300 }), reading(null));
    expect(got.state).toBe("unknown");
    expect(got.reason).toBe("no-reading");
    // The target is still reported, so a screen can say what it is due at even
    // though it cannot say whether it is due.
    expect(got.dueAtHours).toBe(4800);
    expect(got.currentHours).toBeNull();
    expect(got.hoursRemaining).toBeNull();
  });

  it("is UNKNOWN when there is no linked asset at all", () => {
    const got = meterStatus(meterPlan({ lastCompletedHours: 4300 }), UNLINKED_METER_READING);
    expect(got.state).toBe("unknown");
    expect(got.reason).toBe("no-equipment");
  });

  it("is UNKNOWN when nothing says what reading it is due at", () => {
    const got = meterStatus(meterPlan({ frequencyInterval: null }), reading(5000));
    expect(got.state).toBe("unknown");
    expect(got.reason).toBe("no-target");
  });

  it("reports no-reading rather than no-target when BOTH are missing", () => {
    // The reading is the fixable one and the one that matters — an asset
    // nobody is reading is the actual problem.
    const got = meterStatus(meterPlan({ frequencyInterval: null }), reading(null));
    expect(got.state).toBe("unknown");
    expect(got.reason).toBe("no-reading");
  });

  it("treats a ZERO reading as real, not as missing", () => {
    // A new machine at 0 hours: not due, and NOT a fault.
    const got = meterStatus(
      meterPlan({ frequencyInterval: 100, lastCompletedHours: 0 }),
      reading(0),
    );
    expect(got.state).toBe("not-due");
    expect(got.reason).toBeNull();
    expect(got.hoursRemaining).toBe(100);
  });

  it("is DUE at zero when the target is zero and the reading is zero", () => {
    const got = meterStatus(meterPlan({ frequencyInterval: null, nextDueHours: 0 }), reading(0));
    expect(got.state).toBe("due");
  });

  it("reports nothing at all for an INACTIVE schedule", () => {
    // Basis-independent: an inactive schedule projects nothing. Note it does
    // NOT report a fault for a blank reading either — a retired schedule is
    // meant to be dormant, and flagging it would be noise.
    const got = meterStatus(meterPlan({ active: false }), reading(null));
    expect(got.applies).toBe(false);
    expect(got.state).toBe("not-due");
    expect(got.reason).toBeNull();
  });

  it("an inactive schedule is not due even when the reading is well past", () => {
    const got = meterStatus(
      meterPlan({ active: false, lastCompletedHours: 1000 }),
      reading(99_999),
    );
    expect(got.state).toBe("not-due");
    expect(got.applies).toBe(false);
  });

  it("does not apply to a calendar schedule", () => {
    const got = meterStatus(plan({ nextDueDate: d("2026-06-01") }), reading(5000));
    expect(got.applies).toBe(false);
  });

  it("flags a reading that has gone stale, and says how old it is", () => {
    // 250-hour interval → stale after max(7, ceil(250/24)) = 11 days.
    const got = meterStatus(
      meterPlan({ frequencyInterval: 250, lastCompletedHours: 800 }),
      reading(940, "2026-05-01"),
      d("2026-06-15"),
    );
    expect(got.state).toBe("not-due");
    expect(got.stale).toBe(true);
    expect(got.readingAgeDays).toBe(45);
  });

  it("does not flag a reading inside the window", () => {
    const got = meterStatus(
      meterPlan({ frequencyInterval: 250, lastCompletedHours: 800 }),
      reading(940, "2026-06-10"),
      d("2026-06-15"),
    );
    expect(got.stale).toBe(false);
    expect(got.readingAgeDays).toBe(5);
  });

  it("never calls a reading stale inside a week, however tight the interval", () => {
    // A 40-hour interval is under two days at full duty. Flagging every asset
    // not edited yesterday would make the warning worthless.
    const got = meterStatus(
      meterPlan({ frequencyInterval: 40, lastCompletedHours: 0 }),
      reading(10, "2026-06-10"),
      d("2026-06-16"),
    );
    expect(got.readingAgeDays).toBe(6);
    expect(got.stale).toBe(false);
  });

  it("cannot judge staleness without a `now` to measure against", () => {
    const got = meterStatus(
      meterPlan({ frequencyInterval: 250, lastCompletedHours: 800 }),
      reading(940, "2020-01-01"),
    );
    expect(got.readingAgeDays).toBeNull();
    expect(got.stale).toBe(false);
  });

  it("never reports a negative reading age for a row edited in the future", () => {
    const got = meterStatus(
      meterPlan({ lastCompletedHours: 4300 }),
      reading(4400, "2026-06-20"),
      d("2026-06-15"),
    );
    expect(got.readingAgeDays).toBe(0);
  });
});

describe("meterReadingStaleAfterDays", () => {
  it("is the interval at full duty, floored at a week", () => {
    expect(meterReadingStaleAfterDays(meterPlan({ frequencyInterval: 500 }))).toBe(21);
    expect(meterReadingStaleAfterDays(meterPlan({ frequencyInterval: 250 }))).toBe(11);
    expect(meterReadingStaleAfterDays(meterPlan({ frequencyInterval: 40 }))).toBe(
      MIN_STALE_READING_DAYS,
    );
  });

  it("is null with no hours interval to measure against", () => {
    expect(meterReadingStaleAfterDays(meterPlan({ frequencyInterval: null }))).toBeNull();
    expect(meterReadingStaleAfterDays(plan())).toBeNull();
  });

  it("assumes the fastest a meter can plausibly move", () => {
    // Documented as the LEAST alarmist honest window: a machine on one shift
    // takes four times as long, so anything shorter would need a duty figure
    // nobody has recorded.
    expect(MAX_METER_HOURS_PER_DAY).toBe(24);
  });
});

describe("isMeterDue", () => {
  it("agrees with meterStatus", () => {
    expect(isMeterDue(meterPlan({ lastCompletedHours: 4300 }), reading(4820))).toBe(true);
    expect(isMeterDue(meterPlan({ lastCompletedHours: 4300 }), reading(4000))).toBe(false);
    // "Can't tell" is not "due" — but it is not a quiet "fine" either, which is
    // why nothing user-facing uses this shorthand on its own.
    expect(isMeterDue(meterPlan({ lastCompletedHours: 4300 }), reading(null))).toBe(false);
  });
});

describe("isOverdue / isVisible on a meter schedule", () => {
  it("are true when the reading has reached the target", () => {
    const s = meterPlan({ lastCompletedHours: 4300 });
    expect(isOverdue(s, d("2026-06-15"), reading(4820))).toBe(true);
    expect(isVisible(s, d("2026-06-15"), reading(4820))).toBe(true);
  });

  it("are false while it is short of the target", () => {
    const s = meterPlan({ lastCompletedHours: 4300 });
    expect(isOverdue(s, d("2026-06-15"), reading(4000))).toBe(false);
    expect(isVisible(s, d("2026-06-15"), reading(4000))).toBe(false);
  });

  it("are false without a reading — which is why nothing user-facing relies on them", () => {
    // A boolean has no third answer to give. `meterStatus` is the one that can
    // say "can't tell", and every screen uses that instead.
    const s = meterPlan({ lastCompletedHours: 4300 });
    expect(isOverdue(s, d("2026-06-15"))).toBe(false);
    expect(isVisible(s, d("2026-06-15"))).toBe(false);
  });

  it("are false for an inactive meter schedule however far past it is", () => {
    const s = meterPlan({ active: false, lastCompletedHours: 100 });
    expect(isOverdue(s, d("2026-06-15"), reading(99_999))).toBe(false);
    expect(isVisible(s, d("2026-06-15"), reading(99_999))).toBe(false);
  });

  it("ignore GraceDays and LeadTimeDays entirely", () => {
    // Both are in DAYS and are deliberately NOT reused as hours — three grace
    // days is not three grace hours. A meter PM is due the moment the reading
    // reaches the target, whatever these hold.
    const s = meterPlan({ lastCompletedHours: 4300, graceDays: 90, leadTimeDays: 90 });
    expect(isOverdue(s, d("2026-06-15"), reading(4800))).toBe(true);
    expect(isVisible(s, d("2026-06-15"), reading(4799))).toBe(false);
  });
});

describe("advanceMeterSchedule", () => {
  it("stamps the completion reading and recomputes the target from it", () => {
    expect(advanceMeterSchedule(meterPlan({ lastCompletedHours: 4300 }), 5340)).toEqual({
      lastCompletedHours: 5340,
      nextDueHours: 5840,
    });
  });

  it("advances from the reading it was DONE at, not the target it was due at", () => {
    // Due at 4,800 and actually done at 5,340 → next due 5,840, not 5,300. The
    // wear clock restarts when the oil is changed; the other way round would
    // make a late job permanently late.
    const got = advanceMeterSchedule(meterPlan({ lastCompletedHours: 4300 }), 5340);
    expect(got?.nextDueHours).toBe(5840);
    expect(got?.nextDueHours).not.toBe(5300);
  });

  it("accepts a completion reading of ZERO", () => {
    expect(advanceMeterSchedule(meterPlan({ frequencyInterval: 100 }), 0)).toEqual({
      lastCompletedHours: 0,
      nextDueHours: 100,
    });
  });

  it("is null without a reading — nothing is written rather than blanking a column", () => {
    expect(advanceMeterSchedule(meterPlan(), null)).toBeNull();
    expect(advanceMeterSchedule(meterPlan(), Number.NaN)).toBeNull();
  });

  it("is null for an inactive schedule", () => {
    expect(advanceMeterSchedule(meterPlan({ active: false }), 5340)).toBeNull();
  });

  it("is null with no usable hours interval", () => {
    expect(advanceMeterSchedule(meterPlan({ frequencyInterval: null }), 5340)).toBeNull();
    expect(advanceMeterSchedule(meterPlan({ frequencyInterval: 0 }), 5340)).toBeNull();
  });

  it("is null for a calendar schedule", () => {
    expect(advanceMeterSchedule(plan({ nextDueDate: d("2026-06-01") }), 5340)).toBeNull();
  });

  it("is null for an Hourmeter basis whose unit is a date unit", () => {
    // `isMeterSchedule` says yes (the basis), but there is no hours interval to
    // add — so nothing is written, which is the safe half of that tolerance.
    expect(advanceMeterSchedule(meterPlan({ frequencyUnit: "Months" }), 5340)).toBeNull();
  });
});

describe("meterReadingFor", () => {
  const asset = { lookupId: 7, currentMachineHours: 1180, modifiedAt: d("2026-06-10") };

  it("finds the asset and reads its hours", () => {
    const got = meterReadingFor({ lookupId: 7 }, meterAssetIndex([asset]));
    expect(got).toEqual({ linked: true, hours: 1180, readingAsOf: d("2026-06-10") });
  });

  it("keeps a ZERO reading as zero", () => {
    const zero = { lookupId: 9, currentMachineHours: 0, modifiedAt: null };
    expect(meterReadingFor({ lookupId: 9 }, meterAssetIndex([zero])).hours).toBe(0);
  });

  it("keeps a null reading as null", () => {
    const blank = { lookupId: 3, currentMachineHours: null, modifiedAt: null };
    const got = meterReadingFor({ lookupId: 3 }, meterAssetIndex([blank]));
    expect(got.linked).toBe(true);
    expect(got.hours).toBeNull();
  });

  it("is UNLINKED with no equipment reference", () => {
    expect(meterReadingFor(null, meterAssetIndex([asset]))).toEqual(UNLINKED_METER_READING);
  });

  it("is UNLINKED when the reference points at an asset that is not in the register", () => {
    // Same fault from the schedule's point of view: there is no hourmeter this
    // can ever be compared against.
    expect(meterReadingFor({ lookupId: 999 }, meterAssetIndex([asset]))).toEqual(
      UNLINKED_METER_READING,
    );
  });
});

describe("frequencyLabel for run hours", () => {
  it("says run hours, so an interval cannot read as a calendar one", () => {
    expect(frequencyLabel(500, "Hours")).toBe("Every 500 run hours");
    expect(frequencyLabel(1, "Hours")).toBe("Every run hour");
  });
});

describe("formatMeterHours", () => {
  it("groups thousands and names the unit", () => {
    expect(formatMeterHours(5043)).toBe("5,043 hrs");
    expect(formatMeterHours(0)).toBe("0 hrs");
    expect(formatMeterHours(120.6)).toBe("121 hrs");
  });

  it("is a dash for nothing at all", () => {
    expect(formatMeterHours(null)).toBe("—");
    expect(formatMeterHours(Number.NaN)).toBe("—");
  });
});

describe("meterStatusLine", () => {
  it("reads target, reading, gap", () => {
    const status = meterStatus(meterPlan({ lastCompletedHours: 4700 }), reading(5043));
    expect(meterStatusLine(status)).toBe("Due at 5,200 hrs · now 5,043 hrs · 157 to go");
  });

  it("says how far past due it is", () => {
    const status = meterStatus(meterPlan({ lastCompletedHours: 4300 }), reading(4820));
    expect(meterStatusLine(status)).toBe("Due at 4,800 hrs · now 4,820 hrs · 20 hrs past due");
  });

  it("says due now on the exact target", () => {
    const status = meterStatus(meterPlan({ lastCompletedHours: 4300 }), reading(4800));
    expect(meterStatusLine(status)).toContain("due now");
  });

  it("names the fault when the state cannot be told", () => {
    const noAsset = meterStatus(meterPlan({ lastCompletedHours: 1 }), UNLINKED_METER_READING);
    expect(meterStatusLine(noAsset)).toBe("No asset linked — this schedule can never come due.");

    const noReading = meterStatus(meterPlan({ lastCompletedHours: 4300 }), reading(null));
    expect(meterStatusLine(noReading)).toContain("no hourmeter reading");
    expect(meterStatusLine(noReading)).toContain("4,800 hrs");

    const blank = meterStatus(meterPlan({ frequencyInterval: null }), reading(null));
    expect(meterStatusLine(blank)).toContain("can't tell");

    const noTarget = meterStatus(meterPlan({ frequencyInterval: null }), reading(5000));
    expect(meterStatusLine(noTarget)).toBe(
      "No due reading set — record a completion reading, or set one on the schedule.",
    );
  });

  it("is empty for a schedule it does not apply to", () => {
    expect(meterStatusLine(meterStatus(meterPlan({ active: false }), reading(5000)))).toBe("");
    expect(meterStatusLine(meterStatus(plan(), reading(5000)))).toBe("");
  });
});
