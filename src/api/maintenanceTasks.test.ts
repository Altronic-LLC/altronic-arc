import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import * as maintenanceApi from "./maintenanceTasks";
import {
  addMaintenanceComment,
  completeMaintenanceTask,
  createMaintenanceTask,
  editMaintenanceComment,
  getMaintenanceTask,
  listMaintenanceTasks,
  nextMaintenanceWorkOrderNumber,
  resetMaintenanceMockStore,
  setMaintenanceTaskAssigned,
  setMaintenanceTaskEquipment,
  setMaintenanceTaskSchedule,
  setMaintenanceTaskWatchers,
  stripFlowOwnedColumns,
  unwatchMaintenanceTask,
  updateMaintenanceTaskFields,
  watchMaintenanceTask,
} from "./maintenanceTasks";
import type { Person } from "@/types/task";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

const TECH: Person = { displayName: "David Bulkley", email: "d.b@altronic-llc.com", lookupId: 24 };

beforeEach(() => {
  resetMaintenanceMockStore();
});

describe("no delete", () => {
  it("exports nothing that deletes or removes a work order", () => {
    // A work order is the record of work that was done — deleting one takes
    // its labour hours, downtime and failure cause with it. A superseded one
    // is Canceled, not removed.
    const offenders = Object.keys(maintenanceApi).filter((name) => /delete|remove/i.test(name));
    expect(offenders).toEqual([]);
  });
});

describe("stripFlowOwnedColumns", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops DueStatus from any write, and says so", () => {
    // A Power Automate flow owns that column. Anything ARC put there would be
    // overwritten minutes later while reading, in between, as ARC's judgement.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(stripFlowOwnedColumns({ Status: "Started", DueStatus: "On-Track" })).toEqual({
      Status: "Started",
    });
    expect(warn).toHaveBeenCalled();
  });

  it("leaves an ordinary write untouched", () => {
    const fields = { Status: "Started", Priority: "High" };
    expect(stripFlowOwnedColumns(fields)).toEqual(fields);
  });
});

describe("reading work orders", () => {
  it("lists them newest first", async () => {
    const tasks = await listMaintenanceTasks();
    expect(tasks.length).toBeGreaterThan(20);
    const created = tasks.map((t) => t.createdAt.getTime());
    expect([...created].sort((a, b) => b - a)).toEqual(created);
  });

  it("covers every status in the demo data", async () => {
    const statuses = new Set((await listMaintenanceTasks()).map((t) => t.status));
    for (const status of [
      "Backlog",
      "Up Next",
      "Started",
      "Awaiting Parts",
      "On Hold",
      "Complete",
      "Canceled",
    ]) {
      expect(statuses).toContain(status);
    }
  });

  it("reads one back by id, and null for one that isn't there", async () => {
    const [first] = await listMaintenanceTasks();
    expect((await getMaintenanceTask(first.id))?.id).toBe(first.id);
    expect(await getMaintenanceTask(987654)).toBeNull();
  });
});

describe("creating a work order", () => {
  it("generates the next WO number for the year", async () => {
    const expected = await nextMaintenanceWorkOrderNumber();
    const created = await createMaintenanceTask({ title: "Replace the belt" });
    expect(created.woNumber).toBe(expected);
    expect(created.woNumber).toMatch(/^WO-\d{4}-\d{4}$/);
  });

  it("honours a WO number the caller supplied", async () => {
    const created = await createMaintenanceTask({ title: "x", woNumber: "WO-2026-9001" });
    expect(created.woNumber).toBe("WO-2026-9001");
  });

  it("sets TaskType from the schedule reference, never from the caller", async () => {
    const request = await createMaintenanceTask({ title: "Ad-hoc fix" });
    expect(request.taskType).toBe("Request");

    const scheduled = await createMaintenanceTask({ title: "Monthly PM", scheduleLookupId: 3 });
    expect(scheduled.taskType).toBe("Regular Maintenance");
  });

  it("records who raised it and leaves DueStatus to the flow", async () => {
    const created = await createMaintenanceTask({ title: "x" }, TECH);
    expect(created.reportedBy).toEqual(TECH);
    expect(created.dueStatus).toBeNull();
  });

  it("puts the new work order at the top of the list", async () => {
    const created = await createMaintenanceTask({ title: "Newest" });
    const [first] = await listMaintenanceTasks();
    expect(first.id).toBe(created.id);
  });
});

describe("updating a work order", () => {
  it("patches the columns it is given", async () => {
    const [task] = await listMaintenanceTasks();
    const updated = await updateMaintenanceTaskFields(task.id, {
      Status: "On Hold",
      Priority: "Low",
      TechNotes: "Parked until the shutdown.",
    });
    expect(updated.status).toBe("On Hold");
    expect(updated.priority).toBe("Low");
    expect(updated.techNotes).toBe("Parked until the shutdown.");
  });

  it("REFUSES to write DueStatus even when a caller asks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const task = (await listMaintenanceTasks()).find((t) => t.dueStatus === null)!;
    const updated = await updateMaintenanceTaskFields(task.id, { DueStatus: "Late" });
    expect(updated.dueStatus).toBeNull();
    warn.mockRestore();
  });

  it("throws for a work order that isn't there", async () => {
    await expect(updateMaintenanceTaskFields(987654, { Status: "Started" })).rejects.toThrow(
      /not found/,
    );
  });

  it("writes TaskType in the SAME call as the schedule reference", async () => {
    // Letting the two be set separately is how a "Regular Maintenance" work
    // order ends up with no schedule behind it.
    const task = (await listMaintenanceTasks()).find((t) => !t.scheduleRef)!;
    const linked = await setMaintenanceTaskSchedule(task.id, 3);
    expect(linked.scheduleRef?.lookupId).toBe(3);
    expect(linked.taskType).toBe("Regular Maintenance");

    const unlinked = await setMaintenanceTaskSchedule(task.id, null);
    expect(unlinked.scheduleRef).toBeNull();
    expect(unlinked.taskType).toBe("Request");
  });

  it("sets and clears the equipment reference", async () => {
    const [task] = await listMaintenanceTasks();
    expect((await setMaintenanceTaskEquipment(task.id, 7))?.equipment?.lookupId).toBe(7);
    expect((await setMaintenanceTaskEquipment(task.id, null))?.equipment).toBeNull();
  });
});

