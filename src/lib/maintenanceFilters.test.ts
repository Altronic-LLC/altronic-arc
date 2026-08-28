import { describe, expect, it } from "vitest";
import {
  EMPTY_MAINTENANCE_FILTERS,
  UNASSIGNED_FILTER_KEY,
  applyMaintenanceFilters,
  collectMaintenanceEquipment,
  collectMaintenancePeople,
  countMaintenanceByStatus,
  countOpenMaintenance,
  daysUntilWorkOrderDue,
  departmentByEquipment,
  isWorkOrderOverdue,
  maintenanceDepartmentOptions,
  sortMaintenanceTasks,
} from "./maintenanceFilters";
import { OTHER_TECH, SUPERVISOR, TECH, day, makeAsset, makeTask } from "@/test/maintenanceFixtures";

const NOW = new Date("2026-08-27T15:00:00Z");

const COMPRESSOR = { lookupId: 3, title: "40 HP COMPRESSOR" };
const OVEN = { lookupId: 8, title: "REFLOW OVEN" };

const TASKS = [
  makeTask({
    id: 1,
    title: "Compressor tripping",
    status: "Started",
    category: "Corrective / Repair",
    equipment: COMPRESSOR,
    assigned: TECH,
    dueDate: day(-3, NOW),
  }),
  makeTask({
    id: 2,
    title: "Oven profile verification",
    status: "Up Next",
    category: "Calibration",
    equipment: OVEN,
    assigned: OTHER_TECH,
    dueDate: day(2, NOW),
  }),
  makeTask({
    id: 3,
    title: "Nobody has picked this up",
    status: "Backlog",
    category: "Cleaning",
    equipment: OVEN,
    assigned: null,
    dueDate: day(10, NOW),
  }),
  makeTask({
    id: 4,
    title: "Finished last week",
    status: "Complete",
    category: "Oil Change",
    equipment: COMPRESSOR,
    assigned: TECH,
    dueDate: day(-9, NOW),
    completedDate: day(-9, NOW),
  }),
  makeTask({ id: 5, title: "Scrapped idea", status: "Canceled", assigned: SUPERVISOR }),
];

const EQUIPMENT = [
  makeAsset({ lookupId: 3, name: "40 HP COMPRESSOR", department: "MACH SHOP" }),
  makeAsset({ lookupId: 8, name: "REFLOW OVEN", department: "SMT" }),
  makeAsset({ lookupId: 99, name: "UNUSED PRESS", department: "PCB" }),
  makeAsset({ lookupId: 100, name: "NO DEPARTMENT", department: null }),
];

function filter(overrides: Partial<typeof EMPTY_MAINTENANCE_FILTERS> = {}) {
  return { ...EMPTY_MAINTENANCE_FILTERS, ...overrides };
}

