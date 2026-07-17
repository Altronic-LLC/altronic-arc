import type {
  GraphListItem,
  PanelProject,
  PanelTask,
  PanelTaskStatus,
  PanelTaskType,
  Person,
} from "@/types/task";
import { PANEL_TASK_STATUSES, PANEL_TASK_TYPES } from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseLookupSingle, parsePersonField, parseSinglePersonField } from "./taskMapper";

// =============================================================================
// Panel Task mapper — Graph list item → PanelTask. Mirrors panelOrderMapper:
// same panel site, same cross-site Graph limitation (single-value person +
// single lookup come back as bare LookupIds), resolved after the fact via
// attachPanelTaskReferences against the Panel Project Reference list + the
// panel site's user directory.
// =============================================================================

export function toPanelTask(item: GraphListItem): PanelTask {
  const f = item.fields;

  return {
    id: parseInt(item.id, 10),
    title: (f.Title as string) ?? "(untitled)",
    status: clampStatus(f.Status as string),
    taskType: clampType(f.TaskType as string),
    projectRef:
      parseLookupSingle(f.ProjectReference) ??
      (f.ProjectReferenceLookupId
        ? { lookupId: toInt(f.ProjectReferenceLookupId, 0), title: "" }
        : null),
    assigned:
      parseSinglePersonField(f.Assigned) ??
      (f.AssignedLookupId ? { lookupId: toInt(f.AssignedLookupId, 0), displayName: "" } : null),
    description: (f.Description as string) ?? "",
    watchers: parsePersonField(f.Watchers),
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
    author: parseIdentity(item.createdBy),
    editor: parseIdentity(item.lastModifiedBy),
    rawFields: f as Record<string, unknown>,
  };
}

/**
 * Resolve project titles + assignee names against the Panel Project
 * Reference list and the panel site's user directory (the "join after the
 * fact" pattern). Mutates in place and returns the same array.
 */
export function attachPanelTaskReferences(
  tasks: PanelTask[],
  projects: PanelProject[],
  usersById: Map<number, Person>,
): PanelTask[] {
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  for (const task of tasks) {
    if (task.projectRef && !task.projectRef.title) {
      const resolved = projectsById.get(task.projectRef.lookupId);
      if (resolved) task.projectRef = { ...task.projectRef, title: resolved.title };
    }
    if (task.assigned && !task.assigned.displayName && task.assigned.lookupId) {
      const resolved = usersById.get(task.assigned.lookupId);
      if (resolved) task.assigned = resolved;
    }
  }
  return tasks;
}

function clampStatus(raw: string | undefined): PanelTaskStatus {
  if (raw && (PANEL_TASK_STATUSES as readonly string[]).includes(raw)) {
    return raw as PanelTaskStatus;
  }
  return "Pending";
}

function clampType(raw: string | undefined): PanelTaskType | null {
  if (raw && (PANEL_TASK_TYPES as readonly string[]).includes(raw)) {
    return raw as PanelTaskType;
  }
  return null;
}

function parseIdentity(
  identity: { user?: { displayName?: string; email?: string } } | undefined,
): Person | null {
  const user = identity?.user;
  if (!user || !user.displayName) return null;
  return { displayName: user.displayName, email: user.email };
}

function toInt(raw: unknown, fallback: number): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}
