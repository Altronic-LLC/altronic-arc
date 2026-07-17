import { describe, it, expect } from "vitest";
import { attachPanelTaskReferences, toPanelTask } from "./panelTaskMapper";
import type { GraphListItem, PanelProject, Person } from "@/types/task";

function graphItem(fields: Record<string, unknown>): GraphListItem {
  return {
    id: (fields.id as string) ?? "1",
    createdDateTime: "2026-07-17T18:01:12Z",
    lastModifiedDateTime: "2026-07-17T18:01:12Z",
    createdBy: { user: { displayName: "Ray White", email: "ray.white@altronic-llc.com" } },
    fields: fields as GraphListItem["fields"],
  };
}

describe("toPanelTask", () => {
  it("maps the list shape, falling back to bare LookupIds for single lookup + person", () => {
    const task = toPanelTask(
      graphItem({
        id: "5",
        Title: "Draw enclosure layout",
        Status: "In Process",
        TaskType: "Drawings",
        ProjectReferenceLookupId: "3",
        AssignedLookupId: "46",
        Description: "GA drawing",
      }),
    );
    expect(task.id).toBe(5);
    expect(task.title).toBe("Draw enclosure layout");
    expect(task.status).toBe("In Process");
    expect(task.taskType).toBe("Drawings");
    expect(task.projectRef).toEqual({ lookupId: 3, title: "" });
    expect(task.assigned).toEqual({ lookupId: 46, displayName: "" });
    expect(task.description).toBe("GA drawing");
    expect(task.author?.displayName).toBe("Ray White");
  });

  it("clamps unknown status/type to safe defaults", () => {
    expect(toPanelTask(graphItem({ Status: "Bogus" })).status).toBe("Pending");
    expect(toPanelTask(graphItem({ TaskType: "Bogus" })).taskType).toBeNull();
    expect(toPanelTask(graphItem({})).status).toBe("Pending");
  });

  it("parses a resolved single-person Assigned and the comment thread", () => {
    const task = toPanelTask(
      graphItem({
        Assigned: { LookupId: 46, LookupValue: "Sarah Shaffer", Email: "s@x.com" },
        Communication: "7/10/2026 9:00:00 AM|||Ray White|||ray@x.com|||<p>hi</p>",
      }),
    );
    expect(task.assigned).toEqual({ lookupId: 46, displayName: "Sarah Shaffer", email: "s@x.com" });
    expect(task.comments).toHaveLength(1);
  });
});

describe("attachPanelTaskReferences", () => {
  const PROJECTS: PanelProject[] = [
    {
      id: 3,
      title: "P-0003",
      projectType: null,
      description: "",
      dwgNo: "",
      customer: "",
      department: null,
    },
  ];
  const USERS = new Map<number, Person>([
    [46, { displayName: "Sarah Shaffer", email: "s@x.com", lookupId: 46 }],
  ]);

  it("fills empty project titles and assignee names", () => {
    const task = toPanelTask(graphItem({ ProjectReferenceLookupId: "3", AssignedLookupId: "46" }));
    attachPanelTaskReferences([task], PROJECTS, USERS);
    expect(task.projectRef?.title).toBe("P-0003");
    expect(task.assigned?.displayName).toBe("Sarah Shaffer");
  });

  it("leaves unresolvable ids alone", () => {
    const task = toPanelTask(graphItem({ ProjectReferenceLookupId: "99", AssignedLookupId: "77" }));
    attachPanelTaskReferences([task], PROJECTS, USERS);
    expect(task.projectRef).toEqual({ lookupId: 99, title: "" });
    expect(task.assigned).toEqual({ lookupId: 77, displayName: "" });
  });
});
