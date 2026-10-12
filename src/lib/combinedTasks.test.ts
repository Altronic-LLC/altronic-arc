import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS } from "@/components/FilterBar";
import type { OperationsStatus, OperationsTask, Person, Status, Task } from "@/types/task";
import { sortRows } from "./tableSort";
import {
  applyStageFilter,
  collectCombinedPeople,
  COMBINED_SORT_COLUMNS,
  combinedTaskKey,
  combinedTaskPath,
  combineTasks,
  filterCombinedTasks,
  readTaskScope,
  taskStage,
  type CombinedTask,
} from "./combinedTasks";

const ray: Person = { lookupId: 1, displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const tim: Person = { lookupId: 2, displayName: "Tim Webster", email: "tim.webster@altronic-llc.com" };

function engTask(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    numberedTitle: `T${id}-0001-Eng ${id}`,
    title: `Eng ${id}`,
    description: "",
    status: "BACKLOG",
    priority: null,
    category: null,
    labels: [],
    dueDate: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    modifiedAt: new Date(Date.UTC(2026, 0, 1)),
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

function opsTask(id: number, over: Partial<OperationsTask> = {}): OperationsTask {
  return {
    id,
    taskNumber: `Task 0001-${id}`,
    title: `Ops ${id}`,
    description: "",
    status: "Backlog",
    priority: null,
    taskType: null,
    location: null,
    dueDate: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    modifiedAt: new Date(Date.UTC(2026, 0, 1)),
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

const eng = (status: Status): CombinedTask => ({ department: "Engineering", task: engTask(1, { status }) });
const ops = (status: OperationsStatus): CombinedTask => ({ department: "Operations", task: opsTask(1, { status }) });

describe("readTaskScope", () => {
  it("is Operations-only unless the URL says exactly `all`", () => {
    expect(readTaskScope(null)).toBe("operations");
    expect(readTaskScope("")).toBe("operations");
    expect(readTaskScope("ALL")).toBe("operations");
    expect(readTaskScope("everything")).toBe("operations");
    expect(readTaskScope("all")).toBe("all");
  });
});

describe("taskStage — one status vocabulary across both lists", () => {
  it.each([
    ["BACKLOG", "Not started"],
    ["SELECTED FOR DEVELOPMENT", "Not started"],
    ["In Progress", "In progress"],
    ["On Hold", "On hold"],
    ["Blocked", "On hold"],
    ["Complete", "Complete"],
  ] as const)("Engineering %s → %s", (status, stage) => {
    expect(taskStage(eng(status))).toBe(stage);
  });

  it.each([
    ["Backlog", "Not started"],
    ["WIP", "In progress"],
    ["On Hold", "On hold"],
    ["Complete", "Complete"],
    ["Canceled", "Canceled"],
  ] as const)("Operations %s → %s", (status, stage) => {
    expect(taskStage(ops(status))).toBe(stage);
  });
});

describe("keys and paths", () => {
  it("never collides an Engineering and an Operations task that share an item id", () => {
    const [e, o] = combineTasks([engTask(12)], [opsTask(12)]);
    expect(combinedTaskKey(e)).not.toBe(combinedTaskKey(o));
  });

  it("opens each task on its own department's page", () => {
    const [e, o] = combineTasks([engTask(12)], [opsTask(12)]);
    expect(combinedTaskPath(e)).toBe("/task/12");
    expect(combinedTaskPath(o)).toBe("/operations/task/12");
  });
});

describe("filterCombinedTasks", () => {
  const engineering = [engTask(1, { assigned: [ray] }), engTask(2, { assigned: [tim] })];
  const operations = [opsTask(1, { assigned: ray }), opsTask(2, { assigned: tim })];

  it("runs the shared bar over BOTH lists — Assigned matches either assignee shape", () => {
    const out = filterCombinedTasks(engineering, operations, { ...EMPTY_FILTERS, assignedEmails: [ray.email!] }, null);
    expect(out.map((r) => `${r.department}:${r.task.id}`)).toEqual(["Engineering:1", "Operations:1"]);
  });

  it("IGNORES a project filter — the two lists' project ids mean different projects", () => {
    const withProject = [opsTask(3, { parentProject: { lookupId: 99, title: "Ops project" } })];
    const out = filterCombinedTasks(engineering, withProject, { ...EMPTY_FILTERS, projectIds: [99] }, null);
    // Without the guard, the Engineering half (no project 99) would vanish.
    expect(out).toHaveLength(3);
  });

  it("narrows to one department", () => {
    expect(
      filterCombinedTasks(engineering, operations, EMPTY_FILTERS, "Engineering").every(
        (r) => r.department === "Engineering",
      ),
    ).toBe(true);
    expect(
      filterCombinedTasks(engineering, operations, EMPTY_FILTERS, "Operations").every(
        (r) => r.department === "Operations",
      ),
    ).toBe(true);
  });
});

describe("applyStageFilter", () => {
  const rows = [eng("In Progress"), eng("Complete"), ops("WIP"), ops("Canceled")];

  it("null keeps everything", () => {
    expect(applyStageFilter(rows, null)).toHaveLength(4);
  });

  it("ACTIVE drops Complete AND Canceled", () => {
    expect(applyStageFilter(rows, "ACTIVE").map(taskStage)).toEqual(["In progress", "In progress"]);
  });

  it("a stage matches both departments' statuses for it", () => {
    expect(applyStageFilter(rows, "In progress").map((r) => r.department)).toEqual([
      "Engineering",
      "Operations",
    ]);
  });
});

describe("collectCombinedPeople", () => {
  it("de-duplicates a person who appears on both lists", () => {
    const people = collectCombinedPeople([engTask(1, { assigned: [ray] })], [opsTask(1, { watchers: [ray, tim] })]);
    expect(people.map((p) => p.displayName).sort()).toEqual(["Ray White", "Tim Webster"]);
  });
});

describe("COMBINED_SORT_COLUMNS", () => {
  const rows = combineTasks(
    [
      engTask(1, { title: "b", createdAt: new Date(Date.UTC(2026, 0, 3)), status: "Complete" }),
      engTask(2, { title: "x", createdAt: new Date(Date.UTC(2026, 0, 1)), dueDate: new Date(Date.UTC(2026, 1, 1)) }),
    ],
    [opsTask(1, { title: "a", createdAt: new Date(Date.UTC(2026, 0, 2)), dueDate: new Date(Date.UTC(2026, 0, 15)) })],
  );
  const order = (key: string, dir: "asc" | "desc") =>
    sortRows(rows, COMBINED_SORT_COLUMNS, key, dir, combinedTaskKey).map(
      (r) => `${r.department[0]}${r.task.id}`,
    );

  it("orders by created date across both lists", () => {
    expect(order("created", "desc")).toEqual(["E1", "O1", "E2"]);
  });

  it("puts a task with no due date last, whichever direction", () => {
    expect(order("due", "asc")).toEqual(["O1", "E2", "E1"]);
    expect(order("due", "desc")).toEqual(["E2", "O1", "E1"]);
  });

  it("orders Status by stage, not alphabetically", () => {
    expect(order("status", "asc").at(-1)).toBe("E1"); // Complete after Not started
  });
});
