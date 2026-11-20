import type { PanelTask } from "@/types/task";
import type { CapacityWorkItem } from "./capacity";
import { isPanelTaskDone } from "./panelTaskStatus";

// =============================================================================
// Panels' adapter onto the shared capacity engine (lib/capacity.ts,
// BusinessIT#42). Everything about HOW capacity is worked out lives there;
// this file only says what a Panel task means to it. Engineering or Operations
// tasks would get an adapter like this one, beside their own mappers.
// =============================================================================

/** A Panel task as a capacity work item. */
export function panelTaskWorkItem(task: PanelTask): CapacityWorkItem {
  return {
    id: `panelTask:${task.id}`,
    title: task.title,
    href: `/panels/task/${task.id}`,
    assignees: task.assigned,
    startDate: task.startDate,
    dueDate: task.dueDate,
    estimatedHours: task.estimatedHours,
    // Completed and Canceled; on-hold work still takes capacity.
    done: isPanelTaskDone(task.status),
    context: task.projectRef?.title || undefined,
    statusLabel: task.status,
  };
}

/** The Panel task id behind a work item from `panelTaskWorkItem`, or null. */
export function panelTaskIdOf(item: CapacityWorkItem): number | null {
  const m = /^panelTask:(\d+)$/.exec(item.id);
  return m ? Number(m[1]) : null;
}
