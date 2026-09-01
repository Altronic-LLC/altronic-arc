import { describe, it, expect } from "vitest";
import {
  MOCK_EQUIPMENT,
  MOCK_MAINTENANCE_PEOPLE,
  MOCK_MAINTENANCE_TASKS,
  MOCK_SCHEDULED_MAINTENANCE,
} from "./maintenanceMockData";
import { isOverdue, nextDueDates } from "@/lib/maintenanceSchedule";
import { parseChecklistItems } from "@/lib/descriptionChecklist";

// =============================================================================
// The demo data has one job: make the CMMS screens look alive on any day
// somebody opens them. A calendar dated to a fixed month goes stale, and a
// stale demo reads as a broken feature.
// =============================================================================

const DAY = 86_400_000;
const daysFromNow = (d: Date) => Math.round((d.getTime() - Date.now()) / DAY);

describe("the demo dates move with today", () => {
  it("has work orders due both before and after today", () => {
    const due = MOCK_MAINTENANCE_TASKS.map((t) => t.dueDate)
      .filter((d): d is Date => !!d)
      .map(daysFromNow);
    expect(due.some((n) => n < 0)).toBe(true);
    expect(due.some((n) => n > 0)).toBe(true);
  });

  it("has PM occurrences landing inside the next month", () => {
    const soon = MOCK_SCHEDULED_MAINTENANCE.filter(
      (s) => s.active && nextDueDates(s, new Date(), 1).some((d) => daysFromNow(d) <= 31),
    );
    expect(soon.length).toBeGreaterThan(2);
  });

  it("has at least one overdue schedule and one retired one", () => {
    const now = new Date();
    expect(MOCK_SCHEDULED_MAINTENANCE.some((s) => isOverdue(s, now))).toBe(true);
    expect(MOCK_SCHEDULED_MAINTENANCE.some((s) => !s.active)).toBe(true);
  });

  it("holds every date at midday UTC, the storage convention", () => {
    const dates = [
      ...MOCK_MAINTENANCE_TASKS.flatMap((t) => [t.startDate, t.dueDate, t.completedDate]),
      ...MOCK_SCHEDULED_MAINTENANCE.flatMap((s) => [
        s.firstDueDate,
        s.nextDueDate,
        s.lastCompleted,
      ]),
      ...MOCK_EQUIPMENT.flatMap((e) => [e.installDate, e.warrantyExpiry]),
    ].filter((d): d is Date => !!d);
    expect(dates.length).toBeGreaterThan(50);
    for (const date of dates) {
      expect(date.getUTCHours()).toBe(12);
    }
  });
});

