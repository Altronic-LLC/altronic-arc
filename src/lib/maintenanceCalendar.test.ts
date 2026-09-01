import { describe, expect, it } from "vitest";
import type { MaintenanceTask, Person, ScheduledMaintenance } from "@/types/task";
import {
  AGENDA_HORIZON_DAYS,
  buildMaintenanceAgenda,
  buildMaintenanceCalendarMonth,
  collectMaintenanceEntries,
  EMPTY_MAINTENANCE_CALENDAR_FILTERS,
  groupMaintenanceByDay,
  maintenanceAssigneeOptions,
  maintenanceEquipmentOptions,
  matchesMaintenanceCalendarFilters,
  overdueMaintenanceEntries,
  sortMaintenanceEntries,
  workOrderEntry,
} from "./maintenanceCalendar";

// Every date here is midday UTC, the storage convention for a date-only
// column — the same normalisation parseSpDateOnly applies on read.
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

const ALYSSA: Person = { displayName: "Alyssa Reed", email: "alyssa@altronic-llc.com" };
const ERIC: Person = { displayName: "Eric Vance", email: "eric@altronic-llc.com" };

function task(over: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    id: 1,
    woNumber: "WO-2026-0001",
    title: "Fix the compressor",
    description: "",
    status: "Backlog",
    priority: null,
    category: null,
    department: null,
    location: null,
    operationsProject: null,
    taskType: "Request",
    dueStatus: null,
    startDate: null,
    dueDate: utc(2026, 9, 10),
    completedDate: null,
    equipment: null,
    scheduleRef: null,
    operationsTaskRef: null,
    assigned: null,
    reportedBy: null,
    completedBy: null,
    watchers: [],
    techNotes: "",
    failureCause: "",
    resolution: "",
    partsUsed: "",
    laborHours: null,
    downtimeHours: null,
    comments: [],
    hasAttachments: false,
    createdAt: utc(2026, 9, 1),
    modifiedAt: utc(2026, 9, 1),
    ...over,
  };
}

function schedule(over: Partial<ScheduledMaintenance> = {}): ScheduledMaintenance {
  return {
    id: 100,
    title: "Weekly compressor walkaround",
    instructions: "",
    category: "Preventive",
    priority: "Med",
    equipment: null,
    frequencyInterval: 1,
    frequencyUnit: "Weeks",
    department: null,
    location: null,
    operationsProject: null,
    scheduleBasis: "Fixed",
    firstDueDate: utc(2026, 9, 2),
    nextDueDate: utc(2026, 9, 2),
    lastCompleted: null,
    assignedTo: null,
    lastCompletedBy: null,
    watchers: [],
    timeNeeded: null,
    graceDays: null,
    leadTimeDays: null,
    active: true,
    requiresShutdown: false,
    lotoRequired: false,
    hasAttachments: false,
    createdAt: utc(2026, 8, 1),
    modifiedAt: utc(2026, 8, 1),
    ...over,
  };
}

const SEPTEMBER = new Date(Date.UTC(2026, 8, 1));
const MID_SEPTEMBER = utc(2026, 9, 15);

describe("workOrderEntry", () => {
  it("has no place on a calendar without a due date", () => {
    expect(workOrderEntry(task({ dueDate: null }), MID_SEPTEMBER)).toBeNull();
  });

  it("marks an open work order past its due date overdue", () => {
    const entry = workOrderEntry(task({ dueDate: utc(2026, 9, 3) }), MID_SEPTEMBER);
    expect(entry?.overdue).toBe(true);
    expect(entry?.kind).toBe("work-order");
    expect(entry?.day).toBe("2026-09-03");
  });

  it("never calls a CLOSED work order overdue — it is done, not late", () => {
    for (const status of ["Complete", "Canceled"] as const) {
      const entry = workOrderEntry(task({ dueDate: utc(2026, 9, 3), status }), MID_SEPTEMBER);
      expect(entry?.overdue).toBe(false);
    }
  });

  it("carries a status; a projection deliberately does not", () => {
    const entry = workOrderEntry(task({ status: "Started" }), MID_SEPTEMBER);
    expect(entry?.status).toBe("Started");
    const [projected] = collectMaintenanceEntries({
      tasks: [],
      schedules: [schedule()],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 3),
      now: utc(2026, 9, 1),
    });
    expect(projected.kind).toBe("projected");
    expect(projected.status).toBeNull();
    expect(projected.task).toBeNull();
  });
});

