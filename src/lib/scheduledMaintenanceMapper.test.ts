import { describe, it, expect } from "vitest";
import type { GraphListItem, Person, ScheduledMaintenance } from "@/types/task";
import {
  SCHEDULED_MAINTENANCE_SELECT,
  attachScheduleEquipmentTitles,
  attachScheduledMaintenancePeople,
  buildScheduledMaintenanceCreateFields,
  collectScheduledMaintenancePeople,
  compareScheduledMaintenance,
  scheduledMaintenanceLabel,
  toScheduledMaintenance,
} from "./scheduledMaintenanceMapper";

function item(fields: Record<string, unknown>, id = "4"): GraphListItem {
  return {
    id,
    createdDateTime: "2026-07-01T09:00:00Z",
    lastModifiedDateTime: "2026-07-02T09:00:00Z",
    fields: fields as GraphListItem["fields"],
  };
}

describe("SCHEDULED_MAINTENANCE_SELECT", () => {
  it("asks for BOTH halves of every single-person and single-lookup column", () => {
    const parts = SCHEDULED_MAINTENANCE_SELECT.split(",");
    for (const column of ["AssignedTo", "LastCompletedBy", "EquipmentRef"]) {
      expect(parts).toContain(column);
      expect(parts).toContain(`${column}LookupId`);
    }
  });

  it("does NOT ask for Communication — this list has no comment thread", () => {
    // A schedule is a rule; the conversation belongs on the work order it
    // produced. Selecting a column the list hasn't got 400s the whole read.
    expect(SCHEDULED_MAINTENANCE_SELECT.split(",")).not.toContain("Communication");
  });
});

