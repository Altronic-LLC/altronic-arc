import { describe, it, expect } from "vitest";
import type { ProjectReference, Task } from "@/types/task";
import { computeNumberedTitle } from "./taskNumbering";

const PROJECT: ProjectReference = { lookupId: 17, title: "0017-AMP-5000 Refresh" };
const OTHER: ProjectReference = { lookupId: 3, title: "0003-Task List" };

function task(over: Partial<Task>): Task {
  return {
    id: 1,
    numberedTitle: "T1-0000-x",
    title: "x",
    description: "",
    status: "BACKLOG",
    priority: null,
    category: null,
    labels: [],
    dueDate: null,
    createdAt: new Date(),
    modifiedAt: new Date(),
    authorLookupId: 0,
    author: null,
    editorLookupId: 0,
    parentProject: null,
    relatedProjects: [],
    parentTask: null,
    childTasks: [],
    assigned: [],
    watchers: [],
    softwareRevision: "",
    eirReference: null,
    comments: [],
    hasAttachments: false,
    ...over,
  };
}

describe("computeNumberedTitle", () => {
  it("counts existing tasks in the same project + 1, prefixing the 4-char code", () => {
    const tasks = [
      task({ id: 1, parentProject: PROJECT }),
      task({ id: 2, parentProject: PROJECT }),
      task({ id: 3, parentProject: OTHER }),
    ];
    expect(computeNumberedTitle("New coil", PROJECT, tasks)).toBe("T3-0017-New coil");
  });

  it("starts at T1 for the first task in a project", () => {
    expect(computeNumberedTitle("First", PROJECT, [])).toBe("T1-0017-First");
  });

  it("falls back to the 0000 prefix and counts unparented tasks when no project", () => {
    const tasks = [task({ id: 1, parentProject: null }), task({ id: 2, parentProject: PROJECT })];
    expect(computeNumberedTitle("Loose", null, tasks)).toBe("T2-0000-Loose");
  });
});
