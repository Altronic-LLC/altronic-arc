import { describe, it, expect } from "vitest";
import type { OperationsTask, ProjectReference } from "@/types/task";
import {
  computeOperationsTaskNumber,
  highestOperationsTaskNumber,
  operationsProjectCode,
} from "./operationsTaskNumbering";

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
  it("is one past the highest number already used under the project code", () => {
    const tasks = [
      task({ id: 1, taskNumber: "Task 0002-4", parentProject: PROJECT }),
      task({ id: 2, taskNumber: "Task 0002-88", parentProject: PROJECT }),
      task({ id: 3, taskNumber: "Task 0000-51", parentProject: OTHER }),
    ];
    expect(computeOperationsTaskNumber(PROJECT, tasks)).toBe("Task 0002-89");
  });

  it("does not count tasks — a delete or a legacy ID-based number must never make it repeat", () => {
    // Two tasks in the project, but the highest number is 88 (legacy n = item
    // ID). count+1 would hand out "Task 0002-3"; 0002-8 and 0002-88 are taken.
    const tasks = [
      task({ id: 8, taskNumber: "Task 0002-8", parentProject: PROJECT }),
      task({ id: 220, taskNumber: "Task 0002-88", parentProject: PROJECT }),
    ];
    expect(computeOperationsTaskNumber(PROJECT, tasks)).toBe("Task 0002-89");
  });

  it("starts at 1 for a project with no numbered task yet", () => {
    expect(computeOperationsTaskNumber(PROJECT, [])).toBe("Task 0002-1");
    expect(
      computeOperationsTaskNumber(PROJECT, [task({ id: 9, taskNumber: "Task 0000-9" })]),
    ).toBe("Task 0002-1");
  });

  it("uses the 0000 code and the highest 0000 number when there is no project", () => {
    const tasks = [
      task({ id: 51, taskNumber: "Task 0000-51", parentProject: null }),
      task({ id: 231, taskNumber: "Task 0000-212", parentProject: null }),
      task({ id: 2, taskNumber: "Task 0002-4", parentProject: PROJECT }),
    ];
    expect(computeOperationsTaskNumber(null, tasks)).toBe("Task 0000-213");
  });

  it("goes by the number's own code, not the task's current project", () => {
    // Moved from the 0000 bucket into PROJECT but kept its number.
    const tasks = [task({ id: 30, taskNumber: "Task 0000-30", parentProject: PROJECT })];
    expect(computeOperationsTaskNumber(PROJECT, tasks)).toBe("Task 0002-1");
    expect(computeOperationsTaskNumber(null, tasks)).toBe("Task 0000-31");
  });

  it("ignores blank and malformed numbers", () => {
    const tasks = [
      task({ id: 1, taskNumber: "", parentProject: PROJECT }),
      task({ id: 2, taskNumber: "Task ", parentProject: PROJECT }),
      task({ id: 3, taskNumber: "Task 0002-", parentProject: PROJECT }),
      task({ id: 4, taskNumber: "0002-7", parentProject: PROJECT }),
    ];
    expect(computeOperationsTaskNumber(PROJECT, tasks)).toBe("Task 0002-1");
  });

  it("tolerates case and surrounding whitespace in stored numbers", () => {
    const tasks = [task({ id: 1, taskNumber: "  task 0002-7 ", parentProject: PROJECT })];
    expect(computeOperationsTaskNumber(PROJECT, tasks)).toBe("Task 0002-8");
  });
});

describe("helpers", () => {
  it("operationsProjectCode takes the first four characters, 0000 with no project", () => {
    expect(operationsProjectCode(PROJECT)).toBe("0002");
    expect(operationsProjectCode(null)).toBe("0000");
  });

  it("highestOperationsTaskNumber is 0 when nothing matches the code", () => {
    expect(highestOperationsTaskNumber("0035", [task({ taskNumber: "Task 0002-4" })])).toBe(0);
    expect(highestOperationsTaskNumber("0002", [task({ taskNumber: "Task 0002-4" })])).toBe(4);
  });
});
