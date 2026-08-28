import { describe, expect, it } from "vitest";
import {
  matchesMaintenanceCalendarFilters,
  splitFilterValues,
  type MaintenanceCalendarEntry,
  type MaintenanceCalendarFilters,
} from "./maintenanceCalendar";

// =============================================================================
// The calendar and the work-order list/board share URL parameter NAMES but not
// their shapes: `useMaintenanceFilters` (list + board) is multi-select and
// writes `assigned=a@x.com,b@x.com`, while the calendar's own pickers set one
// value at a time.
//
// A link therefore travels from the list to the calendar carrying more values
// than the calendar's controls can express. The failure this guards against is
// the silent one: comparing the whole raw string matches nobody, so the
// calendar renders empty while its filter bar still looks active — which reads
// as "there is no maintenance due" rather than "this filter didn't survive".
// =============================================================================

function entry(over: Partial<MaintenanceCalendarEntry> = {}): MaintenanceCalendarEntry {
  return {
    key: "wo-1",
    kind: "work-order",
    taskId: 1,
    scheduleId: null,
    title: "Replace drive belt",
    date: new Date(Date.UTC(2026, 8, 3, 12)),
    overdue: false,
    status: "Backlog",
    priority: null,
    assigned: { displayName: "Dana Ruiz", email: "dana.ruiz@altronic-llc.com" },
    equipment: { lookupId: 2, title: "20 HP COMPRESSOR" },
    ...over,
  } as MaintenanceCalendarEntry;
}

const base: MaintenanceCalendarFilters = { type: "both", assigned: "", equipment: "" };

describe("splitFilterValues", () => {
  it("reads a single value as a one-item list", () => {
    expect(splitFilterValues("dana.ruiz@altronic-llc.com")).toEqual(["dana.ruiz@altronic-llc.com"]);
  });

  it("splits a comma-separated list and trims", () => {
    expect(splitFilterValues("a@x.com, b@x.com")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("drops empties rather than producing blank keys", () => {
    expect(splitFilterValues(",a@x.com,,")).toEqual(["a@x.com"]);
  });

  it("is empty for an empty param", () => {
    expect(splitFilterValues("")).toEqual([]);
  });
});

describe("calendar filters accept the list view's multi-value params", () => {
  it("matches when the assignee is one of several carried over", () => {
    const filters = { ...base, assigned: "someone.else@altronic-llc.com,dana.ruiz@altronic-llc.com" };
    expect(matchesMaintenanceCalendarFilters(entry(), filters)).toBe(true);
  });

  it("still excludes an assignee who is not in the list", () => {
    const filters = { ...base, assigned: "someone.else@altronic-llc.com,third@altronic-llc.com" };
    expect(matchesMaintenanceCalendarFilters(entry(), filters)).toBe(false);
  });

  it("matches when the equipment id is one of several carried over", () => {
    expect(matchesMaintenanceCalendarFilters(entry(), { ...base, equipment: "7,2,9" })).toBe(true);
  });

  it("still excludes equipment that is not in the list", () => {
    expect(matchesMaintenanceCalendarFilters(entry(), { ...base, equipment: "7,9" })).toBe(false);
  });

  it("a single value keeps working exactly as before", () => {
    const filters = { ...base, assigned: "dana.ruiz@altronic-llc.com" };
    expect(matchesMaintenanceCalendarFilters(entry(), filters)).toBe(true);
    expect(matchesMaintenanceCalendarFilters(entry(), { ...filters, assigned: "nope@x.com" })).toBe(
      false,
    );
  });

  it("an entry with no assignee is excluded by any assignee filter", () => {
    const filters = { ...base, assigned: "a@x.com,b@x.com" };
    expect(matchesMaintenanceCalendarFilters(entry({ assigned: null }), filters)).toBe(false);
  });
});
