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
    lastCompletedHours: null,
    nextDueHours: null,
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

// =============================================================================
// RUN-HOURS (Hourmeter) schedules on the calendar.
//
// The rule being pinned: a meter PM is on the calendar ONLY once it is actually
// due, as a chip on today, and nowhere at all before that — because there is no
// honest date to put it on. Estimating one from average usage would fabricate a
// number nobody measured, and it would then be sorted and reported on as though
// somebody had.
// =============================================================================

/** A run-hours schedule, due at `lastCompletedHours` + 500. */
function meterSchedule(over: Partial<ScheduledMaintenance> = {}): ScheduledMaintenance {
  return schedule({
    id: 400,
    title: "Engine oil change (500 run hours)",
    equipment: { lookupId: 7, title: "GENERATOR #1" },
    frequencyInterval: 500,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    firstDueDate: null,
    nextDueDate: null,
    lastCompletedHours: 4300,
    ...over,
  });
}

/** One asset in the register, as `MeterAsset` sees it. */
function meterAsset(hours: number | null, editedOn = utc(2026, 9, 14)) {
  return { lookupId: 7, currentMachineHours: hours, modifiedAt: editedOn };
}

describe("meter schedules on the calendar", () => {
  it("puts a DUE meter PM on today, and marks it overdue", () => {
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(4820)],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: MID_SEPTEMBER,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].day).toBe("2026-09-15");
    expect(entries[0].kind).toBe("projected");
    // Due IS overdue for a meter PM: the reading has passed the point the work
    // should have happened at, and there was no advance warning to have missed.
    expect(entries[0].overdue).toBe(true);
  });

  it("puts a meter PM that is NOT due on the calendar nowhere at all", () => {
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(4000)],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: MID_SEPTEMBER,
    });
    expect(entries).toEqual([]);
  });

  it("shows nothing when the state cannot be told — no reading", () => {
    // The calendar has nowhere honest to put "can't tell", so it shows nothing
    // and the PM library reports the fault. This is deliberate, and it is why
    // the library is a meter schedule's primary home.
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(null)],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: MID_SEPTEMBER,
    });
    expect(entries).toEqual([]);
  });

  it("shows nothing when the schedule has no linked asset", () => {
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule({ equipment: null })],
      assets: [meterAsset(99_999)],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: MID_SEPTEMBER,
    });
    expect(entries).toEqual([]);
  });

  it("shows nothing for an INACTIVE meter schedule however far past the reading is", () => {
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule({ active: false })],
      assets: [meterAsset(99_999)],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: MID_SEPTEMBER,
    });
    expect(entries).toEqual([]);
  });

  it("never projects a meter PM off its stored dates", () => {
    // A meter schedule can still carry dates from before it was switched over,
    // or from a SharePoint edit. Projecting off them would scatter occurrences
    // across the month for a schedule that is due at a reading.
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [
        meterSchedule({ firstDueDate: utc(2026, 9, 2), nextDueDate: utc(2026, 9, 2) }),
      ],
      assets: [meterAsset(4000)],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: MID_SEPTEMBER,
    });
    expect(entries).toEqual([]);
  });

  it("keeps the meter chip out of a month that does not contain today", () => {
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(4820)],
      from: utc(2026, 10, 1),
      to: utc(2026, 10, 31),
      now: MID_SEPTEMBER,
    });
    expect(entries).toEqual([]);
  });

  it("suppresses the chip once a work order exists for it today", () => {
    // Same rule as a date projection: the record replaces the prediction, so
    // the day doesn't read as two jobs.
    const entries = collectMaintenanceEntries({
      tasks: [
        task({
          id: 88,
          dueDate: MID_SEPTEMBER,
          scheduleRef: { lookupId: 400, title: "Engine oil change (500 run hours)" },
        }),
      ],
      schedules: [meterSchedule()],
      assets: [meterAsset(4820)],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: MID_SEPTEMBER,
    });
    expect(entries.filter((e) => e.kind === "projected")).toEqual([]);
    expect(entries.filter((e) => e.kind === "work-order")).toHaveLength(1);
  });

  it("can never evaluate a meter schedule when no register is passed", () => {
    // The `assets` parameter is optional so every pre-existing caller keeps
    // compiling — and this is the cost of that, stated rather than assumed. A
    // view showing schedules must pass the register.
    const entries = collectMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule()],
      from: utc(2026, 9, 1),
      to: utc(2026, 9, 30),
      now: MID_SEPTEMBER,
    });
    expect(entries).toEqual([]);
  });
});

describe("overdueMaintenanceEntries with meter schedules", () => {
  it("counts a due meter PM, so it cannot hide for lacking a date", () => {
    const entries = overdueMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(4820)],
      now: MID_SEPTEMBER,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].scheduleId).toBe(400);
    expect(entries[0].overdue).toBe(true);
    expect(entries[0].day).toBe("2026-09-15");
  });

  it("leaves out one that is not due, one that can't be told, and a retired one", () => {
    const notDue = overdueMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(4000)],
      now: MID_SEPTEMBER,
    });
    expect(notDue).toEqual([]);

    const cantTell = overdueMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(null)],
      now: MID_SEPTEMBER,
    });
    expect(cantTell).toEqual([]);

    const retired = overdueMaintenanceEntries({
      tasks: [],
      schedules: [meterSchedule({ active: false })],
      assets: [meterAsset(99_999)],
      now: MID_SEPTEMBER,
    });
    expect(retired).toEqual([]);
  });
});

describe("the month and the agenda carry meter schedules through", () => {
  it("lists a due meter PM in the grid and in the overdue strip", () => {
    const month = buildMaintenanceCalendarMonth({
      monthStart: SEPTEMBER,
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(4820)],
      now: MID_SEPTEMBER,
      filters: EMPTY_MAINTENANCE_CALENDAR_FILTERS,
    });
    expect(month.entries).toHaveLength(1);
    expect(month.byDay.get("2026-09-15")).toHaveLength(1);
    expect(month.overdue).toHaveLength(1);
  });

  it("lists it exactly once on the agenda, not twice", () => {
    // Both the overdue pass and the window pass produce it with the SAME key,
    // so the merge dedupes rather than showing today's chip twice.
    const agenda = buildMaintenanceAgenda({
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(4820)],
      now: MID_SEPTEMBER,
      filters: EMPTY_MAINTENANCE_CALENDAR_FILTERS,
    });
    const all = agenda.flatMap((g) => g.entries);
    expect(all).toHaveLength(1);
    expect(all[0].day).toBe("2026-09-15");
  });

  it("still honours the Type filter", () => {
    const oneOffOnly = buildMaintenanceCalendarMonth({
      monthStart: SEPTEMBER,
      tasks: [],
      schedules: [meterSchedule()],
      assets: [meterAsset(4820)],
      now: MID_SEPTEMBER,
      filters: { ...EMPTY_MAINTENANCE_CALENDAR_FILTERS, type: "one-off" },
    });
    expect(oneOffOnly.entries).toEqual([]);
  });
});