describe("toScheduledMaintenance", () => {
  it("maps the columns it is given", () => {
    const s = toScheduledMaintenance(
      item({
        Title: " Weekly compressor walkaround ",
        Instructions: "Check oil, drain receiver.",
        Category: "Inspection",
        Priority: "Med",
        FrequencyInterval: 1,
        FrequencyUnit: "Weeks",
        ScheduleBasis: "Fixed",
        TimeNeeded: "2",
        GraceDays: 3,
        LeadTimeDays: 7,
        Active: true,
        RequiresShutdown: false,
        LOTORequired: true,
        Attachments: true,
      }),
    );
    expect(s.id).toBe(4);
    expect(s.title).toBe("Weekly compressor walkaround");
    expect(s.frequencyInterval).toBe(1);
    expect(s.frequencyUnit).toBe("Weeks");
    expect(s.scheduleBasis).toBe("Fixed");
    expect(s.timeNeeded).toBe(2);
    expect(s.graceDays).toBe(3);
    expect(s.leadTimeDays).toBe(7);
    expect(s.active).toBe(true);
    expect(s.requiresShutdown).toBe(false);
    expect(s.lotoRequired).toBe(true);
    expect(s.hasAttachments).toBe(true);
  });

  it("reads an absent Active as INACTIVE rather than guessing", () => {
    // Deliberate: a schedule with no Active value has never been switched on,
    // and projecting occurrences for it would put PMs on the calendar nobody
    // asked for. The create payload always writes Active for this reason.
    expect(toScheduledMaintenance(item({})).active).toBe(false);
  });

  it("nulls a frequency unit or basis it doesn't recognise", () => {
    const s = toScheduledMaintenance(item({ FrequencyUnit: "Fortnights", ScheduleBasis: "Drift" }));
    expect(s.frequencyUnit).toBeNull();
    expect(s.scheduleBasis).toBeNull();
  });

  it("reads a bare single-person lookupId and a bare equipment lookup", () => {
    const s = toScheduledMaintenance(
      item({ AssignedToLookupId: 24, LastCompletedByLookupId: 25, EquipmentRefLookupId: 2 }),
    );
    expect(s.assignedTo).toEqual({ displayName: "", lookupId: 24 });
    expect(s.lastCompletedBy).toEqual({ displayName: "", lookupId: 25 });
    expect(s.equipment).toEqual({ lookupId: 2, title: "" });
  });

  it("reads the three date-only columns through the midday pivot", () => {
    const s = toScheduledMaintenance(
      item({
        FirstDueDate: "2026-01-01T06:00:00Z",
        NextDueDate: "2026-06-30T23:00:00Z",
        LastCompleted: "2026-06-01T12:00:00Z",
      }),
    );
    expect(s.firstDueDate?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
    // 23:00Z is local midnight in a site ahead of UTC — the NEXT day.
    expect(s.nextDueDate?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(s.lastCompleted?.toISOString()).toBe("2026-06-01T12:00:00.000Z");
  });

  it("has no comments property to be quietly filled in", () => {
    expect(toScheduledMaintenance(item({}))).not.toHaveProperty("comments");
  });
});

describe("attachScheduledMaintenancePeople", () => {
  const directory = new Map<number, Person>([
    [24, { displayName: "David Bulkley", email: "d@b.com", lookupId: 24 }],
  ]);

  it("fills a bare lookupId in, and placeholders one nobody answers for", () => {
    const rows = [
      toScheduledMaintenance(item({ AssignedToLookupId: 24, LastCompletedByLookupId: 77 })),
    ];
    attachScheduledMaintenancePeople(rows, directory);
    expect(rows[0].assignedTo?.displayName).toBe("David Bulkley");
    expect(rows[0].lastCompletedBy?.displayName).toBe("User #77");
  });
});

describe("attachScheduleEquipmentTitles", () => {
  it("joins the asset name onto a bare equipment reference", () => {
    const rows = [toScheduledMaintenance(item({ EquipmentRefLookupId: 2 }))];
    attachScheduleEquipmentTitles(rows, [{ lookupId: 2, title: "20 HP COMPRESSOR" }]);
    expect(rows[0].equipment?.title).toBe("20 HP COMPRESSOR");
  });
});

describe("buildScheduledMaintenanceCreateFields", () => {
  it("ALWAYS sends the three booleans", () => {
    // A null boolean reads as blank in SharePoint's own views, and a schedule
    // that is neither on nor off is one nobody can tell the state of.
    const fields = buildScheduledMaintenanceCreateFields({ title: "PM" });
    expect(fields.Active).toBe(true);
    expect(fields.RequiresShutdown).toBe(false);
    expect(fields.LOTORequired).toBe(false);
  });

  it("seeds NextDueDate from FirstDueDate when the caller gave only the first", () => {
    const fields = buildScheduledMaintenanceCreateFields({
      title: "PM",
      firstDueDate: new Date("2026-09-01T00:00:00Z"),
    });
    expect(fields.FirstDueDate).toBe("2026-09-01T12:00:00Z");
    expect(fields.NextDueDate).toBe("2026-09-01T12:00:00Z");
  });

  it("writes the equipment lookup as a BARE integer", () => {
    const fields = buildScheduledMaintenanceCreateFields({ title: "PM", equipmentLookupId: 2 });
    expect(fields.EquipmentRefLookupId).toBe(2);
    expect(Object.keys(fields).some((k) => k.includes("@odata.type"))).toBe(false);
  });

  it("omits blank text but keeps a zero grace period", () => {
    const fields = buildScheduledMaintenanceCreateFields({
      title: "PM",
      instructions: "  ",
      graceDays: 0,
    });
    expect(fields).not.toHaveProperty("Instructions");
    expect(fields.GraceDays).toBe(0);
  });
});

describe("labels, ordering and people", () => {
  const base = toScheduledMaintenance(item({ Title: "Weekly walkaround", Active: true }));

  it("names a schedule by its title and asset, falling back sensibly", () => {
    expect(scheduledMaintenanceLabel({ ...base, equipment: { lookupId: 2, title: "20 HP" } })).toBe(
      "Weekly walkaround — 20 HP",
    );
    expect(scheduledMaintenanceLabel(base)).toBe("Weekly walkaround");
    expect(scheduledMaintenanceLabel({ ...base, title: "" })).toBe("Schedule #4");
  });

  it("puts active schedules first, then soonest due, then undated ones", () => {
    const rows: ScheduledMaintenance[] = [
      { ...base, id: 1, active: false, nextDueDate: new Date("2026-01-01") },
      { ...base, id: 2, active: true, nextDueDate: null, firstDueDate: null },
      { ...base, id: 3, active: true, nextDueDate: new Date("2026-09-01") },
      { ...base, id: 4, active: true, nextDueDate: new Date("2026-03-01") },
    ];
    expect(rows.sort(compareScheduledMaintenance).map((s) => s.id)).toEqual([4, 3, 2, 1]);
  });

  it("collects everyone on a schedule", () => {
    const s: ScheduledMaintenance = {
      ...base,
      assignedTo: { displayName: "A" },
      lastCompletedBy: { displayName: "B" },
      watchers: [{ displayName: "C" }],
    };
    expect(collectScheduledMaintenancePeople([s]).map((p) => p.displayName)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});