describe("the work orders", () => {
  it("has about 25 of them", () => {
    expect(MOCK_MAINTENANCE_TASKS.length).toBeGreaterThanOrEqual(25);
  });

  it("covers every status, priority and category", () => {
    const statuses = new Set(MOCK_MAINTENANCE_TASKS.map((t) => t.status));
    const priorities = new Set(MOCK_MAINTENANCE_TASKS.map((t) => t.priority));
    const categories = new Set(MOCK_MAINTENANCE_TASKS.map((t) => t.category));
    expect(statuses.size).toBe(7);
    for (const p of ["Low", "Med", "High", "Emergency"]) expect(priorities).toContain(p);
    for (const c of [
      "Corrective / Repair",
      "Preventive",
      "Inspection",
      "Calibration",
      "Cleaning",
      "Oil Change",
      "Safety",
      "Improvement",
    ]) {
      expect(categories).toContain(c);
    }
  });

  it("gives every work order a unique WO number in this year's sequence", () => {
    const numbers = MOCK_MAINTENANCE_TASKS.map((t) => t.woNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    const year = new Date().getFullYear();
    for (const n of numbers) expect(n.startsWith(`WO-${year}-`)).toBe(true);
  });

  it("derives TaskType from the schedule reference, exactly as ARC does", () => {
    for (const task of MOCK_MAINTENANCE_TASKS) {
      expect(task.taskType).toBe(task.scheduleRef ? "Regular Maintenance" : "Request");
    }
  });

  it("has completed work orders carrying real labour, downtime and a failure cause", () => {
    const complete = MOCK_MAINTENANCE_TASKS.filter((t) => t.status === "Complete");
    expect(complete.length).toBeGreaterThan(4);
    expect(complete.every((t) => t.completedDate && t.completedBy)).toBe(true);
    expect(complete.some((t) => (t.laborHours ?? 0) > 0)).toBe(true);
    expect(complete.some((t) => (t.downtimeHours ?? 0) > 0)).toBe(true);
    expect(complete.some((t) => t.failureCause.length > 0)).toBe(true);
  });

  it("points only at assets and schedules that exist", () => {
    const assets = new Set(MOCK_EQUIPMENT.map((e) => e.lookupId));
    const schedules = new Set(MOCK_SCHEDULED_MAINTENANCE.map((s) => s.id));
    for (const task of MOCK_MAINTENANCE_TASKS) {
      if (task.equipment) expect(assets.has(task.equipment.lookupId)).toBe(true);
      if (task.scheduleRef) expect(schedules.has(task.scheduleRef.lookupId)).toBe(true);
    }
  });

  it("has a comment thread to render", () => {
    expect(MOCK_MAINTENANCE_TASKS.some((t) => t.comments.length > 1)).toBe(true);
  });
});

describe("the schedules", () => {
  it("has about ten, mixing Fixed and Floating", () => {
    expect(MOCK_SCHEDULED_MAINTENANCE.length).toBeGreaterThanOrEqual(10);
    const bases = new Set(MOCK_SCHEDULED_MAINTENANCE.map((s) => s.scheduleBasis));
    expect(bases).toContain("Fixed");
    expect(bases).toContain("Floating");
  });

  it("uses a spread of frequency units", () => {
    const units = new Set(MOCK_SCHEDULED_MAINTENANCE.map((s) => s.frequencyUnit));
    expect(units.size).toBeGreaterThanOrEqual(3);
  });

  it("points only at assets that exist", () => {
    const assets = new Set(MOCK_EQUIPMENT.map((e) => e.lookupId));
    for (const s of MOCK_SCHEDULED_MAINTENANCE) {
      if (s.equipment) expect(assets.has(s.equipment.lookupId)).toBe(true);
    }
  });
});

describe("the equipment register", () => {
  it("keeps the first five lookupIds aligned with the Operations demo data", () => {
    // An Operations task and a work order naming the same asset must agree
    // about which one it is.
    const byId = new Map(MOCK_EQUIPMENT.map((e) => [e.lookupId, e.name]));
    expect(byId.get(1)).toBe("TM1");
    expect(byId.get(2)).toBe("20 HP COMPRESSOR");
    expect(byId.get(3)).toBe("40 HP COMPRESSOR");
    expect(byId.get(5)).toBe("5000 DIGITAL");
  });

  it("has a sub-assembly whose parent is in the same register", () => {
    const ids = new Set(MOCK_EQUIPMENT.map((e) => e.lookupId));
    const child = MOCK_EQUIPMENT.find((e) => e.parentAsset);
    expect(child).toBeDefined();
    expect(ids.has(child!.parentAsset!.lookupId)).toBe(true);
  });

  it("covers the asset statuses and criticalities the screens colour by", () => {
    const statuses = new Set(MOCK_EQUIPMENT.map((e) => e.assetStatus));
    for (const s of ["In Service", "Down", "Standby", "Retired"]) expect(statuses).toContain(s);
    const criticality = new Set(MOCK_EQUIPMENT.map((e) => e.criticality));
    for (const c of ["Critical", "Important", "Standard"]) expect(criticality).toContain(c);
  });

  it("has a warranty already expired and one still running", () => {
    const warranties = MOCK_EQUIPMENT.map((e) => e.warrantyExpiry).filter((d): d is Date => !!d);
    expect(warranties.some((d) => daysFromNow(d) < 0)).toBe(true);
    expect(warranties.some((d) => daysFromNow(d) > 0)).toBe(true);
  });
});

describe("the people", () => {
  it("gives everyone an email and a lookupId, so they can be written back", () => {
    for (const person of MOCK_MAINTENANCE_PEOPLE) {
      expect(person.email).toBeTruthy();
      expect(person.lookupId).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// The PM schedules whose Instructions are real checklists.
//
// The flagship feature is a schedule's instructions rendering as tickable
// steps that record who did each one and when — and it cannot be DEMONSTRATED
// at all if every seed is prose. These assertions exist so that stays true:
// somebody tidying a seed string back into a sentence breaks a test rather
// than quietly emptying the demo.
//
// Deliberately NOT "every schedule is a checklist". A mix is what the live
// list looks like, and both renderings have to keep working.
// =============================================================================

const scheduleById = new Map(MOCK_SCHEDULED_MAINTENANCE.map((s) => [s.id, s]));

function checklist(id: number) {
  return parseChecklistItems(scheduleById.get(id)!.instructions) ?? [];
}

describe("the demo PM instructions include real checklists", () => {
  it("makes a MIX of checklists and prose, so both renderings are demonstrable", () => {
    const withChecklists = MOCK_SCHEDULED_MAINTENANCE.filter(
      (s) => (parseChecklistItems(s.instructions) ?? []).length > 0,
    );
    expect(withChecklists.length).toBeGreaterThanOrEqual(3);
    expect(withChecklists.length).toBeLessThan(MOCK_SCHEDULED_MAINTENANCE.length);
  });

  it("gives the LOTO oil change its isolation steps, on the schedule that needs them", () => {
    const schedule = scheduleById.get(2)!;
    // The flags and the steps have to agree: a job flagged shutdown + LOTO
    // whose instructions never mention locking out is the failure this pins.
    expect(schedule.requiresShutdown).toBe(true);
    expect(schedule.lotoRequired).toBe(true);
    const texts = checklist(2).map((i) => i.text);
    expect(texts.some((t) => /lock and tag/i.test(t))).toBe(true);
    expect(texts.some((t) => /drain the sump/i.test(t))).toBe(true);
    expect(texts.some((t) => /separator element/i.test(t))).toBe(true);
    expect(texts.some((t) => /discharge pressure/i.test(t))).toBe(true);
  });

  it("keeps the prose reasoning alongside the steps, not instead of them", () => {
    // The checklist replaces the STEPS; the sentence that says why survives.
    expect(scheduleById.get(2)!.instructions).toContain("Log the oil quantity on the work order");
    expect(scheduleById.get(7)!.instructions).toContain("Tag out immediately if anything fails");
    expect(scheduleById.get(6)!.instructions).toContain("Below 6% and the coolant goes off");
  });

  it("gives the reflow oven profile check real ONE-LEVEL sub-tasks", () => {
    const parsed = checklist(3);
    const children = parsed.filter((i) => i.depth === 1);
    expect(children.length).toBeGreaterThanOrEqual(3);
    // Every child nests under the same parent — the "run the board" step.
    const parentLine = children[0].parentLineIndex;
    expect(parentLine).not.toBeNull();
    expect(children.every((c) => c.parentLineIndex === parentLine)).toBe(true);
    const parent = parsed.find((i) => i.lineIndex === parentLine)!;
    expect(parent.depth).toBe(0);
    expect(parent.text).toMatch(/run the board/i);
    // One level only — there is no grandchild in this data or in the parser.
    expect(parsed.every((i) => i.depth === 0 || i.depth === 1)).toBe(true);
  });

  // A schedule is a TEMPLATE, and LogPmCompletionModal copies its Instructions
  // verbatim into the Description of every work order it raises. A ticked box
  // here would hand every new occurrence two steps already done by somebody
  // who never touched it.
  it("ticks NOTHING on any schedule — a template is not a worked job", () => {
    for (const schedule of MOCK_SCHEDULED_MAINTENANCE) {
      expect((parseChecklistItems(schedule.instructions) ?? []).some((i) => i.checked)).toBe(false);
    }
  });
});

describe("the demo shows checklists actually being worked", () => {
  const taskById = new Map(MOCK_MAINTENANCE_TASKS.map((t) => [t.id, t]));
  const taskChecklist = (id: number) =>
    parseChecklistItems(taskById.get(id)!.description) ?? [];

  it("has a PARTLY-worked work order, each tick naming who and when", () => {
    // Work order 5 came off the Kitamura PM and is mid-shift. Ticked and
    // unticked side by side is the thing an empty checklist can never show.
    const parsed = taskChecklist(5);
    const ticked = parsed.filter((i) => i.checked);
    expect(ticked).toHaveLength(2);
    expect(parsed.some((i) => !i.checked)).toBe(true);
    for (const item of ticked) {
      expect(item.stamp).toContain("David Bulkley");
      expect(item.stamp).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    }
  });

  it("has a CLOSED-OUT work order with every step ticked and attributed", () => {
    const parsed = taskChecklist(13);
    expect(parsed.length).toBeGreaterThanOrEqual(5);
    expect(parsed.every((i) => i.checked)).toBe(true);
    expect(parsed.every((i) => (i.stamp ?? "").includes("David Bulkley"))).toBe(true);
    expect(taskById.get(13)!.status).toBe("Complete");
  });

  it("ticks nothing on a work order nobody has started", () => {
    // A ticked step on a job still in the backlog is a lie the demo would
    // tell about its own data.
    for (const task of MOCK_MAINTENANCE_TASKS) {
      if (task.status !== "Backlog") continue;
      expect((parseChecklistItems(task.description) ?? []).some((i) => i.checked)).toBe(false);
    }
  });
});

// =============================================================================
// The work order's own Department / Location, and the Operations project.
// =============================================================================

describe("the demo shows the work order's own department and location", () => {
  it("fills them in on some work orders and leaves others blank", () => {
    // Blank is the honest common case for a column added this week — a demo
    // where every row is filled in hides exactly what the dashboard's
    // "No department set" bucket exists to show.
    const withDept = MOCK_MAINTENANCE_TASKS.filter((t) => t.department);
    expect(withDept.length).toBeGreaterThan(0);
    expect(withDept.length).toBeLessThan(MOCK_MAINTENANCE_TASKS.length);
  });

  it("includes a work order with a department but NO asset at all", () => {
    // The case these columns exist for: a light, a door, a leaking pipe.
    const orphan = MOCK_MAINTENANCE_TASKS.find((t) => !t.equipment && t.department);
    expect(orphan).toBeDefined();
    expect(orphan?.location).toBeTruthy();
  });

  it("includes a work order whose department DIFFERS from its asset's", () => {
    // Proves the column is independent rather than an echo — and gives the
    // department filter something to disagree about.
    const assetDepartment = new Map(
      MOCK_EQUIPMENT.filter((e) => e.department).map((e) => [e.lookupId, e.department]),
    );
    const overridden = MOCK_MAINTENANCE_TASKS.find(
      (t) =>
        t.department &&
        t.equipment &&
        assetDepartment.has(t.equipment.lookupId) &&
        assetDepartment.get(t.equipment.lookupId) !== t.department,
    );
    expect(overridden).toBeDefined();
  });

  it("points a few records at a real Operations project, resolved by title", () => {
    const tagged = MOCK_MAINTENANCE_TASKS.filter((t) => t.operationsProject);
    expect(tagged.length).toBeGreaterThan(0);
    // Titled from the Operations module's own demo data, never invented here.
    for (const task of tagged) {
      expect(task.operationsProject?.title).toMatch(/^\d{4}-/);
    }
    expect(MOCK_SCHEDULED_MAINTENANCE.some((s) => s.operationsProject)).toBe(true);
  });
});
