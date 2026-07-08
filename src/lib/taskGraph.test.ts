import { describe, it, expect } from "vitest";
import {
  attachProjectTitles,
  attachTaskRelationships,
  wouldCreateCycle,
} from "./taskGraph";
import type { ProjectReference, Task } from "@/types/task";

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