describe("applyMaintenanceFilters — status", () => {
  it("ALL_OPEN drops Complete and Canceled", () => {
    const out = applyMaintenanceFilters(TASKS, "ALL_OPEN", filter());
    expect(out.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("a specific status keeps only that status", () => {
    const out = applyMaintenanceFilters(TASKS, "Awaiting Parts", filter());
    expect(out).toEqual([]);
    expect(applyMaintenanceFilters(TASKS, "Started", filter()).map((t) => t.id)).toEqual([1]);
  });

  it("a null status filter keeps everything, closed included", () => {
    expect(applyMaintenanceFilters(TASKS, null, filter())).toHaveLength(5);
  });
});

describe("applyMaintenanceFilters — bar", () => {
  it("narrows by equipment", () => {
    const out = applyMaintenanceFilters(TASKS, null, filter({ equipmentIds: [8] }));
    expect(out.map((t) => t.id)).toEqual([2, 3]);
  });

  it("narrows by assignee, case-insensitively", () => {
    const out = applyMaintenanceFilters(
      TASKS,
      null,
      filter({ assignedEmails: ["David.Bulkley@Altronic-LLC.com".toLowerCase()] }),
    );
    expect(out.map((t) => t.id)).toEqual([1, 4]);
  });

  // The single most useful thing to filter TO on a shop floor: what nobody has
  // picked up. "No selection" already means "anyone", so this needs a sentinel.
  it("finds the unassigned work orders", () => {
    const out = applyMaintenanceFilters(
      TASKS,
      null,
      filter({ assignedEmails: [UNASSIGNED_FILTER_KEY] }),
    );
    expect(out.map((t) => t.id)).toEqual([3]);
  });

  it("mixes Unassigned with a named person", () => {
    const out = applyMaintenanceFilters(
      TASKS,
      null,
      filter({ assignedEmails: [UNASSIGNED_FILTER_KEY, "alyssa.garrett@altronic-llc.com"] }),
    );
    expect(out.map((t) => t.id)).toEqual([2, 3]);
  });

  it("narrows by category", () => {
    const out = applyMaintenanceFilters(TASKS, null, filter({ categories: ["Calibration"] }));
    expect(out.map((t) => t.id)).toEqual([2]);
  });

  it("searches every field, not just the title", () => {
    const out = applyMaintenanceFilters(TASKS, null, filter({ search: "reflow" }));
    expect(out.map((t) => t.id)).toEqual([2, 3]);
  });

  it("requires every search token (AND, any order)", () => {
    expect(
      applyMaintenanceFilters(TASKS, null, filter({ search: "compressor tripping" })).map(
        (t) => t.id,
      ),
    ).toEqual([1]);
    expect(applyMaintenanceFilters(TASKS, null, filter({ search: "compressor oven" }))).toEqual([]);
  });

  it("stacks the bar with the status pill", () => {
    const out = applyMaintenanceFilters(TASKS, "ALL_OPEN", filter({ equipmentIds: [3] }));
    expect(out.map((t) => t.id)).toEqual([1]);
  });
});

describe("applyMaintenanceFilters — department", () => {
  const departments = departmentByEquipment(EQUIPMENT);

  it("resolves a work order's department through its asset", () => {
    const out = applyMaintenanceFilters(TASKS, null, filter({ departments: ["SMT"] }), departments);
    expect(out.map((t) => t.id)).toEqual([2, 3]);
  });

  // A work order with no asset has no department. It must not fall into
  // whichever department happens to be picked.
  it("excludes a work order with no asset", () => {
    const out = applyMaintenanceFilters(
      TASKS,
      null,
      filter({ departments: ["MACH SHOP", "SMT"] }),
      departments,
    );
    expect(out.map((t) => t.id)).not.toContain(5);
  });

  // Silently ignoring the filter would show every department while the picked
  // one sat highlighted above — the user would trust the wrong list.
  it("matches nothing when the equipment register hasn't loaded", () => {
    expect(applyMaintenanceFilters(TASKS, null, filter({ departments: ["SMT"] }))).toEqual([]);
  });

  it("skips assets with no department when building the map and the options", () => {
    expect(departments.has(100)).toBe(false);
    expect(maintenanceDepartmentOptions(EQUIPMENT)).toEqual(["MACH SHOP", "PCB", "SMT"]);
  });
});

describe("counts", () => {
  it("counts every status, including the ones with none", () => {
    const counts = countMaintenanceByStatus(TASKS);
    expect(counts.Started).toBe(1);
    expect(counts["Awaiting Parts"]).toBe(0);
    expect(counts.Complete).toBe(1);
    expect(counts.Canceled).toBe(1);
  });

  it("counts open as anything not Complete or Canceled", () => {
    expect(countOpenMaintenance(TASKS)).toBe(3);
  });
});

describe("collectors", () => {
  it("collects everyone on a work order, deduped", () => {
    const tasks = [
      makeTask({ id: 1, assigned: TECH, reportedBy: SUPERVISOR, watchers: [TECH] }),
      makeTask({ id: 2, completedBy: OTHER_TECH }),
    ];
    const people = collectMaintenancePeople(tasks).map((p) => p.displayName).sort();
    expect(people).toEqual(["Alyssa Garrett", "David Bulkley", "Ray White"]);
  });

  // Not the whole 378-row register: offering assets with no work against them
  // makes finding the one that HAS work harder, not easier.
  it("collects only the assets that carry work orders", () => {
    expect(collectMaintenanceEquipment(TASKS).map((e) => e.lookupId)).toEqual([3, 8]);
  });

  // A lookup can come back title-less and be filled in later; the copy with a
  // title is the one worth keeping.
  it("prefers a resolved title over a blank one for the same asset", () => {
    const out = collectMaintenanceEquipment([
      makeTask({ id: 1, equipment: { lookupId: 3, title: "" } }),
      makeTask({ id: 2, equipment: COMPRESSOR }),
    ]);
    expect(out).toEqual([COMPRESSOR]);
  });
});

describe("due-date arithmetic", () => {
  it("counts whole days, negative when late", () => {
    expect(daysUntilWorkOrderDue(makeTask({ id: 1, dueDate: day(-3, NOW) }), NOW)).toBe(-3);
    expect(daysUntilWorkOrderDue(makeTask({ id: 1, dueDate: day(0, NOW) }), NOW)).toBe(0);
    expect(daysUntilWorkOrderDue(makeTask({ id: 1, dueDate: day(5, NOW) }), NOW)).toBe(5);
  });

  it("is null with no due date", () => {
    expect(daysUntilWorkOrderDue(makeTask({ id: 1 }), NOW)).toBeNull();
  });

  it("marks an open, past-due work order overdue", () => {
    expect(isWorkOrderOverdue(makeTask({ id: 1, dueDate: day(-1, NOW) }), NOW)).toBe(true);
    expect(isWorkOrderOverdue(makeTask({ id: 1, dueDate: day(0, NOW) }), NOW)).toBe(false);
    expect(isWorkOrderOverdue(makeTask({ id: 1 }), NOW)).toBe(false);
  });

  // History must not shout. A finished job whose due date went past is not
  // outstanding work.
  it("never marks a closed work order overdue", () => {
    for (const status of ["Complete", "Canceled"] as const) {
      expect(
        isWorkOrderOverdue(makeTask({ id: 1, status, dueDate: day(-40, NOW) }), NOW),
      ).toBe(false);
    }
  });
});

describe("sortMaintenanceTasks", () => {
  // A work-order list is a QUEUE, not a feed: what is due leads, not what was
  // raised most recently.
  it("puts open work first, soonest due at the top", () => {
    expect(sortMaintenanceTasks(TASKS).map((t) => t.id)).toEqual([1, 2, 3, 5, 4]);
  });

  it("sinks an open work order with no due date below the dated ones", () => {
    const out = sortMaintenanceTasks([
      makeTask({ id: 1, status: "Backlog" }),
      makeTask({ id: 2, status: "Backlog", dueDate: day(30, NOW) }),
    ]);
    expect(out.map((t) => t.id)).toEqual([2, 1]);
  });

  it("orders the closed tail newest-first", () => {
    const out = sortMaintenanceTasks([
      makeTask({ id: 1, status: "Complete", createdAt: new Date("2026-01-01T00:00:00Z") }),
      makeTask({ id: 2, status: "Complete", createdAt: new Date("2026-06-01T00:00:00Z") }),
    ]);
    expect(out.map((t) => t.id)).toEqual([2, 1]);
  });

  it("does not mutate the input", () => {
    const input = [...TASKS];
    sortMaintenanceTasks(input);
    expect(input.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