describe("assigning and watching", () => {
  it("makes the assignee a watcher too", async () => {
    const task = (await listMaintenanceTasks()).find((t) => !t.assigned)!;
    const updated = await setMaintenanceTaskAssigned(task.id, TECH);
    expect(updated.assigned).toEqual(TECH);
    expect(updated.watchers.some((w) => w.email === TECH.email)).toBe(true);
  });

  it("clearing an assignment does NOT unwatch anybody", async () => {
    // The house rule everywhere in ARC — Unwatch is the deliberate way off.
    const task = (await listMaintenanceTasks()).find((t) => !t.assigned)!;
    await setMaintenanceTaskAssigned(task.id, TECH);
    const cleared = await setMaintenanceTaskAssigned(task.id, null);
    expect(cleared.assigned).toBeNull();
    expect(cleared.watchers.some((w) => w.email === TECH.email)).toBe(true);
  });

  it("watch is idempotent and unwatch removes exactly one person", async () => {
    const [task] = await listMaintenanceTasks();
    await setMaintenanceTaskWatchers(task.id, []);
    const once = await watchMaintenanceTask(task.id, TECH);
    const twice = await watchMaintenanceTask(task.id, TECH);
    expect(once.watchers).toHaveLength(1);
    expect(twice.watchers).toHaveLength(1);
    expect((await unwatchMaintenanceTask(task.id, TECH)).watchers).toHaveLength(0);
  });

  it("unwatching somebody who wasn't watching changes nothing", async () => {
    const [task] = await listMaintenanceTasks();
    const before = (await getMaintenanceTask(task.id))!.watchers.length;
    const after = await unwatchMaintenanceTask(task.id, {
      displayName: "Nobody",
      email: "nobody@x.com",
    });
    expect(after.watchers).toHaveLength(before);
  });
});

describe("comments", () => {
  const comment = {
    authorName: "David Bulkley",
    authorEmail: "d.b@altronic-llc.com",
    bodyHtml: "<p>Cooler cleaned.</p>",
  };

  it("posts a comment to the top of the thread", async () => {
    const [task] = await listMaintenanceTasks();
    const updated = await addMaintenanceComment(task.id, comment);
    expect(updated.comments[0].bodyHtml).toBe("<p>Cooler cleaned.</p>");
  });

  it("edits an existing comment in place, matched on timestamp + author", async () => {
    const [task] = await listMaintenanceTasks();
    const posted = await addMaintenanceComment(task.id, comment);
    const target = { timestamp: posted.comments[0].timestamp, authorEmail: comment.authorEmail };
    const edited = await editMaintenanceComment(task.id, target, "<p>Cooler cleaned and tested.</p>");
    expect(edited.comments[0].bodyHtml).toBe("<p>Cooler cleaned and tested.</p>");
    expect(edited.comments).toHaveLength(posted.comments.length);
  });

  it("throws on a work order that isn't there", async () => {
    await expect(addMaintenanceComment(987654, comment)).rejects.toThrow(/not found/);
    await expect(
      editMaintenanceComment(987654, { timestamp: new Date(), authorEmail: "x@y.com" }, "<p>x</p>"),
    ).rejects.toThrow(/not found/);
  });
});

describe("completing a work order", () => {
  it("writes status, completion date and who did it together", async () => {
    const task = (await listMaintenanceTasks()).find((t) => t.status !== "Complete")!;
    const completedOn = new Date("2026-08-20T00:00:00Z");
    const done = await completeMaintenanceTask(task.id, {
      completedBy: TECH,
      completedOn,
      resolution: "Replaced the element.",
      laborHours: 3,
      downtimeHours: 5,
    });
    expect(done.status).toBe("Complete");
    expect(done.completedBy).toEqual(TECH);
    // A date-only column: midday UTC, so no browser shifts it a day.
    expect(done.completedDate?.toISOString()).toBe("2026-08-20T12:00:00.000Z");
    expect(done.resolution).toBe("Replaced the element.");
    expect(done.laborHours).toBe(3);
    expect(done.downtimeHours).toBe(5);
  });

  it("records the completion date it was GIVEN, not today", async () => {
    // A job finished on Friday and keyed in on Monday records Friday.
    const task = (await listMaintenanceTasks()).find((t) => t.status !== "Complete")!;
    const done = await completeMaintenanceTask(task.id, {
      completedBy: TECH,
      completedOn: new Date("2020-01-02T00:00:00Z"),
    });
    expect(done.completedDate?.toISOString().slice(0, 10)).toBe("2020-01-02");
  });

  it("merges extraFields into the SAME write", async () => {
    // How the completion guard assigns an unassigned work order to whoever
    // closed it out without a second write.
    const task = (await listMaintenanceTasks()).find((t) => !t.assigned)!;
    const done = await completeMaintenanceTask(task.id, {
      completedBy: TECH,
      completedOn: new Date("2026-08-20T00:00:00Z"),
      extraFields: { Assigned: TECH, Watchers: [TECH] },
    });
    expect(done.status).toBe("Complete");
    expect(done.assigned).toEqual(TECH);
  });
});
