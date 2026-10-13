import { describe, it, expect } from "vitest";
import type { ProjectReference, Task } from "@/types/task";
import {
  computeNumberedTitle,
  nextTaskSequence,
  numberedTitlePrefix,
  renumberedTitle,
  retitledNumberedTitle,
} from "./taskNumbering";

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

describe("changing a task's project or title (BusinessIT#33)", () => {
  it("numberedTitlePrefix reads T{n}-{code}- off the stored value", () => {
    expect(numberedTitlePrefix(task({ numberedTitle: "T3-0017-EMI sweep", parentProject: PROJECT }))).toBe(
      "T3-0017-",
    );
    // No project: the code is 0000.
    expect(numberedTitlePrefix(task({ numberedTitle: "T12-0000-x", parentProject: null }))).toBe("T12-0000-");
    // A project code that itself contains a dash is matched whole, not cut at it.
    const dashed: ProjectReference = { lookupId: 9, title: "AB-1 Widget" };
    expect(numberedTitlePrefix(task({ numberedTitle: "T2-AB-1-Thing", parentProject: dashed }))).toBe(
      "T2-AB-1-",
    );
    // Stored code disagrees with the project (moved in SharePoint): fall back to 4 chars.
    expect(numberedTitlePrefix(task({ numberedTitle: "T2-0003-Thing", parentProject: PROJECT }))).toBe(
      "T2-0003-",
    );
    // A legacy hand-typed value has no prefix to keep.
    expect(numberedTitlePrefix(task({ numberedTitle: "Old sweep", parentProject: PROJECT }))).toBeNull();
  });

  it("retitledNumberedTitle keeps the number and swaps the text after it", () => {
    const t = task({ numberedTitle: "T3-0017-Old title", parentProject: PROJECT });
    expect(retitledNumberedTitle(t, "New title")).toBe("T3-0017-New title");
    expect(retitledNumberedTitle(task({ numberedTitle: "legacy" }), "New")).toBeNull();
  });

  it("nextTaskSequence uses the HIGHEST number in the project, not the count", () => {
    // Two tasks, but T7 exists: count + 1 = 3 would be a number nobody can
    // tell from a task that used to be there.
    const tasks = [
      task({ id: 1, parentProject: PROJECT, numberedTitle: "T1-0017-a" }),
      task({ id: 2, parentProject: PROJECT, numberedTitle: "T7-0017-b" }),
      task({ id: 3, parentProject: OTHER, numberedTitle: "T40-0003-c" }),
    ];
    expect(nextTaskSequence(PROJECT, tasks)).toBe(8);
    // Legacy rows with no number still count, so it never goes below count + 1.
    const legacy = [task({ id: 1, parentProject: PROJECT, numberedTitle: "" }), task({ id: 2, parentProject: PROJECT, numberedTitle: "" })];
    expect(nextTaskSequence(PROJECT, legacy)).toBe(3);
  });

  it("nextTaskSequence leaves out the task being moved", () => {
    const tasks = [
      task({ id: 1, parentProject: PROJECT, numberedTitle: "T1-0017-a" }),
      task({ id: 2, parentProject: PROJECT, numberedTitle: "T9-0017-moving" }),
    ];
    expect(nextTaskSequence(PROJECT, tasks, 2)).toBe(2);
  });

  it("renumberedTitle builds the next number in the new project with the new code", () => {
    const moving = task({ id: 5, parentProject: PROJECT, numberedTitle: "T3-0017-Sweep" });
    const tasks = [moving, task({ id: 6, parentProject: OTHER, numberedTitle: "T4-0003-x" })];
    expect(renumberedTitle(moving, "Sweep", OTHER, tasks)).toBe("T5-0003-Sweep");
    expect(renumberedTitle(moving, "Sweep", null, tasks)).toBe("T1-0000-Sweep");
  });
});
