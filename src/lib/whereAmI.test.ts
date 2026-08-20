import { describe, it, expect } from "vitest";
import type { GraphListItem, WhereAmIEntry } from "@/types/task";
import {
  buildWhereAmIFields,
  compareByDate,
  datesInRange,
  filterWhereAmI,
  groupByDay,
  MAX_RANGE_DAYS,
  toWhereAmIEntry,
  upcomingEntries,
  WHERE_AM_I_SELECT,
} from "./whereAmI";

// Column names and stored shapes come from the live list —
// scripts/where-am-i-schema.json, captured 2026-08-19.

function item(fields: Record<string, unknown>, id = "1"): GraphListItem {
  return { id, fields } as unknown as GraphListItem;
}

function entry(title: string, iso: string | null, id = 1): WhereAmIEntry {
  return {
    id,
    title,
    date: iso ? new Date(iso) : null,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };
}

describe("toWhereAmIEntry", () => {
  // The real rows store the date at 06:00Z — local midnight in US Central,
  // this site's regional setting. Two other ARC lists store 22:00Z and 23:00Z;
  // the same midday pivot reads all three as the day SharePoint shows.
  it("reads the day the SharePoint view shows", () => {
    const e = toWhereAmIEntry(item({ Title: "In the Field", Date: "2023-11-10T06:00:00Z" }));
    expect(e.date?.getUTCDate()).toBe(10);
    expect(e.date?.getUTCMonth()).toBe(10); // November
  });

  it("keeps the title as typed", () => {
    expect(toWhereAmIEntry(item({ Title: "  Sarah - half day vacation  " })).title).toBe(
      "Sarah - half day vacation",
    );
  });

  it("copes with a row that somehow has no date", () => {
    expect(toWhereAmIEntry(item({ Title: "x" })).date).toBeNull();
  });

  it("selects only the columns it uses", () => {
    expect(WHERE_AM_I_SELECT).toBe("Title,Date,Created,Modified");
  });
});

describe("buildWhereAmIFields", () => {
  it("writes the title trimmed and the date at midday UTC", () => {
    expect(
      buildWhereAmIFields({ title: "  Ray - field  ", date: new Date("2026-08-19T12:00:00Z") }),
    ).toEqual({ Title: "Ray - field", Date: "2026-08-19T12:00:00Z" });
  });

  it("sends a null date rather than an invalid one", () => {
    expect(buildWhereAmIFields({ title: "x", date: null }).Date).toBeNull();
  });
});

describe("ordering and grouping", () => {
  const entries = [
    entry("Later", "2026-08-21T12:00:00Z", 1),
    entry("Sooner", "2026-08-19T12:00:00Z", 2),
    entry("Also sooner", "2026-08-19T12:00:00Z", 3),
    entry("No date", null, 4),
  ];

  it("sorts soonest first, undated last", () => {
    // Within a day the tiebreak is the title, so the order is stable rather
    // than list-order — "Also sooner" (3) precedes "Sooner" (2).
    expect([...entries].sort(compareByDate).map((e) => e.id)).toEqual([3, 2, 1, 4]);
  });

  it("groups by day and drops the undated", () => {
    const byDay = groupByDay(entries);
    expect(byDay.get("2026-08-19")?.map((e) => e.id)).toEqual([3, 2]); // alphabetical within a day
    expect([...byDay.values()].flat().map((e) => e.id)).not.toContain(4);
  });
});

describe("upcomingEntries", () => {
  const now = new Date("2026-08-19T15:00:00Z");
  const entries = [
    entry("Yesterday", "2026-08-18T12:00:00Z", 1),
    entry("Today", "2026-08-19T12:00:00Z", 2),
    entry("Tomorrow", "2026-08-20T12:00:00Z", 3),
  ];

  // Today is included, not skipped: "who's out today" is the question the
  // phone view exists to answer, and an entry doesn't expire at 00:01.
  it("keeps today and drops what's past", () => {
    expect(upcomingEntries(entries, now).map((e) => e.title)).toEqual(["Today", "Tomorrow"]);
  });

  it("is still correct late in the day, whatever the clock says", () => {
    const lateEvening = new Date("2026-08-19T23:59:00Z");
    expect(upcomingEntries(entries, lateEvening).map((e) => e.title)).toContain("Today");
  });
});

describe("filterWhereAmI", () => {
  const entries = [
    entry("Sarah - half day vacation", "2026-08-19T12:00:00Z", 1),
    entry("GaryK Keystone AM", "2026-08-20T12:00:00Z", 2),
  ];

  it("matches on any word, in any order", () => {
    expect(filterWhereAmI(entries, "vacation sarah")).toHaveLength(1);
  });

  it("returns everything for an empty query", () => {
    expect(filterWhereAmI(entries, "  ")).toHaveLength(2);
  });
});

describe("datesInRange", () => {
  // The list has no end date, so a week away is a row per day — this is what
  // the add form expands a range into.
  it("covers both ends of the range", () => {
    const days = datesInRange(new Date("2026-08-19T12:00:00Z"), new Date("2026-08-21T12:00:00Z"));
    expect(days.map((d) => d.getUTCDate())).toEqual([19, 20, 21]);
  });

  it("is a single day when both ends match", () => {
    const day = new Date("2026-08-19T12:00:00Z");
    expect(datesInRange(day, day)).toHaveLength(1);
  });

  it("crosses a month boundary", () => {
    const days = datesInRange(new Date("2026-08-30T12:00:00Z"), new Date("2026-09-02T12:00:00Z"));
    expect(days).toHaveLength(4);
    expect(days[3].getUTCMonth()).toBe(8); // September
  });

  it("is empty when the end is before the start", () => {
    expect(datesInRange(new Date("2026-08-21T12:00:00Z"), new Date("2026-08-19T12:00:00Z"))).toEqual([]);
  });

  // A mistyped year shouldn't write thousands of rows to a shared calendar.
  it("caps a runaway range", () => {
    const days = datesInRange(new Date("2026-08-19T12:00:00Z"), new Date("2036-08-19T12:00:00Z"));
    expect(days).toHaveLength(MAX_RANGE_DAYS);
  });

  it("normalises every day to midday UTC", () => {
    for (const d of datesInRange(new Date("2026-08-19T06:00:00Z"), new Date("2026-08-21T23:00:00Z"))) {
      expect(d.getUTCHours()).toBe(12);
    }
  });
});