describe("collectMaintenanceEntries", () => {
  it("merges real work orders and projected occurrences into one list", () => {
    const entries = collectMaintenanceEntries({
      tasks: [task({ id: 7, dueDate: utc(2026, 9, 10) })],
      schedules: [schedule()],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 1),
    });
    expect(entries.filter((e) => e.kind === "work-order")).toHaveLength(1);
    // 2, 9, 16, 23, 30 September — weekly from the 2nd.
    expect(entries.filter((e) => e.kind === "projected").map((e) => e.day)).toEqual([
      "2026-09-02",
      "2026-09-09",
      "2026-09-16",
      "2026-09-23",
      "2026-09-30",
    ]);
  });

  it("projects NOTHING for an inactive schedule", () => {
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [schedule({ active: false })],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 1),
    });
    expect(entries).toEqual([]);
  });

  it("suppresses a projection once a work order exists for that schedule on that day", () => {
    const logged = task({ id: 9, dueDate: utc(2026, 9, 9), scheduleRef: { lookupId: 100, title: "" } });
    const entries = collectMaintenanceEntries({
      tasks: [logged],
      schedules: [schedule()],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 1),
    });
    const ninth = entries.filter((e) => e.day === "2026-09-09");
    expect(ninth).toHaveLength(1);
    expect(ninth[0].kind).toBe("work-order");
  });

  it("suppresses only THAT day — the rest of the schedule still projects", () => {
    const logged = task({ id: 9, dueDate: utc(2026, 9, 9), scheduleRef: { lookupId: 100, title: "" } });
    const entries = collectMaintenanceEntries({
      tasks: [logged],
      schedules: [schedule()],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 1),
    });
    expect(entries.filter((e) => e.kind === "projected").map((e) => e.day)).toEqual([
      "2026-09-02",
      "2026-09-16",
      "2026-09-23",
      "2026-09-30",
    ]);
  });

  it("a work order on ANOTHER schedule doesn't suppress this one's occurrence", () => {
    const other = task({ id: 9, dueDate: utc(2026, 9, 9), scheduleRef: { lookupId: 999, title: "" } });
    const entries = collectMaintenanceEntries({
      tasks: [other],
      schedules: [schedule()],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 1),
    });
    expect(entries.some((e) => e.kind === "projected" && e.day === "2026-09-09")).toBe(true);
  });

  it("keeps an OVERDUE occurrence on the day it was due — it never rolls forward", () => {
    // Outstanding since 2 September, still nothing logged on 20 September.
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [schedule()],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 20),
    });
    const anchor = entries.find((e) => e.day === "2026-09-02");
    expect(anchor).toBeDefined();
    expect(anchor?.overdue).toBe(true);
    // And it has NOT been re-dated to today.
    expect(entries.some((e) => e.day === "2026-09-20")).toBe(false);
  });

  it("only the outstanding occurrence is marked overdue, never a future one", () => {
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [schedule()],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 20),
    });
    const future = entries.filter((e) => e.day !== "2026-09-02");
    expect(future.length).toBeGreaterThan(0);
    expect(future.some((e) => e.overdue)).toBe(false);
  });

  it("respects grace days before calling an occurrence late", () => {
    const withGrace = schedule({ graceDays: 5 });
    const inGrace = collectMaintenanceEntries({
      tasks: [],
      schedules: [withGrace],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 6),
    });
    expect(inGrace.find((e) => e.day === "2026-09-02")?.overdue).toBe(false);

    const past = collectMaintenanceEntries({
      tasks: [],
      schedules: [withGrace],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 8),
    });
    expect(past.find((e) => e.day === "2026-09-02")?.overdue).toBe(true);
  });

  it("a schedule with dates but no frequency projects exactly one occurrence", () => {
    const oneOff = schedule({ frequencyInterval: null, frequencyUnit: null });
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [oneOff],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: utc(2026, 9, 1),
    });
    expect(entries).toHaveLength(1);
  });
});

