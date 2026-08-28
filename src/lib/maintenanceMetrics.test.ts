import { describe, expect, it } from "vitest";
import type {
  Equipment,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTask,
  Person,
  ScheduledMaintenance,
} from "@/types/task";
import {
  CRITICALITY_WEIGHT,
  NO_CRITICALITY_LABEL,
  NO_DEPARTMENT_LABEL,
  UNASSIGNED_LABEL,
  assetWorkSummary,
  assetsDown,
  backlogTrend,
  departmentCoverage,
  downtimeByAsset,
  equipmentByDepartment,
  openByPriority,
  openByStatus,
  openMaintenanceTasks,
  openWorkByDepartment,
  overdueSummary,
  plannedVsUnplanned,
  pmCompliance,
  schedulesForAsset,
  startOfUtcWeek,
  wholeDaysBetween,
  workloadByAssignee,
} from "./maintenanceMetrics";

// A Wednesday, so week bucketing has a non-zero Monday offset to get wrong.
const NOW = new Date(Date.UTC(2026, 7, 26, 12, 0, 0)); // 2026-08-26

function day(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function person(name: string, email: string, lookupId = 1): Person {
  return { lookupId, displayName: name, email };
}

let nextId = 1;
function task(over: Partial<MaintenanceTask> = {}): MaintenanceTask {
  const id = over.id ?? nextId++;
  return {
    id,
    woNumber: `WO-2026-${String(id).padStart(4, "0")}`,
    title: `Work order ${id}`,
    description: "",
    status: "Backlog" as MaintenanceStatus,
    priority: null,
    category: null,
    taskType: null,
    dueStatus: null,
    startDate: null,
    dueDate: null,
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
    createdAt: day("2026-08-01"),
    modifiedAt: day("2026-08-01"),
    ...over,
  };
}

function asset(over: Partial<Equipment> = {}): Equipment {
  return {
    lookupId: over.lookupId ?? 100,
    name: "20 HP COMPRESSOR",
    description: "",
    serialNo: "",
    manufacturer: "",
    modelNumber: "",
    equipmentType: null,
    department: null,
    location: null,
    criticality: null,
    assetStatus: "In Service",
    parentAsset: null,
    installDate: null,
    warrantyExpiry: null,
    responsibleTech: null,
    hasAttachments: false,
    ...over,
  };
}

function schedule(over: Partial<ScheduledMaintenance> = {}): ScheduledMaintenance {
  return {
    id: over.id ?? 1,
    title: "Monthly inspection",
    instructions: "",
    category: null,
    priority: null,
    equipment: null,
    frequencyInterval: 1,
    frequencyUnit: "Months",
    scheduleBasis: "Fixed",
    firstDueDate: null,
    nextDueDate: null,
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
    createdAt: day("2026-01-01"),
    modifiedAt: day("2026-01-01"),
    ...over,
  };
}

describe("date helpers", () => {
  it("counts whole days in UTC terms, negative when the target is earlier", () => {
    expect(wholeDaysBetween(NOW, day("2026-08-29"))).toBe(3);
    expect(wholeDaysBetween(NOW, day("2026-08-20"))).toBe(-6);
    expect(wholeDaysBetween(NOW, day("2026-08-26"))).toBe(0);
  });

  it("puts a week's start on the Monday, Sunday included", () => {
    // 2026-08-26 is a Wednesday; its Monday is the 24th.
    expect(startOfUtcWeek(NOW).toISOString()).toBe("2026-08-24T00:00:00.000Z");
    // A Sunday belongs to the week that STARTED — not the one about to.
    expect(startOfUtcWeek(day("2026-08-30")).toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect(startOfUtcWeek(day("2026-08-31")).toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });
});

describe("openMaintenanceTasks", () => {
  it("drops Complete and Canceled and keeps everything else", () => {
    const rows = [
      task({ status: "Backlog" }),
      task({ status: "Awaiting Parts" }),
      task({ status: "Complete" }),
      task({ status: "Canceled" }),
    ];
    expect(openMaintenanceTasks(rows).map((t) => t.status)).toEqual(["Backlog", "Awaiting Parts"]);
  });
});

describe("workloadByAssignee", () => {
  const kim = person("Kim Tech", "kim@altronic-llc.com", 11);
  const lee = person("Lee Tech", "lee@altronic-llc.com", 12);

  it("splits each person's open work into overdue / this week / later / undated", () => {
    const rows = workloadByAssignee(
      [
        task({ assigned: kim, dueDate: day("2026-08-20") }), // overdue
        task({ assigned: kim, dueDate: day("2026-08-26") }), // due today
        task({ assigned: kim, dueDate: day("2026-09-30") }), // later
        task({ assigned: kim, dueDate: null }), // undated
        task({ assigned: kim, dueDate: day("2026-08-01"), status: "Complete" }), // closed
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Kim Tech",
      overdue: 1,
      dueThisWeek: 1,
      later: 1,
      noDueDate: 1,
      total: 4,
    });
  });

  it("counts the last day of the week window as this week, and the next as later", () => {
    const rows = workloadByAssignee(
      [
        task({ assigned: kim, dueDate: day("2026-09-01") }), // now + 6
        task({ assigned: kim, dueDate: day("2026-09-02") }), // now + 7
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({ dueThisWeek: 1, later: 1 });
  });

  it("gives unassigned work its own row, always last however big it is", () => {
    const rows = workloadByAssignee(
      [
        task({ assigned: null }),
        task({ assigned: null }),
        task({ assigned: null }),
        task({ assigned: kim, dueDate: day("2026-08-01") }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.name)).toEqual(["Kim Tech", UNASSIGNED_LABEL]);
    expect(rows[1].total).toBe(3);
    expect(rows[1].person).toBeNull();
  });

  it("ranks people with the most overdue first, before raw volume", () => {
    const rows = workloadByAssignee(
      [
        task({ assigned: lee, dueDate: day("2026-09-30") }),
        task({ assigned: lee, dueDate: day("2026-09-30") }),
        task({ assigned: lee, dueDate: day("2026-09-30") }),
        task({ assigned: kim, dueDate: day("2026-08-01") }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.name)).toEqual(["Kim Tech", "Lee Tech"]);
  });
});

describe("openByStatus", () => {
  it("returns every open status in workflow order, zeros included", () => {
    const rows = openByStatus([task({ status: "Started" }), task({ status: "Started" })]);
    expect(rows.map((r) => r.status)).toEqual([
      "Backlog",
      "Up Next",
      "Started",
      "Awaiting Parts",
      "On Hold",
    ]);
    expect(rows.find((r) => r.status === "Started")?.count).toBe(2);
    expect(rows.find((r) => r.status === "Backlog")?.count).toBe(0);
  });

  it("never reports a closed status as open work", () => {
    const rows = openByStatus([task({ status: "Complete" }), task({ status: "Canceled" })]);
    expect(rows.every((r) => r.count === 0)).toBe(true);
    expect(rows.some((r) => r.status === ("Complete" as MaintenanceStatus))).toBe(false);
  });
});

describe("openByPriority", () => {
  it("orders Emergency first and omits the no-priority row when nothing is in it", () => {
    const rows = openByPriority([
      task({ priority: "Emergency" as MaintenancePriority }),
      task({ priority: "Low" as MaintenancePriority }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Emergency", "High", "Med", "Low"]);
    expect(rows[0].count).toBe(1);
  });

  it("keeps an explicit row for work orders with no priority set", () => {
    const rows = openByPriority([task({ priority: null }), task({ priority: null })]);
    const none = rows[rows.length - 1];
    expect(none.priority).toBeNull();
    expect(none.label).toBe("No priority");
    expect(none.count).toBe(2);
  });
});

describe("overdueSummary", () => {
  it("counts open work past its due date and names the one late longest", () => {
    const worst = task({ dueDate: day("2026-07-01") });
    const summary = overdueSummary(
      [worst, task({ dueDate: day("2026-08-20") }), task({ dueDate: day("2026-09-30") })],
      NOW,
    );
    expect(summary.count).toBe(2);
    expect(summary.oldest?.id).toBe(worst.id);
    expect(summary.oldestDaysLate).toBe(56);
  });

  it("does not treat an undated work order as overdue", () => {
    expect(overdueSummary([task({ dueDate: null })], NOW)).toEqual({
      count: 0,
      oldest: null,
      oldestDaysLate: null,
    });
  });

  it("ignores work that is already closed, however late it was", () => {
    expect(overdueSummary([task({ dueDate: day("2026-01-01"), status: "Complete" })], NOW).count).toBe(
      0,
    );
  });
});

describe("pmCompliance", () => {
  const period = { from: day("2026-08-01"), to: day("2026-08-31") };
  const ref = { lookupId: 5, title: "Monthly inspection" };
  const schedules = [schedule({ id: 5, graceDays: 3 })];

  it("credits a completion inside the grace window and faults one outside it", () => {
    const result = pmCompliance(
      [
        task({
          scheduleRef: ref,
          dueDate: day("2026-08-10"),
          completedDate: day("2026-08-13"),
          status: "Complete",
        }),
        task({
          scheduleRef: ref,
          dueDate: day("2026-08-10"),
          completedDate: day("2026-08-14"),
          status: "Complete",
        }),
      ],
      schedules,
      period,
      NOW,
    );
    expect(result).toMatchObject({ due: 2, onTime: 1, late: 1, percent: 50 });
  });

  it("leaves an open occurrence still inside its grace window undecided", () => {
    const result = pmCompliance(
      [task({ scheduleRef: ref, dueDate: day("2026-08-25"), status: "Started" })],
      schedules,
      period,
      NOW,
    );
    expect(result).toMatchObject({ due: 0, pending: 1, percent: null });
  });

  it("counts an open occurrence past its grace window as late", () => {
    const result = pmCompliance(
      [task({ scheduleRef: ref, dueDate: day("2026-08-10"), status: "Started" })],
      schedules,
      period,
      NOW,
    );
    expect(result).toMatchObject({ due: 1, late: 1, pending: 0, percent: 0 });
  });

  it("excludes a canceled occurrence from both halves of the ratio", () => {
    const result = pmCompliance(
      [task({ scheduleRef: ref, dueDate: day("2026-08-10"), status: "Canceled" })],
      schedules,
      period,
      NOW,
    );
    expect(result).toMatchObject({ due: 0, excluded: 1, percent: null });
  });

  it("ignores unplanned work and anything due outside the period", () => {
    const result = pmCompliance(
      [
        task({ dueDate: day("2026-08-10"), completedDate: day("2026-08-10"), status: "Complete" }),
        task({
          scheduleRef: ref,
          dueDate: day("2026-07-10"),
          completedDate: day("2026-07-10"),
          status: "Complete",
        }),
      ],
      schedules,
      period,
      NOW,
    );
    expect(result).toMatchObject({ due: 0, percent: null });
  });

  it("faults a Complete work order that recorded no completion date", () => {
    const result = pmCompliance(
      [task({ scheduleRef: ref, dueDate: day("2026-08-10"), status: "Complete" })],
      schedules,
      period,
      NOW,
    );
    expect(result).toMatchObject({ due: 1, onTime: 0, late: 1 });
  });

  it("falls back to the default grace when the schedule is missing or blank", () => {
    const onDueDate = task({
      scheduleRef: { lookupId: 999, title: "Gone" },
      dueDate: day("2026-08-10"),
      completedDate: day("2026-08-10"),
      status: "Complete",
    });
    const oneDayLate = task({
      scheduleRef: { lookupId: 999, title: "Gone" },
      dueDate: day("2026-08-10"),
      completedDate: day("2026-08-11"),
      status: "Complete",
    });
    expect(pmCompliance([onDueDate, oneDayLate], [], period, NOW)).toMatchObject({
      due: 2,
      onTime: 1,
      late: 1,
    });
  });
});

describe("plannedVsUnplanned", () => {
  it("splits on the schedule reference, not the TaskType column", () => {
    const result = plannedVsUnplanned([
      task({ scheduleRef: { lookupId: 1, title: "PM" }, taskType: null }),
      task({ scheduleRef: null, taskType: "Regular Maintenance" }),
      task({ scheduleRef: null }),
    ]);
    expect(result).toEqual({ planned: 1, unplanned: 2, total: 3, plannedPercent: 33 });
  });

  it("reports null rather than 0% when there is no work at all", () => {
    expect(plannedVsUnplanned([]).plannedPercent).toBeNull();
  });
});

describe("downtimeByAsset", () => {
  const press = asset({ lookupId: 1, name: "60 TON PRESS", department: "PROD" });
  const oven = asset({ lookupId: 2, name: "REFLOW OVEN", department: "SMT" });

  it("ranks assets by total downtime, worst first", () => {
    const ranking = downtimeByAsset(
      [
        task({ equipment: { lookupId: 1, title: "60 TON PRESS" }, downtimeHours: 4 }),
        task({ equipment: { lookupId: 1, title: "60 TON PRESS" }, downtimeHours: 2.5 }),
        task({ equipment: { lookupId: 2, title: "REFLOW OVEN" }, downtimeHours: 5 }),
      ],
      [press, oven],
    );
    expect(ranking.rows.map((r) => r.name)).toEqual(["60 TON PRESS", "REFLOW OVEN"]);
    expect(ranking.rows[0]).toMatchObject({ hours: 6.5, workOrders: 2, department: "PROD" });
    expect(ranking.totalHours).toBe(11.5);
  });

  it("reports downtime with no asset separately instead of dropping it", () => {
    const ranking = downtimeByAsset(
      [
        task({ equipment: { lookupId: 1, title: "60 TON PRESS" }, downtimeHours: 3 }),
        task({ equipment: null, downtimeHours: 7 }),
      ],
      [press],
    );
    expect(ranking.rows).toHaveLength(1);
    expect(ranking.unassigned).toEqual({ hours: 7, workOrders: 1 });
    expect(ranking.totalHours).toBe(10);
    expect(ranking.rankedHours).toBe(3);
  });

  it("still ranks an asset the register no longer holds", () => {
    const ranking = downtimeByAsset(
      [task({ equipment: { lookupId: 77, title: "OLD SAW" }, downtimeHours: 2 })],
      [],
    );
    expect(ranking.rows[0]).toMatchObject({ lookupId: 77, name: "OLD SAW", department: null });
  });

  it("honours the limit and ignores zero / null downtime", () => {
    const rows = [
      task({ equipment: { lookupId: 1, title: "a" }, downtimeHours: 9 }),
      task({ equipment: { lookupId: 2, title: "b" }, downtimeHours: 8 }),
      task({ equipment: { lookupId: 3, title: "c" }, downtimeHours: 0 }),
      task({ equipment: { lookupId: 4, title: "d" }, downtimeHours: null }),
    ];
    const ranking = downtimeByAsset(rows, [], 1);
    expect(ranking.rows).toHaveLength(1);
    expect(ranking.rows[0].lookupId).toBe(1);
    expect(ranking.totalHours).toBe(17);
  });
});

describe("assetsDown", () => {
  it("counts only Down assets and weights them by criticality", () => {
    const summary = assetsDown([
      asset({ lookupId: 1, name: "A", assetStatus: "Down", criticality: "Critical" }),
      asset({ lookupId: 2, name: "B", assetStatus: "Down", criticality: "Standard" }),
      asset({ lookupId: 3, name: "C", assetStatus: "In Service", criticality: "Critical" }),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.weight).toBe(CRITICALITY_WEIGHT.Critical + CRITICALITY_WEIGHT.Standard);
    expect(summary.assets.map((a) => a.name)).toEqual(["A", "B"]);
  });

  it("gives an asset with no criticality its own labelled row", () => {
    const summary = assetsDown([
      asset({ lookupId: 1, name: "A", assetStatus: "Down", criticality: null }),
      asset({ lookupId: 2, name: "B", assetStatus: "Down", criticality: "Critical" }),
    ]);
    expect(summary.byCriticality.map((c) => c.label)).toEqual(["Critical", NO_CRITICALITY_LABEL]);
    expect(summary.byCriticality[1].count).toBe(1);
  });

  it("is empty, not undefined, when nothing is down", () => {
    expect(assetsDown([asset({ assetStatus: "In Service" })])).toEqual({
      total: 0,
      byCriticality: [],
      weight: 0,
      assets: [],
    });
  });
});

describe("equipmentByDepartment", () => {
  it("groups biggest first and puts the missing-department bucket LAST", () => {
    const rows = equipmentByDepartment([
      asset({ lookupId: 1, department: "PROD" }),
      asset({ lookupId: 2, department: "PROD" }),
      asset({ lookupId: 3, department: "SMT" }),
      asset({ lookupId: 4, department: null }),
      asset({ lookupId: 5, department: null }),
      asset({ lookupId: 6, department: null }),
      asset({ lookupId: 7, department: "" }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["PROD", "SMT", NO_DEPARTMENT_LABEL]);
    // Four assets have no department — three null and one blank string.
    expect(rows[rows.length - 1]).toMatchObject({ department: null, count: 4 });
  });

  it("never invents a missing-department row when every asset has one", () => {
    const rows = equipmentByDepartment([asset({ department: "QC" })]);
    expect(rows.map((r) => r.label)).toEqual(["QC"]);
  });
});

describe("openWorkByDepartment", () => {
  const press = asset({ lookupId: 1, department: "PROD" });
  const untagged = asset({ lookupId: 2, department: null });

  it("attributes open work to its asset's department", () => {
    const rows = openWorkByDepartment(
      [task({ equipment: { lookupId: 1, title: "press" } })],
      [press, untagged],
    );
    expect(rows).toEqual([{ department: "PROD", label: "PROD", count: 1 }]);
  });

  it("folds no-asset and no-department work into one honest bucket", () => {
    const rows = openWorkByDepartment(
      [
        task({ equipment: { lookupId: 2, title: "untagged" } }),
        task({ equipment: null }),
        task({ equipment: { lookupId: 999, title: "gone" } }),
      ],
      [press, untagged],
    );
    expect(rows).toEqual([{ department: null, label: NO_DEPARTMENT_LABEL, count: 3 }]);
  });

  it("ignores closed work orders", () => {
    const rows = openWorkByDepartment(
      [task({ equipment: { lookupId: 1, title: "press" }, status: "Complete" })],
      [press],
    );
    expect(rows).toEqual([]);
  });
});

describe("departmentCoverage", () => {
  it("reports how much of the register actually carries a department", () => {
    expect(
      departmentCoverage([
        asset({ lookupId: 1, department: "PROD" }),
        asset({ lookupId: 2, department: null }),
        asset({ lookupId: 3, department: null }),
        asset({ lookupId: 4, department: null }),
      ]),
    ).toEqual({ filled: 1, missing: 3, total: 4, percent: 25 });
  });

  it("reports null rather than 0% on an empty register", () => {
    expect(departmentCoverage([]).percent).toBeNull();
  });
});

describe("backlogTrend", () => {
  it("buckets created and closed work orders by Monday-start week", () => {
    const weeks = backlogTrend(
      [
        task({ createdAt: day("2026-08-24") }),
        task({ createdAt: day("2026-08-25"), completedDate: day("2026-08-26") }),
        task({ createdAt: day("2026-08-17"), completedDate: day("2026-08-18") }),
      ],
      NOW,
      2,
    );
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ created: 1, closed: 1, net: 0 });
    expect(weeks[0].weekStart.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(weeks[1]).toMatchObject({ created: 2, closed: 1, net: 1 });
  });

  it("returns empty weeks rather than gaps, oldest first", () => {
    const weeks = backlogTrend([], NOW, 4);
    expect(weeks.map((w) => w.weekStart.toISOString())).toEqual([
      "2026-08-03T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
      "2026-08-17T00:00:00.000Z",
      "2026-08-24T00:00:00.000Z",
    ]);
    expect(weeks.every((w) => w.created === 0 && w.closed === 0)).toBe(true);
  });

  it("does not credit a canceled work order as closed work", () => {
    const weeks = backlogTrend(
      [task({ createdAt: day("2026-08-25"), status: "Canceled", completedDate: null })],
      NOW,
      1,
    );
    expect(weeks[0]).toMatchObject({ created: 1, closed: 0 });
  });

  it("ignores anything outside the window", () => {
    const weeks = backlogTrend([task({ createdAt: day("2025-01-01") })], NOW, 2);
    expect(weeks.every((w) => w.created === 0)).toBe(true);
  });
});

describe("assetWorkSummary", () => {
  it("splits one asset's work into open and history, newest history first", () => {
    const ref = { lookupId: 42, title: "VMC" };
    const summary = assetWorkSummary(
      [
        task({ id: 1, equipment: ref, status: "Started", dueDate: day("2026-09-05") }),
        task({ id: 2, equipment: ref, status: "Backlog", dueDate: day("2026-08-30") }),
        task({ id: 3, equipment: ref, status: "Complete", completedDate: day("2026-06-01") }),
        task({ id: 4, equipment: ref, status: "Complete", completedDate: day("2026-07-01") }),
        task({ id: 5, equipment: { lookupId: 43, title: "other" }, status: "Started" }),
      ],
      42,
    );
    expect(summary.open.map((t) => t.id)).toEqual([2, 1]);
    expect(summary.history.map((t) => t.id)).toEqual([4, 3]);
  });

  it("totals downtime and labour across open and closed work alike", () => {
    const ref = { lookupId: 42, title: "VMC" };
    const summary = assetWorkSummary(
      [
        task({ equipment: ref, status: "Started", downtimeHours: 1.5, laborHours: 2 }),
        task({ equipment: ref, status: "Complete", downtimeHours: 3, laborHours: null }),
      ],
      42,
    );
    expect(summary.totalDowntimeHours).toBe(4.5);
    expect(summary.totalLaborHours).toBe(2);
  });

  it("keeps a closed work order with no completion date in the history", () => {
    const ref = { lookupId: 42, title: "VMC" };
    const summary = assetWorkSummary(
      [task({ id: 9, equipment: ref, status: "Canceled", completedDate: null })],
      42,
    );
    expect(summary.history.map((t) => t.id)).toEqual([9]);
  });
});

describe("schedulesForAsset", () => {
  it("returns only this asset's schedules, active ones first", () => {
    const ref = { lookupId: 7, title: "SAW" };
    const rows = schedulesForAsset(
      [
        schedule({ id: 1, title: "Zebra check", equipment: ref, active: true }),
        schedule({ id: 2, title: "Annual service", equipment: ref, active: false }),
        schedule({ id: 3, title: "Alpha check", equipment: ref, active: true }),
        schedule({ id: 4, title: "Other asset", equipment: { lookupId: 8, title: "x" } }),
      ],
      7,
    );
    expect(rows.map((s) => s.title)).toEqual(["Alpha check", "Zebra check", "Annual service"]);
  });
});
