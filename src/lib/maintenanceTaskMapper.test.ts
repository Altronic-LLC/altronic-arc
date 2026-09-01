import { describe, it, expect } from "vitest";
import type { GraphListItem, MaintenanceTask, Person } from "@/types/task";
import {
  MAINTENANCE_TASK_SELECT,
  attachMaintenanceTaskPeople,
  attachMaintenanceTaskReferences,
  buildMaintenanceTaskCreateFields,
  collectMaintenanceTaskPeople,
  compareMaintenanceTasks,
  isMaintenanceTaskClosed,
  maintenanceTaskLabel,
  maintenanceTaskTypeFor,
  toMaintenanceTask,
} from "./maintenanceTaskMapper";

function item(fields: Record<string, unknown>, id = "7"): GraphListItem {
  return {
    id,
    createdDateTime: "2026-08-01T09:00:00Z",
    lastModifiedDateTime: "2026-08-02T09:00:00Z",
    fields: fields as GraphListItem["fields"],
  };
}

describe("MAINTENANCE_TASK_SELECT", () => {
  it("asks for BOTH halves of every single-person column", () => {
    // Selecting only the friendly name is what read FAIT's three person
    // columns as nobody on every row — Graph returns a bare lookupId.
    for (const column of ["Assigned", "ReportedBy", "CompletedBy"]) {
      const parts = MAINTENANCE_TASK_SELECT.split(",");
      expect(parts).toContain(column);
      expect(parts).toContain(`${column}LookupId`);
    }
  });

  it("asks for BOTH halves of every single lookup column", () => {
    for (const column of [
      "EquipmentRef",
      "ScheduledMaintenanceRef",
      "OperationsTaskReference",
      "OperationsProjectRef",
    ]) {
      const parts = MAINTENANCE_TASK_SELECT.split(",");
      expect(parts).toContain(column);
      expect(parts).toContain(`${column}LookupId`);
    }
  });

  it("still reads DueStatus — it is read-only, not invisible", () => {
    expect(MAINTENANCE_TASK_SELECT.split(",")).toContain("DueStatus");
  });

  it("reads BOTH halves of the Department / Location lookups, and neither old choice column", () => {
    const parts = MAINTENANCE_TASK_SELECT.split(",");
    expect(parts).toContain("DepartmentRef");
    expect(parts).toContain("DepartmentRefLookupId");
    expect(parts).toContain("LocationRef");
    expect(parts).toContain("LocationRefLookupId");
    // The old CHOICE columns were only ever created on the Equipment List.
    // Selecting a column a list hasn't got 400s the WHOLE read, so a
    // well-meaning "keep reading the old one too" here breaks every work order.
    expect(parts).not.toContain("Department");
    expect(parts).not.toContain("Location");
  });
});

