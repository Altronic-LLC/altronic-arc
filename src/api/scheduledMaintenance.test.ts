import { describe, it, expect, beforeEach } from "vitest";
import * as scheduleApi from "./scheduledMaintenance";
import {
  createScheduledMaintenance,
  getScheduledMaintenance,
  listScheduledMaintenance,
  recordScheduleCompletion,
  resetScheduledMaintenanceMockStore,
  setScheduleActive,
  setScheduleAssignedTo,
  setScheduleEquipment,
  setScheduleWatchers,
  unwatchSchedule,
  updateScheduledMaintenanceFields,
  watchSchedule,
} from "./scheduledMaintenance";
import type { Person } from "@/types/task";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

const TECH: Person = { displayName: "David Bulkley", email: "d.b@altronic-llc.com", lookupId: 24 };
const day = (d: string) => new Date(`${d}T12:00:00Z`);

beforeEach(() => {
  resetScheduledMaintenanceMockStore();
});

describe("no delete", () => {
  it("exports nothing that deletes or removes a schedule", () => {
    // Retiring a schedule is `Active: false` — it then projects nothing, so it
    // leaves every calendar without orphaning the work orders that point at it.
    const offenders = Object.keys(scheduleApi).filter((name) => /delete|remove/i.test(name));
    expect(offenders).toEqual([]);
  });

  it("offers no comment thread either — this list has no Communication column", () => {
    const offenders = Object.keys(scheduleApi).filter((name) => /comment/i.test(name));
    expect(offenders).toEqual([]);
  });
});

describe("reading schedules", () => {
  it("lists active schedules before retired ones, soonest due first", async () => {
    const rows = await listScheduledMaintenance();
    expect(rows.length).toBeGreaterThan(5);
    const firstInactive = rows.findIndex((s) => !s.active);
    if (firstInactive >= 0) {
      expect(rows.slice(firstInactive).every((s) => !s.active)).toBe(true);
    }
  });

  it("includes a retired schedule and an overdue one in the demo data", async () => {
    const rows = await listScheduledMaintenance();
    expect(rows.some((s) => !s.active)).toBe(true);
    const now = Date.now();
    expect(rows.some((s) => s.active && (s.nextDueDate?.getTime() ?? Infinity) < now)).toBe(true);
  });

  it("has both a Fixed and a Floating schedule to demo", async () => {
    const bases = new Set((await listScheduledMaintenance()).map((s) => s.scheduleBasis));
    expect(bases).toContain("Fixed");
    expect(bases).toContain("Floating");
  });

  it("reads one back by id, and null for one that isn't there", async () => {
    const [first] = await listScheduledMaintenance();
    expect((await getScheduledMaintenance(first.id))?.id).toBe(first.id);
    expect(await getScheduledMaintenance(987654)).toBeNull();
  });
});

