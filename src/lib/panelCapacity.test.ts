import { describe, expect, it } from "vitest";
import type { PanelTask } from "@/types/task";
import { panelTaskIdOf, panelTaskWorkItem } from "./panelCapacity";

const day = (k: string) => new Date(`${k}T12:00:00Z`);

const TASK: PanelTask = {
  id: 7,
  title: "Draw enclosure",
  status: "In Progress",
  taskType: "Drawings",
  workType: null,
  priority: null,
  projectRef: { lookupId: 3, title: "PRD-1234-ABC12-V1-001" },
  orderRef: null,
  assigned: [{ displayName: "Ana", email: "ana@example.com", lookupId: 1 }],
  description: "",
  startDate: day("2026-11-02"),
  dueDate: day("2026-11-06"),
  estimatedHours: 16,
  watchers: [],
  comments: [],
  hasAttachments: false,
  createdAt: day("2026-10-01"),
  modifiedAt: day("2026-10-01"),
  author: null,
};

describe("panelTaskWorkItem", () => {
  it("turns a Panel task into a capacity work item", () => {
    expect(panelTaskWorkItem(TASK)).toEqual({
      id: "panelTask:7",
      title: "Draw enclosure",
      href: "/panels/task/7",
      assignees: TASK.assigned,
      startDate: TASK.startDate,
      dueDate: TASK.dueDate,
      estimatedHours: 16,
      done: false,
      context: "PRD-1234-ABC12-V1-001",
      statusLabel: "In Progress",
    });
  });

  it("counts Completed and Canceled as done — on-hold work still takes capacity", () => {
    expect(panelTaskWorkItem({ ...TASK, status: "Completed" }).done).toBe(true);
    expect(panelTaskWorkItem({ ...TASK, status: "Canceled" }).done).toBe(true);
    expect(panelTaskWorkItem({ ...TASK, status: "On Hold - Approval" }).done).toBe(false);
    expect(panelTaskWorkItem({ ...TASK, status: "Awaiting Pre-Req" }).done).toBe(false);
  });
});

describe("panelTaskIdOf", () => {
  it("reads the Panel task id back off a work item, and nothing else", () => {
    expect(panelTaskIdOf(panelTaskWorkItem(TASK))).toBe(7);
    expect(panelTaskIdOf({ ...panelTaskWorkItem(TASK), id: "task:7" })).toBeNull();
  });
});