describe("the work order's own Department, Location and Operations project", () => {
  it("reads all three as title-less lookups, joined later", () => {
    // Graph hands a SINGLE-value lookup back as a bare `<Name>LookupId` with
    // no title attached — `attachMaintenanceTaskReferences` fills those in.
    const task = toMaintenanceTask(
      item({
        DepartmentRefLookupId: 3,
        LocationRefLookupId: 22,
        OperationsProjectRefLookupId: 4,
      }),
    );
    expect(task.department).toEqual({ lookupId: 3, title: "" });
    expect(task.location).toEqual({ lookupId: 22, title: "" });
    expect(task.operationsProject).toEqual({ lookupId: 4, title: "" });
  });

  it("joins the titles against the two reference lists", () => {
    const tasks = [toMaintenanceTask(item({ DepartmentRefLookupId: 3, LocationRefLookupId: 22 }))];
    attachMaintenanceTaskReferences(
      tasks,
      [],
      [],
      [],
      [],
      [{ lookupId: 3, title: "Panels", active: true, note: "" }],
      [{ lookupId: 22, title: "HARNESS DEPARMENT", active: false, note: "" }],
    );
    expect(tasks[0].department).toEqual({ lookupId: 3, title: "Panels" });
    // A RETIRED value still resolves: retiring takes it out of the pickers,
    // never off the records already pointing at it.
    expect(tasks[0].location).toEqual({ lookupId: 22, title: "HARNESS DEPARMENT" });
  });

  it("leaves a department the reference list hasn't got VISIBLE, never blank", () => {
    // A value that IS set must not read as unset, or the next person to open
    // the work order overwrites it without knowing it was there.
    const tasks = [toMaintenanceTask(item({ DepartmentRefLookupId: 41 }))];
    attachMaintenanceTaskReferences(tasks, [], [], [], [], [], []);
    expect(tasks[0].department).toEqual({ lookupId: 41, title: "" });
  });

  // The columns may not exist in SharePoint yet, and half the rows will never
  // carry them. Neither case may throw or invent a value.
  it("reads a column the list hasn't got as null, not as a blank string", () => {
    const task = toMaintenanceTask(item({}));
    expect(task.department).toBeNull();
    expect(task.location).toBeNull();
    expect(task.operationsProject).toBeNull();
  });

  // The old choice columns were never created on this list. Even if a payload
  // somehow carried them, they are not what the domain reads — reading them
  // here would be reading a column the live list hasn't got.
  it("IGNORES the legacy choice columns entirely on this list", () => {
    const task = toMaintenanceTask(
      item({ Department: "SOMEWHERE NEW", Location: "HARNESS DEPARMENT" }),
    );
    expect(task.department).toBeNull();
    expect(task.location).toBeNull();
  });
});