describe("overdueMaintenanceEntries", () => {
  it("keeps late work visible whatever month the grid is on", () => {
    // Due back in July; the user is looking at September.
    const july = schedule({ firstDueDate: utc(2026, 7, 1), nextDueDate: utc(2026, 7, 1) });
    const month = buildMaintenanceCalendarMonth({
      monthStart: SEPTEMBER,
      tasks: [],
      schedules: [july],
      now: MID_SEPTEMBER,
      filters: EMPTY_MAINTENANCE_CALENDAR_FILTERS,
    });
    expect(month.overdue.map((e) => e.day)).toContain("2026-07-01");
    expect(month.overdue[0].overdue).toBe(true);
  });

  it("includes overdue OPEN work orders and excludes closed ones", () => {
    const entries = overdueMaintenanceEntries({
      tasks: [
        task({ id: 1, dueDate: utc(2026, 9, 1), status: "Started" }),
        task({ id: 2, dueDate: utc(2026, 9, 1), status: "Complete" }),
      ],
      schedules: [],
      now: MID_SEPTEMBER,
    });
    expect(entries.map((e) => e.key)).toEqual(["wo-1"]);
  });

  it("drops an overdue projection that has already been logged", () => {
    const entries = overdueMaintenanceEntries({
      tasks: [task({ id: 5, dueDate: utc(2026, 9, 2), scheduleRef: { lookupId: 100, title: "" }, status: "Started" })],
      schedules: [schedule()],
      now: MID_SEPTEMBER,
    });
    expect(entries.filter((e) => e.kind === "projected")).toEqual([]);
    expect(entries.map((e) => e.key)).toEqual(["wo-5"]);
  });

  it("says nothing about an inactive schedule, however old its due date", () => {
    const entries = overdueMaintenanceEntries({
      tasks: [],
      schedules: [schedule({ active: false, nextDueDate: utc(2020, 1, 1) })],
      now: MID_SEPTEMBER,
    });
    expect(entries).toEqual([]);
  });
});

describe("matchesMaintenanceCalendarFilters", () => {
  const entries = collectMaintenanceEntries({
    tasks: [
      task({ id: 1, dueDate: utc(2026, 9, 10), assigned: ALYSSA, equipment: { lookupId: 5, title: "Kitamura" } }),
      task({
        id: 2,
        dueDate: utc(2026, 9, 11),
        scheduleRef: { lookupId: 100, title: "" },
        assigned: ERIC,
      }),
    ],
    schedules: [schedule({ assignedTo: ERIC, equipment: { lookupId: 9, title: "Compressor" } })],
    from: utc(2026, 9, 1),
    to: utc(2026, 9, 30),
    now: utc(2026, 9, 1),
  });

  it("Both keeps everything", () => {
    const kept = entries.filter((e) =>
      matchesMaintenanceCalendarFilters(e, EMPTY_MAINTENANCE_CALENDAR_FILTERS),
    );
    expect(kept).toHaveLength(entries.length);
  });

  it("Scheduled keeps projections AND the work orders raised off a schedule", () => {
    const kept = entries.filter((e) =>
      matchesMaintenanceCalendarFilters(e, { ...EMPTY_MAINTENANCE_CALENDAR_FILTERS, type: "scheduled" }),
    );
    expect(kept.some((e) => e.kind === "work-order" && e.key === "wo-2")).toBe(true);
    expect(kept.some((e) => e.kind === "projected")).toBe(true);
    expect(kept.some((e) => e.key === "wo-1")).toBe(false);
  });

  it("One-off keeps only work orders with no schedule behind them", () => {
    const kept = entries.filter((e) =>
      matchesMaintenanceCalendarFilters(e, { ...EMPTY_MAINTENANCE_CALENDAR_FILTERS, type: "one-off" }),
    );
    expect(kept.map((e) => e.key)).toEqual(["wo-1"]);
  });

  it("filters by assignee across both kinds", () => {
    const kept = entries.filter((e) =>
      matchesMaintenanceCalendarFilters(e, {
        ...EMPTY_MAINTENANCE_CALENDAR_FILTERS,
        assigned: "eric@altronic-llc.com",
      }),
    );
    expect(kept.some((e) => e.kind === "projected")).toBe(true);
    expect(kept.every((e) => e.key !== "wo-1")).toBe(true);
  });

  it("filters by equipment, and drops entries with no asset at all", () => {
    const kept = entries.filter((e) =>
      matchesMaintenanceCalendarFilters(e, { ...EMPTY_MAINTENANCE_CALENDAR_FILTERS, equipment: "9" }),
    );
    expect(kept.every((e) => e.kind === "projected")).toBe(true);
    expect(kept.length).toBeGreaterThan(0);
  });
});

describe("sortMaintenanceEntries / groupMaintenanceByDay", () => {
  it("puts overdue first, then real work ahead of projections", () => {
    const sameDay = collectMaintenanceEntries({
      tasks: [task({ id: 3, dueDate: utc(2026, 9, 2), title: "Real job" })],
      schedules: [schedule({ id: 200, title: "Projected job" })],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 2),
      now: utc(2026, 9, 1),
    });
    const sorted = sortMaintenanceEntries(sameDay);
    expect(sorted.map((e) => e.kind)).toEqual(["work-order", "projected"]);
  });

  it("groups by yyyy-mm-dd", () => {
    const byDay = groupMaintenanceByDay(
      collectMaintenanceEntries({
        tasks: [],
        schedules: [schedule()],
        from: utc(2026, 9, 1),
        to: utc(2026, 9, 16),
        now: utc(2026, 9, 1),
      }),
    );
    expect([...byDay.keys()]).toEqual(["2026-09-02", "2026-09-09", "2026-09-16"]);
    expect(byDay.get("2026-09-09")).toHaveLength(1);
  });
});

