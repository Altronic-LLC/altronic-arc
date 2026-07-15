import { describe, it, expect } from "vitest";
import type { OperationsTask, ProjectReference } from "@/types/task";
import { computeOperationsTaskNumber } from "./operationsTaskNumbering";

const PROJECT: ProjectReference = { lookupId: 3, title: "0002-PVA Conformal Coating Machine" };
const OTHER: ProjectReference = { lookupId: 1, title: "0000-Operations Task List" };

function task(over: Partial<OperationsTask>): OperationsTask {
  return {
    id: 1,
    taskNumber: "",
    title: "x",
    description: "",
    status: "Backlog",
    priority: null,
    taskType: null,
    location: null,
    dueDate: null,
    createdAt: new Date(),
    modifiedAt: new Date(),
    authorLookupId: 0,
    author: null,
    editorLookupId: 0,
    assigned: null,
    watchers: [],
    parentProject: null,
    equipment: null,
    comments: [],
    hasAttachments: false,
    ...over,
  };
}

describe("computeOperationsTaskNumber", () => {
  it("counts existing tasks in the same project + 1, prefixing the 4-char code", () => {
    const tasks = [
      task({ id: 1, parentProject: PROJECT }),
      task({ id: 2, parentProject: PROJECT }),
      task({ id: 3, parentProject: OTHER }),
    ];
    expect(computeOperationsTaskNumber(PROJECT, tasks)).toBe("Task 0002-3");
  });

  it("starts at 1 for the first task in a project", () => {
    expect(computeOperationsTaskNumber(PROJECT, [])).toBe("Task 0002-1");
  });

  it("falls back to the 0000 prefix and counts unparented tasks when no project", () => {
    const tasks = [task({ id: 1, parentProject: null }), task({ id: 2, parentProject: PROJECT })];
    expect(computeOperationsTaskNumber(null, tasks)).toBe("Task 0000-2");
  });
});
