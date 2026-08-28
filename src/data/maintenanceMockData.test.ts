import { describe, it, expect } from "vitest";
import {
  MOCK_EQUIPMENT,
  MOCK_MAINTENANCE_PEOPLE,
  MOCK_MAINTENANCE_TASKS,
  MOCK_SCHEDULED_MAINTENANCE,
} from "./maintenanceMockData";
import { isOverdue, nextDueDates } from "@/lib/maintenanceSchedule";

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
