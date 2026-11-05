import { describe, expect, it } from "vitest";
import { PANEL_TASK_STATUS_GROUP, PANEL_TASK_STATUSES } from "@/types/task";
import {
  isPanelTaskDone,
  isPanelTaskOpen,
  normalisePanelTaskStatus,
  panelTaskGroupLabel,
  panelTaskStatusesIn,
  panelTaskStatusGroup,
} from "./panelTaskStatus";

describe("panel task statuses", () => {
  it("are the Panel Workflow's eleven, each in a group", () => {
    expect(PANEL_TASK_STATUSES).toHaveLength(11);
    for (const s of PANEL_TASK_STATUSES) expect(PANEL_TASK_STATUS_GROUP[s]).toBeDefined();
    expect(panelTaskStatusesIn("Active")).toEqual([
      "New",
      "Pending Scheduling",
      "Ready",
      "In Progress",
      "Revision Needed",
      "Awaiting Pre-Req",
      "Possible Support",
    ]);
    expect(panelTaskStatusesIn("Deferred")).toEqual(["On Hold - Approval", "On Hold - Internal"]);
  });

  it("counts only Completed and Canceled as done", () => {
    expect(PANEL_TASK_STATUSES.filter(isPanelTaskDone)).toEqual(["Completed", "Canceled"]);
    expect(isPanelTaskOpen("On Hold - Internal")).toBe(true);
    expect(panelTaskStatusGroup("Awaiting Pre-Req")).toBe("Active");
    expect(panelTaskGroupLabel("Deferred")).toBe("On Hold");
  });

  it("reads the old four statuses as their Panel Workflow match, and anything unknown as New", () => {
    expect(normalisePanelTaskStatus("Pending")).toBe("New");
    expect(normalisePanelTaskStatus("In Process")).toBe("In Progress");
    expect(normalisePanelTaskStatus("On Hold")).toBe("On Hold - Internal");
    expect(normalisePanelTaskStatus("Complete")).toBe("Completed");
    expect(normalisePanelTaskStatus("Cancelled")).toBe("Canceled");
    expect(normalisePanelTaskStatus("Ready")).toBe("Ready");
    expect(normalisePanelTaskStatus("Something else")).toBe("New");
    expect(normalisePanelTaskStatus(undefined)).toBe("New");
  });
});