describe("creating a schedule", () => {
  it("defaults to active and seeds the next due date from the first", async () => {
    const created = await createScheduledMaintenance({
      title: "Quarterly filter change",
      frequencyInterval: 3,
      frequencyUnit: "Months",
      firstDueDate: day("2026-09-01"),
    });
    expect(created.active).toBe(true);
    expect(created.nextDueDate?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });

  it("makes the creator and the owner watchers", async () => {
    const creator: Person = { displayName: "Ray White", email: "ray@x.com", lookupId: 22 };
    const created = await createScheduledMaintenance(
      { title: "PM", assignedTo: TECH },
      creator,
    );
    const emails = created.watchers.map((w) => w.email);
    expect(emails).toContain(TECH.email);
    expect(emails).toContain(creator.email);
  });
});

describe("updating a schedule", () => {
  it("patches the columns it is given", async () => {
    const [s] = await listScheduledMaintenance();
    const updated = await updateScheduledMaintenanceFields(s.id, {
      Title: "Renamed",
      GraceDays: 9,
      LOTORequired: true,
    });
    expect(updated.title).toBe("Renamed");
    expect(updated.graceDays).toBe(9);
    expect(updated.lotoRequired).toBe(true);
  });

  it("throws for a schedule that isn't there", async () => {
    await expect(updateScheduledMaintenanceFields(987654, { Title: "x" })).rejects.toThrow(
      /not found/,
    );
  });

  it("retires and reinstates a schedule", async () => {
    const s = (await listScheduledMaintenance()).find((x) => x.active)!;
    expect((await setScheduleActive(s.id, false)).active).toBe(false);
    expect((await setScheduleActive(s.id, true)).active).toBe(true);
  });

  it("sets and clears the equipment reference", async () => {
    const [s] = await listScheduledMaintenance();
    expect((await setScheduleEquipment(s.id, 8)).equipment?.lookupId).toBe(8);
    expect((await setScheduleEquipment(s.id, null)).equipment).toBeNull();
  });
});

describe("owner and watchers", () => {
  it("makes the owner a watcher too, and clearing does not unwatch them", async () => {
    const [s] = await listScheduledMaintenance();
    const assigned = await setScheduleAssignedTo(s.id, TECH);
    expect(assigned.assignedTo).toEqual(TECH);
    expect(assigned.watchers.some((w) => w.email === TECH.email)).toBe(true);

    const cleared = await setScheduleAssignedTo(s.id, null);
    expect(cleared.assignedTo).toBeNull();
    expect(cleared.watchers.some((w) => w.email === TECH.email)).toBe(true);
  });

  it("watch is idempotent, unwatch removes one person", async () => {
    const [s] = await listScheduledMaintenance();
    await setScheduleWatchers(s.id, []);
    expect((await watchSchedule(s.id, TECH)).watchers).toHaveLength(1);
    expect((await watchSchedule(s.id, TECH)).watchers).toHaveLength(1);
    expect((await unwatchSchedule(s.id, TECH)).watchers).toHaveLength(0);
  });

  it("throws for a schedule that isn't there", async () => {
    await expect(watchSchedule(987654, TECH)).rejects.toThrow(/not found/);
    await expect(unwatchSchedule(987654, TECH)).rejects.toThrow(/not found/);
  });
});

describe("recording a completion", () => {
  it("Fixed rolls on from the DUE date, not the completion date", async () => {
    const [s] = await listScheduledMaintenance();
    const fixed = await updateScheduledMaintenanceFields(s.id, {
      ScheduleBasis: "Fixed",
      FrequencyInterval: 1,
      FrequencyUnit: "Months",
      NextDueDate: day("2026-06-01").toISOString(),
      Active: true,
    });
    const done = await recordScheduleCompletion(fixed.id, {
      completedOn: day("2026-06-09"),
      completedBy: TECH,
    });
    expect(done.lastCompleted?.toISOString().slice(0, 10)).toBe("2026-06-09");
    expect(done.lastCompletedBy).toEqual(TECH);
    expect(done.nextDueDate?.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("Floating rolls on from the COMPLETION date", async () => {
    const [s] = await listScheduledMaintenance();
    const floating = await updateScheduledMaintenanceFields(s.id, {
      ScheduleBasis: "Floating",
      FrequencyInterval: 90,
      FrequencyUnit: "Days",
      NextDueDate: day("2026-06-01").toISOString(),
      LastCompleted: null,
      Active: true,
    });
    const done = await recordScheduleCompletion(floating.id, {
      completedOn: day("2026-06-09"),
      completedBy: TECH,
    });
    expect(done.nextDueDate?.toISOString().slice(0, 10)).toBe("2026-09-07");
  });

  it("leaves NextDueDate ALONE when there is nothing to advance", async () => {
    // Blanking it would silently retire a schedule somebody only meant to
    // tick off.
    const [s] = await listScheduledMaintenance();
    const oneOff = await updateScheduledMaintenanceFields(s.id, {
      FrequencyUnit: null,
      NextDueDate: day("2026-06-01").toISOString(),
      Active: true,
    });
    const done = await recordScheduleCompletion(oneOff.id, {
      completedOn: day("2026-06-09"),
      completedBy: TECH,
    });
    expect(done.nextDueDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(done.lastCompleted?.toISOString().slice(0, 10)).toBe("2026-06-09");
  });

  it("throws for a schedule that isn't there", async () => {
    await expect(
      recordScheduleCompletion(987654, { completedOn: new Date(), completedBy: TECH }),
    ).rejects.toThrow(/not found/);
  });
});
