import { describe, it, expect } from "vitest";
import { toOperationsTask } from "./operationsTaskMapper";
import type { GraphListItem, OperationsTaskItemFields } from "@/types/task";

function makeItem(
  fields: OperationsTaskItemFields = {},
  overrides: Partial<GraphListItem> = {},
): GraphListItem {
  return {
    id: "4",
    createdDateTime: "2025-07-02T18:46:32Z",
    lastModifiedDateTime: "2026-04-28T13:48:27Z",
    fields: fields as GraphListItem["fields"],
    ...overrides,
  };
}

describe("toOperationsTask — basic mapping", () => {
  it("parses numeric id from string", () => {
    expect(toOperationsTask(makeItem({}, { id: "4" })).id).toBe(4);
  });

  it("maps title, description, and taskNumber", () => {
    const t = toOperationsTask(
      makeItem({ Title: "PVA Install", TaskDescription: "Install the machine", TaskNumber: "Task 0002-4" }),
    );
    expect(t.title).toBe("PVA Install");
    expect(t.description).toBe("Install the machine");
    expect(t.taskNumber).toBe("Task 0002-4");
  });

  it("falls back to (untitled) when Title missing", () => {
    expect(toOperationsTask(makeItem({})).title).toBe("(untitled)");
  });

  it("defaults taskNumber/description to empty string when missing", () => {
    const t = toOperationsTask(makeItem({}));
    expect(t.taskNumber).toBe("");
    expect(t.description).toBe("");
  });
});

describe("toOperationsTask — status / priority / taskType / location clamping", () => {
  it("keeps a valid status", () => {
    expect(toOperationsTask(makeItem({ Status: "WIP" })).status).toBe("WIP");
  });

  it("clamps invalid or missing status to Backlog", () => {
    expect(toOperationsTask(makeItem({ Status: "Bogus" })).status).toBe("Backlog");
    expect(toOperationsTask(makeItem({})).status).toBe("Backlog");
  });

  it("keeps a valid priority ('Med', not 'Medium')", () => {
    expect(toOperationsTask(makeItem({ PriorityRequest: "Med" })).priority).toBe("Med");
  });

  it("returns null for invalid/missing priority", () => {
    expect(toOperationsTask(makeItem({ PriorityRequest: "Medium" })).priority).toBeNull();
    expect(toOperationsTask(makeItem({})).priority).toBeNull();
  });

  it("keeps a valid taskType and returns null otherwise", () => {
    expect(toOperationsTask(makeItem({ TaskType: "Fixtures" })).taskType).toBe("Fixtures");
    expect(toOperationsTask(makeItem({ TaskType: "Not Real" })).taskType).toBeNull();
  });

  it("keeps a valid location and returns null otherwise", () => {
    expect(toOperationsTask(makeItem({ Location: "Repair" })).location).toBe("Repair");
    expect(toOperationsTask(makeItem({ Location: "Nowhere" })).location).toBeNull();
  });
});

describe("toOperationsTask — Assigned is single-person", () => {
  it("maps a single-person Assigned object to Person, not an array", () => {
    const t = toOperationsTask(
      makeItem({ Assigned: { LookupId: 22, LookupValue: "Ray White", Email: "ray@e.com" } }),
    );
    expect(t.assigned).toEqual({ displayName: "Ray White", email: "ray@e.com", lookupId: 22 });
  });

  it("is null when Assigned is missing", () => {
    expect(toOperationsTask(makeItem({})).assigned).toBeNull();
  });

  it("still maps Watchers as a multi-person array", () => {
    const t = toOperationsTask(
      makeItem({
        Watchers: [
          { LookupId: 1, LookupValue: "A" },
          { LookupId: 2, LookupValue: "B" },
        ],
      }),
    );
    expect(t.watchers).toHaveLength(2);
  });
});

describe("toOperationsTask — Project Ref / Altronic Equipment single lookups", () => {
  it("prefers the resolved ProjectRef object over the bare LookupId when both are present", () => {
    const t = toOperationsTask(
      makeItem({
        ProjectRefLookupId: 3,
        ProjectRef: { LookupId: 3, LookupValue: "0002-PVA Conformal Coating Machine" },
      }),
    );
    expect(t.parentProject).toEqual({ lookupId: 3, title: "0002-PVA Conformal Coating Machine" });
  });

  it("falls back to the bare LookupId with an empty title when ProjectRef isn't expanded", () => {
    const t = toOperationsTask(makeItem({ ProjectRefLookupId: 3 }));
    expect(t.parentProject).toEqual({ lookupId: 3, title: "" });
  });

  it("is null when there's no project reference at all", () => {
    expect(toOperationsTask(makeItem({})).parentProject).toBeNull();
  });

  it("maps Altronic Equipment the same way", () => {
    const t = toOperationsTask(
      makeItem({
        AltronicEquipmentLookupId: 1,
        AltronicEquipment: { LookupId: 1, LookupValue: "TM1" },
      }),
    );
    expect(t.equipment).toEqual({ lookupId: 1, title: "TM1" });
  });

  it("is null when there's no equipment reference", () => {
    expect(toOperationsTask(makeItem({})).equipment).toBeNull();
  });
});

describe("toOperationsTask — comments and attachments", () => {
  it("parses comments from the Communication field (same format as Task)", () => {
    const t = toOperationsTask(
      makeItem({ Communication: "07/18/2024 7:28:33 PM|||S|||s@e.com|||<p>x</p>" }),
    );
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].authorName).toBe("S");
  });

  it("maps hasAttachments to true/false", () => {
    expect(toOperationsTask(makeItem({ Attachments: true })).hasAttachments).toBe(true);
    expect(toOperationsTask(makeItem({})).hasAttachments).toBe(false);
  });
});

describe("toOperationsTask — dates and audit fields", () => {
  it("parses createdAt/modifiedAt from item-level fields", () => {
    const t = toOperationsTask(makeItem({}));
    expect(t.createdAt.toISOString()).toBe("2025-07-02T18:46:32.000Z");
    expect(t.modifiedAt.toISOString()).toBe("2026-04-28T13:48:27.000Z");
  });

  it("parses DueDate, returning null when missing/unparseable", () => {
    expect(
      toOperationsTask(makeItem({ DueDate: "2026-08-15T00:00:00Z" })).dueDate?.toISOString(),
    ).toContain("2026-08-15");
    expect(toOperationsTask(makeItem({})).dueDate).toBeNull();
    expect(toOperationsTask(makeItem({ DueDate: "not-a-date" })).dueDate).toBeNull();
  });

  it("maps createdBy.user to author", () => {
    const t = toOperationsTask(
      makeItem({}, { createdBy: { user: { displayName: "David Bulkley", email: "david@e.com" } } }),
    );
    expect(t.author).toEqual({ displayName: "David Bulkley", email: "david@e.com" });
  });
});