describe("buildMaintenanceCalendarMonth", () => {
  it("builds whole weeks, so an entry on a padding day still shows", () => {
    // 1 September 2026 is a Tuesday, so the grid opens on Sunday 30 August.
    const month = buildMaintenanceCalendarMonth({
      monthStart: SEPTEMBER,
      tasks: [task({ id: 4, dueDate: utc(2026, 8, 31) })],
      schedules: [],
      now: utc(2026, 9, 1),
      filters: EMPTY_MAINTENANCE_CALENDAR_FILTERS,
    });
    expect(month.days[0].getUTCDay()).toBe(0);
    expect(month.byDay.get("2026-08-31")).toHaveLength(1);
  });

  it("applies the filters to the grid AND to the overdue list", () => {
    const month = buildMaintenanceCalendarMonth({
      monthStart: SEPTEMBER,
      tasks: [task({ id: 1, dueDate: utc(2026, 9, 1), status: "Started" })],
      schedules: [schedule()],
      now: MID_SEPTEMBER,
      filters: { ...EMPTY_MAINTENANCE_CALENDAR_FILTERS, type: "scheduled" },
    });
    expect(month.entries.every((e) => e.scheduleId != null)).toBe(true);
    expect(month.overdue.every((e) => e.scheduleId != null)).toBe(true);
  });
});

describe("buildMaintenanceAgenda", () => {
  it("groups upcoming work by day, overdue first under its own real date", () => {
    const groups = buildMaintenanceAgenda({
      tasks: [],
      schedules: [schedule({ firstDueDate: utc(2026, 9, 2), nextDueDate: utc(2026, 9, 2) })],
      now: MID_SEPTEMBER,
      filters: EMPTY_MAINTENANCE_CALENDAR_FILTERS,
    });
    expect(groups[0].day).toBe("2026-09-02");
    expect(groups[0].entries[0].overdue).toBe(true);
    // ...and it is followed by the upcoming occurrences, in date order.
    expect(groups.map((g) => g.day)).toEqual([...groups.map((g) => g.day)].sort());
  });

  it("does not list an entry twice when it is both overdue and in the window", () => {
    const groups = buildMaintenanceAgenda({
      tasks: [task({ id: 1, dueDate: utc(2026, 9, 15), status: "Started" })],
      schedules: [],
      now: MID_SEPTEMBER,
      filters: EMPTY_MAINTENANCE_CALENDAR_FILTERS,
    });
    const all = groups.flatMap((g) => g.entries);
    expect(all.filter((e) => e.key === "wo-1")).toHaveLength(1);
  });

  it("stops at the horizon", () => {
    const groups = buildMaintenanceAgenda({
      tasks: [task({ id: 1, dueDate: utc(2027, 6, 1) })],
      schedules: [],
      now: MID_SEPTEMBER,
      filters: EMPTY_MAINTENANCE_CALENDAR_FILTERS,
      horizonDays: AGENDA_HORIZON_DAYS,
    });
    expect(groups).toEqual([]);
  });

  it("honours the filters", () => {
    const groups = buildMaintenanceAgenda({
      tasks: [task({ id: 1, dueDate: utc(2026, 9, 20) })],
      schedules: [schedule({ nextDueDate: utc(2026, 9, 20), firstDueDate: utc(2026, 9, 20) })],
      now: MID_SEPTEMBER,
      filters: { ...EMPTY_MAINTENANCE_CALENDAR_FILTERS, type: "one-off" },
    });
    expect(groups.flatMap((g) => g.entries).every((e) => e.scheduleId == null)).toBe(true);
  });
});

describe("filter options", () => {
  it("lists assignees from the data, deduped and keyed by email", () => {
    const options = maintenanceAssigneeOptions(
      [task({ assigned: ALYSSA }), task({ id: 2, assigned: ALYSSA })],
      [schedule({ assignedTo: ERIC })],
    );
    expect(options).toEqual([
      { value: "alyssa@altronic-llc.com", label: "Alyssa Reed" },
      { value: "eric@altronic-llc.com", label: "Eric Vance" },
    ]);
  });

  it("lists equipment, preferring a titled reference over a bare one", () => {
    const options = maintenanceEquipmentOptions(
      [task({ equipment: { lookupId: 5, title: "" } })],
      [schedule({ equipment: { lookupId: 5, title: "Kitamura" } })],
    );
    expect(options).toEqual([{ value: "5", label: "Kitamura" }]);
  });
});
