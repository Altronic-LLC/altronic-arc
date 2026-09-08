import { describe, it, expect } from "vitest";
import { planTaskStatusDrop } from "./KanbanView";
import { MOCK_TASKS } from "@/data/mockData";

// The drop DECISION, tested directly — same reasoning as
// MaintenanceBoardView's planStatusDrop tests: dnd-kit's pointer sensor
// needs a layout engine jsdom hasn't got, so a synthetic drag proves
// nothing; the rule lives in the pure function so it's testable without one.
//
// A parent task with any open (non-Complete) child can't be dropped into
// the Complete column — added 2026-09-04 alongside DetailView's "Mark
// Complete" gate (see canCompleteTask in taskGraph.ts and
// DetailView.childGate.test.tsx). MOCK_TASKS' raw parentTask pointers are
// used directly here (id 47 → children 48 In Progress, 44 Complete), the
// same fixtures DetailView.childGate.test.tsx relies on — but
// planTaskStatusDrop reads `task.childTasks`, which is only populated by
// attachTaskRelationships() during a real list load, not on the raw
// MOCK_TASKS array. So this file builds its own tiny fixtures with
// childTasks set directly, the way taskGraph.test.ts's makeTask() does,
// rather than depending on that derived field being present on the shared
// mock array.

const OPEN_CHILD_PARENT = MOCK_TASKS.find((t) => t.id === 47)!;
const parentWithOpenChild = {
  ...OPEN_CHILD_PARENT,
  childTasks: [
    { id: 48, numberedTitle: "T48", status: "In Progress" as const },
    { id: 44, numberedTitle: "T44", status: "Complete" as const },
  ],
};

const DONE_PARENT = MOCK_TASKS.find((t) => t.id === 102)!;
const parentWithAllChildrenDone = {
  ...DONE_PARENT,
  childTasks: [{ id: 110, numberedTitle: "T110", status: "Complete" as const }],
};

const CHILDLESS = MOCK_TASKS.find((t) => t.childTasks.length === 0 && t.status !== "Complete")!;

describe("planTaskStatusDrop", () => {
  it("moves a card dropped on a column to that status", () => {
    expect(planTaskStatusDrop({ activeId: CHILDLESS.id, overId: "On Hold", tasks: MOCK_TASKS })).toEqual({
      taskId: CHILDLESS.id,
      target: "On Hold",
    });
  });

  it("does nothing for a drop outside any column", () => {
    expect(planTaskStatusDrop({ activeId: CHILDLESS.id, overId: null, tasks: MOCK_TASKS })).toBeNull();
  });

  it("does nothing when the card lands back in its own column", () => {
    expect(
      planTaskStatusDrop({ activeId: CHILDLESS.id, overId: CHILDLESS.status, tasks: MOCK_TASKS }),
    ).toBeNull();
  });

  it("does nothing for a card that has since gone", () => {
    expect(planTaskStatusDrop({ activeId: 999999, overId: "On Hold", tasks: MOCK_TASKS })).toBeNull();
  });

  it("allows a drop into Complete for a task with no children", () => {
    expect(
      planTaskStatusDrop({ activeId: CHILDLESS.id, overId: "Complete", tasks: MOCK_TASKS }),
    ).toEqual({ taskId: CHILDLESS.id, target: "Complete" });
  });

  it("refuses a drop into Complete for a parent with an open child, naming it", () => {
    const tasks = [...MOCK_TASKS.filter((t) => t.id !== 47), parentWithOpenChild];
    const result = planTaskStatusDrop({ activeId: 47, overId: "Complete", tasks });
    expect(result).toEqual({
      refusal: "1 child task is still open — finish it first.",
    });
  });

  it("allows a drop into Complete once every child is already Complete", () => {
    const tasks = [...MOCK_TASKS.filter((t) => t.id !== 102), parentWithAllChildrenDone];
    expect(planTaskStatusDrop({ activeId: 102, overId: "Complete", tasks })).toEqual({
      taskId: 102,
      target: "Complete",
    });
  });

  it("does not refuse a drop into a non-Complete column even with open children", () => {
    const tasks = [...MOCK_TASKS.filter((t) => t.id !== 47), parentWithOpenChild];
    expect(planTaskStatusDrop({ activeId: 47, overId: "On Hold", tasks })).toEqual({
      taskId: 47,
      target: "On Hold",
    });
  });
});
