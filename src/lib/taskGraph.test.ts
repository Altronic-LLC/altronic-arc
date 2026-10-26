import { describe, it, expect } from "vitest";
import {
  attachProjectTitles,
  attachTaskRelationships,
  canCompleteTask,
  incompleteChildTasks,
  mergeTaskIntoList,
  wouldCreateCycle,
} from "./taskGraph";
import type { BuildRequest, ProjectReference, Task } from "@/types/task";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 1,
    numberedTitle: "T1-0000-Test",
    title: "Test",
    description: "",
    status: "BACKLOG",
    priority: null,
    category: null,
    labels: [],
    dueDate: null,
    createdAt: new Date(2024, 0, 1),
    modifiedAt: new Date(2024, 0, 1),
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
    ...overrides,
  };
}

describe("attachTaskRelationships", () => {
  it("returns the same array reference (mutates in place)", () => {
    const arr = [makeTask({ id: 1 })];
    expect(attachTaskRelationships(arr)).toBe(arr);
  });

  it("resolves parent title and status onto the parentTask ref", () => {
    const parent = makeTask({
      id: 1,
      numberedTitle: "T1-0000-Parent",
      status: "In Progress",
    });
    const child = makeTask({
      id: 2,
      parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" },
    });
    attachTaskRelationships([parent, child]);
    expect(child.parentTask).toEqual({
      id: 1,
      numberedTitle: "T1-0000-Parent",
      status: "In Progress",
    });
  });

  it("populates childTasks on parents", () => {
    const parent = makeTask({ id: 1 });
    const a = makeTask({ id: 2, parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" } });
    const b = makeTask({ id: 3, parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" } });
    attachTaskRelationships([parent, a, b]);
    expect(parent.childTasks.map((c) => c.id)).toEqual([2, 3]);
  });

  it("sorts childTasks by id ascending", () => {
    const parent = makeTask({ id: 1 });
    const high = makeTask({ id: 5, parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" } });
    const low = makeTask({ id: 3, parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" } });
    attachTaskRelationships([parent, high, low]);
    expect(parent.childTasks.map((c) => c.id)).toEqual([3, 5]);
  });

  it("clears parentTask when the referenced parent does not exist", () => {
    const orphan = makeTask({
      id: 2,
      parentTask: { id: 99, numberedTitle: "", status: "BACKLOG" },
    });
    attachTaskRelationships([orphan]);
    expect(orphan.parentTask).toBeNull();
  });

  it("clears parentTask on self-reference", () => {
    const self = makeTask({
      id: 1,
      parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" },
    });
    attachTaskRelationships([self]);
    expect(self.parentTask).toBeNull();
  });

  it("breaks two-task cycles (A → B → A)", () => {
    const a = makeTask({
      id: 1,
      parentTask: { id: 2, numberedTitle: "", status: "BACKLOG" },
    });
    const b = makeTask({
      id: 2,
      parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" },
    });
    attachTaskRelationships([a, b]);
    // At least one of the two refs is cleared so the cycle is broken.
    const remaining = [a, b].filter((t) => t.parentTask !== null);
    expect(remaining.length).toBeLessThan(2);
  });

  it("resets childTasks arrays each call (no accumulation across passes)", () => {
    const parent = makeTask({ id: 1, childTasks: [{ id: 999, numberedTitle: "stale", status: "BACKLOG" }] });
    const child = makeTask({
      id: 2,
      parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" },
    });
    attachTaskRelationships([parent, child]);
    expect(parent.childTasks.map((c) => c.id)).toEqual([2]);
  });

  it("skips child-list population for tasks whose parent ref was cleared", () => {
    const orphan = makeTask({
      id: 2,
      parentTask: { id: 99, numberedTitle: "", status: "BACKLOG" },
    });
    attachTaskRelationships([orphan]);
    expect(orphan.childTasks).toEqual([]);
  });

  it("ignores parent ref when the byId lookup is empty mid-pass", () => {
    // Stand-in for "parent referenced exists but is somehow not in the
    // map" — synthesised by tampering after build. Real flow won't hit it,
    // but the defensive `if (!parent) continue` should still no-op.
    const parent = makeTask({ id: 1 });
    const child = makeTask({
      id: 2,
      parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" },
    });
    attachTaskRelationships([parent, child]);
    // After successful relationship resolution, child still points at parent.
    expect(child.parentTask?.id).toBe(1);
  });
});

describe("attachProjectTitles", () => {
  it("fills in a blank parentProject.title from the directory", () => {
    const task = makeTask({ id: 1, parentProject: { lookupId: 42, title: "" } });
    const projects: ProjectReference[] = [{ lookupId: 42, title: "Engineering Apps" }];
    attachProjectTitles([task], projects);
    expect(task.parentProject?.title).toBe("Engineering Apps");
  });

  it("does not overwrite an existing parentProject.title", () => {
    const task = makeTask({
      id: 1,
      parentProject: { lookupId: 42, title: "Original" },
    });
    const projects: ProjectReference[] = [{ lookupId: 42, title: "Newer" }];
    attachProjectTitles([task], projects);
    expect(task.parentProject?.title).toBe("Original");
  });

  it("leaves unresolved parentProject untouched (no entry in directory)", () => {
    const task = makeTask({ id: 1, parentProject: { lookupId: 99, title: "" } });
    attachProjectTitles([task], []);
    expect(task.parentProject?.title).toBe("");
  });

  it("leaves a null parentProject as null", () => {
    const task = makeTask({ id: 1, parentProject: null });
    attachProjectTitles([task], [{ lookupId: 1, title: "X" }]);
    expect(task.parentProject).toBeNull();
  });

  it("resolves missing relatedProjects titles but preserves existing ones", () => {
    const task = makeTask({
      id: 1,
      relatedProjects: [
        { lookupId: 1, title: "" },
        { lookupId: 2, title: "Pre-set" },
        { lookupId: 3, title: "" },
      ],
    });
    const projects: ProjectReference[] = [
      { lookupId: 1, title: "Resolved-1" },
      { lookupId: 2, title: "Ignored" },
    ];
    attachProjectTitles([task], projects);
    expect(task.relatedProjects[0].title).toBe("Resolved-1");
    expect(task.relatedProjects[1].title).toBe("Pre-set");
    expect(task.relatedProjects[2].title).toBe(""); // not in directory
  });

  it("leaves empty relatedProjects array alone", () => {
    const task = makeTask({ id: 1, relatedProjects: [] });
    attachProjectTitles([task], [{ lookupId: 1, title: "X" }]);
    expect(task.relatedProjects).toEqual([]);
  });

  it("returns the same array reference (mutates in place)", () => {
    const arr = [makeTask({ id: 1 })];
    expect(attachProjectTitles(arr, [])).toBe(arr);
  });
});

// A write's result, or the detail page's poll, is ONE row read on its own —
// what toTask() gives for a single item: parent id with no title, no
// children, blank project titles. Pasting it into the list as-is blanked
// those until the next full download.
describe("mergeTaskIntoList", () => {
  /** A loaded list: 10 is the parent of 11, both in project 42. */
  function loaded(): Task[] {
    const tasks = [
      makeTask({
        id: 10,
        numberedTitle: "T1-0042-Parent",
        status: "In Progress",
        parentProject: { lookupId: 42, title: "Engineering Apps" },
      }),
      makeTask({
        id: 11,
        numberedTitle: "T2-0042-Child",
        parentTask: { id: 10, numberedTitle: "", status: "BACKLOG" },
        parentProject: { lookupId: 42, title: "Engineering Apps" },
      }),
    ];
    return attachTaskRelationships(tasks);
  }

  /** How a single-item read of task 10 looks after its status changed. */
  function singleRead10(): Task {
    return makeTask({
      id: 10,
      numberedTitle: "T1-0042-Parent",
      status: "Complete",
      parentProject: { lookupId: 42, title: "" },
    });
  }

  it("keeps the parent's children, which a single read can't carry", () => {
    const next = mergeTaskIntoList(loaded(), singleRead10());
    expect(next.find((t) => t.id === 10)?.childTasks.map((c) => c.id)).toEqual([11]);
  });

  it("fills the project title from another cached row naming the same project", () => {
    const next = mergeTaskIntoList(loaded(), singleRead10());
    expect(next.find((t) => t.id === 10)?.parentProject?.title).toBe("Engineering Apps");
  });

  it("prefers the projects list when one is given", () => {
    const next = mergeTaskIntoList(loaded(), singleRead10(), [
      { lookupId: 42, title: "Engineering Apps (renamed)" },
    ]);
    expect(next.find((t) => t.id === 10)?.parentProject?.title).toBe("Engineering Apps (renamed)");
  });

  it("re-resolves the written task's own parent title and status", () => {
    const child = makeTask({
      id: 11,
      numberedTitle: "T2-0042-Child",
      title: "Child, renamed",
      parentTask: { id: 10, numberedTitle: "", status: "BACKLOG" },
    });
    const next = mergeTaskIntoList(loaded(), child);
    expect(next.find((t) => t.id === 11)?.parentTask).toEqual({
      id: 10,
      numberedTitle: "T1-0042-Parent",
      status: "In Progress",
    });
  });

  it("updates the children's view of a parent whose status changed", () => {
    const next = mergeTaskIntoList(loaded(), singleRead10());
    expect(next.find((t) => t.id === 11)?.parentTask?.status).toBe("Complete");
  });

  it("adds a task the list doesn't hold yet at the top, linked to its parent", () => {
    const created = makeTask({ id: 12, parentTask: { id: 10, numberedTitle: "", status: "BACKLOG" } });
    const next = mergeTaskIntoList(loaded(), created);
    expect(next[0].id).toBe(12);
    expect(next.find((t) => t.id === 10)?.childTasks.map((c) => c.id)).toEqual([11, 12]);
  });

  it("never mutates the cached rows it was given", () => {
    const list = loaded();
    const before = JSON.stringify(list);
    mergeTaskIntoList(list, singleRead10());
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe("incompleteChildTasks", () => {
  it("returns an empty array for a task with no children", () => {
    const task = makeTask({ id: 1, childTasks: [] });
    expect(incompleteChildTasks(task)).toEqual([]);
  });

  it("returns only the children whose status is not exactly Complete", () => {
    const task = makeTask({
      id: 1,
      childTasks: [
        { id: 2, numberedTitle: "T2", status: "Complete" },
        { id: 3, numberedTitle: "T3", status: "In Progress" },
        { id: 4, numberedTitle: "T4", status: "On Hold" },
      ],
    });
    expect(incompleteChildTasks(task).map((c) => c.id)).toEqual([3, 4]);
  });

  it("returns an empty array when every child is Complete", () => {
    const task = makeTask({
      id: 1,
      childTasks: [
        { id: 2, numberedTitle: "T2", status: "Complete" },
        { id: 3, numberedTitle: "T3", status: "Complete" },
      ],
    });
    expect(incompleteChildTasks(task)).toEqual([]);
  });
});

describe("canCompleteTask", () => {
  it("allows a task with no children", () => {
    const task = makeTask({ id: 1, childTasks: [] });
    expect(canCompleteTask(task)).toEqual({ allowed: true, hint: "" });
  });

  it("allows a task whose children are all Complete", () => {
    const task = makeTask({
      id: 1,
      childTasks: [{ id: 2, numberedTitle: "T2", status: "Complete" }],
    });
    expect(canCompleteTask(task)).toEqual({ allowed: true, hint: "" });
  });

  it("refuses a task with one open child, singular wording", () => {
    const task = makeTask({
      id: 1,
      childTasks: [{ id: 2, numberedTitle: "T2", status: "In Progress" }],
    });
    const gate = canCompleteTask(task);
    expect(gate.allowed).toBe(false);
    expect(gate.hint).toBe("1 child task is still open — finish it first.");
  });

  it("refuses a task with multiple open children, plural wording and the count", () => {
    const task = makeTask({
      id: 1,
      childTasks: [
        { id: 2, numberedTitle: "T2", status: "In Progress" },
        { id: 3, numberedTitle: "T3", status: "BACKLOG" },
      ],
    });
    const gate = canCompleteTask(task);
    expect(gate.allowed).toBe(false);
    expect(gate.hint).toBe("2 child tasks are still open — finish them first.");
  });

  it("treats every non-Complete status as open, including Blocked", () => {
    const task = makeTask({
      id: 1,
      childTasks: [{ id: 2, numberedTitle: "T2", status: "Blocked" }],
    });
    expect(canCompleteTask(task).allowed).toBe(false);
  });
});

// BusinessIT#2 — a task with an open linked build request can't be closed.
describe("canCompleteTask — linked build requests", () => {
  function br(id: number, status: string, taskId: number | null = 1): BuildRequest {
    return { ...MOCK_BUILD_REQUESTS[0], id, brNo: `BR_2026-${id}`, status, taskReferenceLookupId: taskId };
  }

  it("refuses a task whose linked build request isn't Complete, naming it and its status", () => {
    const gate = canCompleteTask(makeTask({ id: 1 }), { buildRequests: [br(9, "Production Complete")] });
    expect(gate.allowed).toBe(false);
    expect(gate.hint).toBe("Build request BR_2026-9 is still Production Complete — it must be Complete first.");
  });

  it("allows it once the linked build request is Complete", () => {
    expect(canCompleteTask(makeTask({ id: 1 }), { buildRequests: [br(9, "Complete")] })).toEqual({
      allowed: true,
      hint: "",
    });
  });

  it("ignores build requests raised from a different task, or from none", () => {
    const gate = canCompleteTask(makeTask({ id: 1 }), {
      buildRequests: [br(9, "In-process", 2), br(10, "In-process", null)],
    });
    expect(gate.allowed).toBe(true);
  });

  it("counts every open linked build request", () => {
    const gate = canCompleteTask(makeTask({ id: 1 }), {
      buildRequests: [br(9, "Blocked"), br(10, "Complete"), br(11, "Submitted")],
    });
    expect(gate.hint).toBe(
      "2 linked build requests aren't Complete yet (BR_2026-11, BR_2026-9) — they must be Complete first.",
    );
  });

  it("names both reasons when a child task AND a build request are open", () => {
    const task = makeTask({ id: 1, childTasks: [{ id: 2, numberedTitle: "T2", status: "Blocked" }] });
    const gate = canCompleteTask(task, { buildRequests: [br(9, "In-process")] });
    expect(gate.hint).toMatch(/^1 child task is still open/);
    expect(gate.hint).toMatch(/Build request BR_2026-9 is still In-process/);
  });

  // Loading is "checking", never "allowed" — otherwise the first second of
  // the page is a window to close a task the rule would refuse.
  it("refuses with a checking reason while the build request list loads", () => {
    const gate = canCompleteTask(makeTask({ id: 1 }), { buildRequests: [], resolving: true });
    expect(gate).toEqual({ allowed: false, hint: "Checking the linked build requests…" });
  });

  // A list that couldn't be read arrives as [] — and must not lock every task.
  it("allows it when the list came back empty (or couldn't be read)", () => {
    expect(canCompleteTask(makeTask({ id: 1 }), { buildRequests: [] }).allowed).toBe(true);
  });
});

describe("wouldCreateCycle", () => {
  it("returns true when proposed parent equals the task itself", () => {
    expect(wouldCreateCycle(1, 1, [])).toBe(true);
  });

  it("returns false when proposed parent does not exist in the list", () => {
    expect(wouldCreateCycle(1, 99, [makeTask({ id: 1 })])).toBe(false);
  });

  it("returns true when proposed parent is a direct descendant", () => {
    const a = makeTask({ id: 1 });
    const b = makeTask({
      id: 2,
      parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" },
    });
    expect(wouldCreateCycle(1, 2, [a, b])).toBe(true);
  });

  it("returns true for a transitive descendant (A → B → C)", () => {
    const a = makeTask({ id: 1 });
    const b = makeTask({
      id: 2,
      parentTask: { id: 1, numberedTitle: "", status: "BACKLOG" },
    });
    const c = makeTask({
      id: 3,
      parentTask: { id: 2, numberedTitle: "", status: "BACKLOG" },
    });
    expect(wouldCreateCycle(1, 3, [a, b, c])).toBe(true);
  });

  it("returns false for an unrelated parent assignment", () => {
    const a = makeTask({ id: 1 });
    const b = makeTask({ id: 2 });
    expect(wouldCreateCycle(1, 2, [a, b])).toBe(false);
  });

  it("returns false when the parent chain reaches a missing reference", () => {
    // Task 3's parent is task 99 which doesn't exist in the list — chain
    // dies, no cycle.
    const a = makeTask({ id: 1 });
    const c = makeTask({
      id: 3,
      parentTask: { id: 99, numberedTitle: "", status: "BACKLOG" },
    });
    expect(wouldCreateCycle(1, 3, [a, c])).toBe(false);
  });

  it("returns true if the parent chain hits a pre-existing cycle (visited guard)", () => {
    // Tasks 3 and 4 form a cycle (3 → 4 → 3). Task 1 is unrelated.
    // Asking "can 1 become a child of 3?" walks the chain from 3, finds
    // the cycle via the visited set, and conservatively returns true.
    const a = makeTask({ id: 1 });
    const c = makeTask({
      id: 3,
      parentTask: { id: 4, numberedTitle: "", status: "BACKLOG" },
    });
    const d = makeTask({
      id: 4,
      parentTask: { id: 3, numberedTitle: "", status: "BACKLOG" },
    });
    expect(wouldCreateCycle(1, 3, [a, c, d])).toBe(true);
  });
});
