import {
  PANEL_TASK_DEFAULT_STATUS,
  PANEL_TASK_STATUS_GROUP,
  PANEL_TASK_STATUSES,
  type PanelTaskStatus,
  type PanelTaskStatusGroup,
} from "@/types/task";

// =============================================================================
// Panel task statuses (BusinessIT#42): the Wrike "Panel Workflow" statuses,
// grouped the way Wrike groups them. Every rule that asks "is this open?" or
// "is this finished?" asks here, so the list, the Dashboard and Capacity
// can't disagree. Pure.
// =============================================================================

/** The four statuses Panel Tasks had before, read as their Panel Workflow match. */
const LEGACY: Record<string, PanelTaskStatus> = {
  Pending: "New",
  "In Process": "In Progress",
  "On Hold": "On Hold - Internal",
  Complete: "Completed",
  // Wrike's Default Workflow spells it with two Ls.
  Cancelled: "Canceled",
};

/** A stored Status read as a Panel Workflow status; anything unknown is New. */
export function normalisePanelTaskStatus(raw: string | null | undefined): PanelTaskStatus {
  if (raw && (PANEL_TASK_STATUSES as readonly string[]).includes(raw)) return raw as PanelTaskStatus;
  if (raw && LEGACY[raw]) return LEGACY[raw];
  return PANEL_TASK_DEFAULT_STATUS;
}

export function panelTaskStatusGroup(status: PanelTaskStatus): PanelTaskStatusGroup {
  return PANEL_TASK_STATUS_GROUP[status] ?? "Active";
}

/** Finished work — Completed or Canceled. Counts nowhere. */
export function isPanelTaskDone(status: PanelTaskStatus): boolean {
  const g = panelTaskStatusGroup(status);
  return g === "Completed" || g === "Canceled";
}

/** Still to do — Active or on hold. */
export function isPanelTaskOpen(status: PanelTaskStatus): boolean {
  return !isPanelTaskDone(status);
}

/** The statuses in a group, in Wrike's order. */
export function panelTaskStatusesIn(group: PanelTaskStatusGroup): PanelTaskStatus[] {
  return PANEL_TASK_STATUSES.filter((s) => PANEL_TASK_STATUS_GROUP[s] === group);
}

/** "On Hold" for Deferred — what the group is called on screen. */
export function panelTaskGroupLabel(group: PanelTaskStatusGroup): string {
  return group === "Deferred" ? "On Hold" : group;
}