describe("toMaintenanceTask", () => {
  it("maps the columns it is given", () => {
    const task = toMaintenanceTask(
      item({
        Title: "  Compressor tripping  ",
        WONumber: "WO-2026-0004",
        Description: "Trips at full load.",
        Status: "Started",
        Priority: "Emergency",
        Category: "Corrective / Repair",
        DueStatus: "Late",
        StartDate: "2026-08-01T06:00:00Z",
        DueDate: "2026-08-05T06:00:00Z",
        LaborHours: 4.5,
        DowntimeHours: "2",
        TechNotes: "Cooler blocked.",
        Attachments: true,
      }),
    );

    expect(task.id).toBe(7);
    expect(task.title).toBe("Compressor tripping");
    expect(task.woNumber).toBe("WO-2026-0004");
    expect(task.status).toBe("Started");
    expect(task.priority).toBe("Emergency");
    expect(task.category).toBe("Corrective / Repair");
    expect(task.dueStatus).toBe("Late");
    expect(task.laborHours).toBe(4.5);
    // Graph hands a number back as a string on some lists.
    expect(task.downtimeHours).toBe(2);
    expect(task.hasAttachments).toBe(true);
  });

  it("falls back to Backlog for a status it doesn't recognise, and null for the rest", () => {
    const task = toMaintenanceTask(item({ Status: "Whatever", Priority: "Urgent" }));
    expect(task.status).toBe("Backlog");
    expect(task.priority).toBeNull();
    expect(task.category).toBeNull();
    expect(task.dueStatus).toBeNull();
  });

  it("reads a single-person column handed back as a BARE lookupId", () => {
    const task = toMaintenanceTask(
      item({ AssignedLookupId: 46, ReportedByLookupId: "22", CompletedByLookupId: 0 }),
    );
    expect(task.assigned).toEqual({ displayName: "", lookupId: 46 });
    expect(task.reportedBy).toEqual({ displayName: "", lookupId: 22 });
    // A zero lookupId means unset, not "user #0".
    expect(task.completedBy).toBeNull();
  });

  it("reads a single-person column handed back EXPANDED", () => {
    const task = toMaintenanceTask(
      item({ Assigned: { LookupId: 46, LookupValue: "David Bulkley", Email: "d@b.com" } }),
    );
    expect(task.assigned).toMatchObject({ displayName: "David Bulkley", lookupId: 46 });
  });

  it("reads a bare single lookup as a title-less reference", () => {
    const task = toMaintenanceTask(
      item({ EquipmentRefLookupId: 3, ScheduledMaintenanceRefLookupId: 9 }),
    );
    expect(task.equipment).toEqual({ lookupId: 3, title: "" });
    expect(task.scheduleRef).toEqual({ lookupId: 9, title: "" });
  });

  it("derives TaskType from the schedule reference, not from the stored column", () => {
    // The column is ARC's to set; a row whose TaskType disagrees with its
    // schedule reference is wrong, and the reference is the one that decides.
    const off = toMaintenanceTask(item({ TaskType: "Regular Maintenance" }));
    expect(off.taskType).toBe("Request");

    const on = toMaintenanceTask(
      item({ TaskType: "Request", ScheduledMaintenanceRefLookupId: 4 }),
    );
    expect(on.taskType).toBe("Regular Maintenance");
  });

  it("reads the date-only columns through the midday pivot", () => {
    // Stored at local midnight in a site ahead of UTC — the day the
    // SharePoint view shows is the NEXT one.
    const task = toMaintenanceTask(item({ DueDate: "2026-08-04T23:00:00Z" }));
    expect(task.dueDate?.toISOString()).toBe("2026-08-05T12:00:00.000Z");
  });

  it("reads Created/Modified as timestamps, NOT through the date-only pivot", () => {
    const task = toMaintenanceTask(
      item({ Created: "2026-08-01T18:30:00Z", Modified: "2026-08-02T18:30:00Z" }),
    );
    // A 18:30 stamp must stay on the 1st — the midday pivot would move it.
    expect(task.createdAt.toISOString()).toBe("2026-08-01T18:30:00.000Z");
    expect(task.modifiedAt.toISOString()).toBe("2026-08-02T18:30:00.000Z");
  });

  it("falls back to the item's own timestamps when the columns are absent", () => {
    const task = toMaintenanceTask(item({}));
    expect(task.createdAt.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });

  it("parses the comment thread out of Communication", () => {
    const raw = "08/01/2026 10:00:00 AM|||Ray White|||ray@x.com|||<p>Looked at it.</p>";
    expect(toMaintenanceTask(item({ Communication: raw })).comments).toHaveLength(1);
  });
});

describe("maintenanceTaskTypeFor", () => {
  it("is Regular Maintenance with a schedule and a Request without one", () => {
    expect(maintenanceTaskTypeFor(4)).toBe("Regular Maintenance");
    expect(maintenanceTaskTypeFor(null)).toBe("Request");
    expect(maintenanceTaskTypeFor(undefined)).toBe("Request");
    expect(maintenanceTaskTypeFor(0)).toBe("Request");
  });
});

describe("attachMaintenanceTaskPeople", () => {
  const directory = new Map<number, Person>([
    [46, { displayName: "David Bulkley", email: "d@b.com", lookupId: 46 }],
  ]);

  it("fills a bare lookupId in from the site directory", () => {
    const tasks = [toMaintenanceTask(item({ AssignedLookupId: 46 }))];
    attachMaintenanceTaskPeople(tasks, directory);
    expect(tasks[0].assigned?.displayName).toBe("David Bulkley");
  });

  it("shows an unresolvable id as a placeholder, NEVER as unset", () => {
    // A person column that IS set must not look empty, or the next person to
    // open the work order reassigns it without knowing.
    const tasks = [toMaintenanceTask(item({ AssignedLookupId: 99 }))];
    attachMaintenanceTaskPeople(tasks, directory);
    expect(tasks[0].assigned?.displayName).toBe("User #99");
    expect(tasks[0].assigned?.lookupId).toBe(99);
  });
});

describe("attachMaintenanceTaskReferences", () => {
  it("joins the equipment, schedule and Operations task titles", () => {
    const tasks = [
      toMaintenanceTask(
        item({
          EquipmentRefLookupId: 3,
          ScheduledMaintenanceRefLookupId: 9,
          OperationsTaskReferenceLookupId: 5,
        }),
      ),
    ];
    attachMaintenanceTaskReferences(
      tasks,
      [{ lookupId: 3, title: "40 HP COMPRESSOR" }],
      [{ id: 9, title: "Weekly walkaround" } as never],
      [{ lookupId: 5, title: "Task 0003-1" }],
    );
    expect(tasks[0].equipment?.title).toBe("40 HP COMPRESSOR");
    expect(tasks[0].scheduleRef?.title).toBe("Weekly walkaround");
    expect(tasks[0].operationsTaskRef?.title).toBe("Task 0003-1");
  });

  it("leaves a reference alone when nothing in the loaded lists matches", () => {
    const tasks = [toMaintenanceTask(item({ EquipmentRefLookupId: 3 }))];
    attachMaintenanceTaskReferences(tasks, [], [], []);
    expect(tasks[0].equipment).toEqual({ lookupId: 3, title: "" });
  });

  it("joins the Operations project title against the loaded reference list", () => {
    // Graph returns this lookup as a bare id with no title, exactly like the
    // other three — without the join the picker shows a blank option.
    const tasks = [toMaintenanceTask(item({ OperationsProjectRefLookupId: 4 }))];
    attachMaintenanceTaskReferences(tasks, [], [], [], [
      { lookupId: 4, title: "0003-Shop Floor Relayout" },
    ]);
    expect(tasks[0].operationsProject?.title).toBe("0003-Shop Floor Relayout");
  });

  it("leaves the Operations project title empty when the list is unavailable", () => {
    const tasks = [toMaintenanceTask(item({ OperationsProjectRefLookupId: 4 }))];
    attachMaintenanceTaskReferences(tasks, [], [], []);
    expect(tasks[0].operationsProject).toEqual({ lookupId: 4, title: "" });
  });
});

describe("buildMaintenanceTaskCreateFields", () => {
  it("NEVER sends DueStatus — a Power Automate flow owns that column", () => {
    const fields = buildMaintenanceTaskCreateFields({ title: "Fix it" }, "WO-2026-0001");
    expect(fields).not.toHaveProperty("DueStatus");
  });

  it("derives TaskType rather than taking it from the caller", () => {
    expect(buildMaintenanceTaskCreateFields({ title: "x" }, "WO-1").TaskType).toBe("Request");
    expect(
      buildMaintenanceTaskCreateFields({ title: "x", scheduleLookupId: 4 }, "WO-1").TaskType,
    ).toBe("Regular Maintenance");
  });

  it("writes single lookups as BARE integers", () => {
    // multiLookupField's Collection(Edm.Int32) annotation is for MULTI-value
    // columns and 400s on these.
    const fields = buildMaintenanceTaskCreateFields(
      { title: "x", equipmentLookupId: 3, scheduleLookupId: 9, operationsTaskLookupId: 5 },
      "WO-1",
    );
    expect(fields.EquipmentRefLookupId).toBe(3);
    expect(fields.ScheduledMaintenanceRefLookupId).toBe(9);
    expect(fields.OperationsTaskReferenceLookupId).toBe(5);
    expect(Object.keys(fields).some((k) => k.includes("@odata.type"))).toBe(false);
  });

  it("writes the Operations project lookup as a BARE integer too", () => {
    const fields = buildMaintenanceTaskCreateFields(
      { title: "x", operationsProjectLookupId: 4 },
      "WO-1",
    );
    expect(fields.OperationsProjectRefLookupId).toBe(4);
    expect(fields).not.toHaveProperty("OperationsProjectRefLookupId@odata.type");
  });

  it("writes the work order's own Department and Location as BARE integers", () => {
    // Both are single LOOKUPS since 2026-08-28 (`DepartmentRef` /
    // `LocationRef`). `multiLookupField`'s Collection(Edm.Int32) annotation is
    // for MULTI-value columns and 400s on these.
    const fields = buildMaintenanceTaskCreateFields(
      { title: "x", departmentLookupId: 6, locationLookupId: 41 },
      "WO-1",
    );
    expect(fields.DepartmentRefLookupId).toBe(6);
    expect(fields.LocationRefLookupId).toBe(41);
    expect(fields).not.toHaveProperty("DepartmentRefLookupId@odata.type");
    expect(fields).not.toHaveProperty("LocationRefLookupId@odata.type");
    // The old choice columns were never created on this list; writing one
    // would be refused.
    expect(fields).not.toHaveProperty("Department");
    expect(fields).not.toHaveProperty("Location");
  });

  // A work order raised against a light or a leaking pipe has no asset at
  // all, and all three of these are optional — none of them may be required
  // to create one, and a blank is omitted like every other blank column.
  it("omits all three when they are blank, with no equipment reference either", () => {
    const fields = buildMaintenanceTaskCreateFields(
      { title: "Replace the bench 7 quick couplers" },
      "WO-1",
    );
    expect(fields).not.toHaveProperty("DepartmentRefLookupId");
    expect(fields).not.toHaveProperty("LocationRefLookupId");
    expect(fields).not.toHaveProperty("OperationsProjectRefLookupId");
    expect(fields).not.toHaveProperty("EquipmentRefLookupId");
    expect(fields.Title).toBe("Replace the bench 7 quick couplers");
  });

  it("omits blank text columns and writes dates at midday UTC", () => {
    const fields = buildMaintenanceTaskCreateFields(
      { title: "x", description: "   ", dueDate: new Date("2026-08-05T00:00:00Z") },
      "WO-1",
    );
    expect(fields).not.toHaveProperty("Description");
    expect(fields.DueDate).toBe("2026-08-05T12:00:00Z");
  });

  it("defaults the status to Backlog", () => {
    expect(buildMaintenanceTaskCreateFields({ title: "x" }, "WO-1").Status).toBe("Backlog");
  });
});

describe("labels, ordering and people", () => {
  const base = toMaintenanceTask(item({ Title: "Fix the compressor", WONumber: "WO-2026-0002" }));

  it("leads with the WO number and falls back sensibly", () => {
    expect(maintenanceTaskLabel(base)).toBe("WO-2026-0002 — Fix the compressor");
    expect(maintenanceTaskLabel({ ...base, woNumber: "" })).toBe("Fix the compressor");
    expect(maintenanceTaskLabel({ ...base, woNumber: "", title: "" })).toBe("Work order #7");
  });

  it("orders newest first", () => {
    const older = { ...base, id: 1, createdAt: new Date("2026-01-01") } as MaintenanceTask;
    const newer = { ...base, id: 2, createdAt: new Date("2026-06-01") } as MaintenanceTask;
    expect([older, newer].sort(compareMaintenanceTasks)[0].id).toBe(2);
  });

  it("collects every person on a work order for the mention picker", () => {
    const task: MaintenanceTask = {
      ...base,
      assigned: { displayName: "A" },
      reportedBy: { displayName: "B" },
      completedBy: null,
      watchers: [{ displayName: "C" }],
    };
    expect(collectMaintenanceTaskPeople([task]).map((p) => p.displayName)).toEqual(["A", "B", "C"]);
  });

  it("knows which statuses mean no more work is expected", () => {
    expect(isMaintenanceTaskClosed({ ...base, status: "Complete" })).toBe(true);
    expect(isMaintenanceTaskClosed({ ...base, status: "Canceled" })).toBe(true);
    expect(isMaintenanceTaskClosed({ ...base, status: "Awaiting Parts" })).toBe(false);
  });
});
