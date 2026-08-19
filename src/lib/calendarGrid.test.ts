import { describe, it, expect } from "vitest";
import {
  calendarDays,
  currentMonthStart,
  dayKey,
  dayLabel,
  monthKey,
  monthLabel,
  parseMonthKey,
  relativeDayLabel,
  shiftMonth,
  WEEKDAYS,
} from "./calendarGrid";

// Everything here is UTC on purpose: a date-only SharePoint value is held at
// midday UTC, and local getters would put every entry a day earlier for anyone
// west of Greenwich — which is everyone at Altronic.

const AUG_2026 = new Date(Date.UTC(2026, 7, 1));

describe("calendarDays", () => {
  it("covers whole weeks, Sunday to Saturday", () => {
    const days = calendarDays(AUG_2026);
    expect(days.length % 7).toBe(0);
    expect(days[0].getUTCDay()).toBe(0);
    expect(days[days.length - 1].getUTCDay()).toBe(6);
  });

  it("includes every day of the month", () => {
    expect(calendarDays(AUG_2026).filter((d) => d.getUTCMonth() === 7)).toHaveLength(31);
  });

  it("pads with the neighbouring months", () => {
    const days = calendarDays(AUG_2026);
    expect(days.some((d) => d.getUTCMonth() === 6)).toBe(true);
    expect(days.some((d) => d.getUTCMonth() === 8)).toBe(true);
  });

  it("starts on the 1st when the month starts on a Sunday", () => {
    const days = calendarDays(new Date(Date.UTC(2026, 1, 1))); // February 2026
    expect(days[0].getUTCDate()).toBe(1);
  });

  it("handles a leap February", () => {
    const days = calendarDays(new Date(Date.UTC(2028, 1, 1)));
    expect(days.filter((d) => d.getUTCMonth() === 1)).toHaveLength(29);
  });

  it("labels the columns starting on Sunday", () => {
    expect(WEEKDAYS[0]).toBe("Sun");
    expect(WEEKDAYS).toHaveLength(7);
  });
});

describe("keys and parsing", () => {
  it("keys a month and a day in UTC", () => {
    expect(monthKey(new Date("2026-08-11T12:00:00Z"))).toBe("2026-08");
    expect(dayKey(new Date("2026-08-11T12:00:00Z"))).toBe("2026-08-11");
  });

  it("parses a month key", () => {
    expect(monthKey(parseMonthKey("2026-03"))).toBe("2026-03");
  });

  it("falls back to this month for anything unparseable", () => {
    const now = new Date(Date.UTC(2026, 7, 19));
    expect(monthKey(parseMonthKey(null, now))).toBe("2026-08");
    expect(monthKey(parseMonthKey("nonsense", now))).toBe("2026-08");
    expect(monthKey(parseMonthKey("2026-13", now))).toBe("2026-08");
  });

  it("shifts months across a year boundary", () => {
    expect(monthKey(shiftMonth(new Date(Date.UTC(2026, 0, 1)), -1))).toBe("2025-12");
    expect(monthKey(shiftMonth(new Date(Date.UTC(2026, 11, 1)), 1))).toBe("2027-01");
  });

  it("knows the current month", () => {
    expect(monthKey(currentMonthStart(new Date(Date.UTC(2026, 4, 30))))).toBe("2026-05");
  });
});

describe("labels", () => {
  it("names a month and a day", () => {
    expect(monthLabel(AUG_2026)).toMatch(/August.*2026/);
    expect(dayLabel(new Date("2026-08-12T12:00:00Z"))).toMatch(/Wednesday.*12/);
  });

  // On a phone "who's out today" is the actual question, so the agenda says
  // Today and Tomorrow rather than making the reader check a date.
  it("says Today and Tomorrow before falling back to a date", () => {
    const now = new Date("2026-08-19T09:00:00Z");
    expect(relativeDayLabel(new Date("2026-08-19T12:00:00Z"), now)).toBe("Today");
    expect(relativeDayLabel(new Date("2026-08-20T12:00:00Z"), now)).toBe("Tomorrow");
    expect(relativeDayLabel(new Date("2026-08-21T12:00:00Z"), now)).toMatch(/Aug.*21/);
  });

  it("rolls Tomorrow over a month end", () => {
    const now = new Date("2026-08-31T09:00:00Z");
    expect(relativeDayLabel(new Date("2026-09-01T12:00:00Z"), now)).toBe("Tomorrow");
  });
});
