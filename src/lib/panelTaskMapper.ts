import type {
  GraphListItem,
  PanelProject,
  PanelTask,
  PanelTaskType,
  Person,
} from "@/types/task";
import {
  PANEL_TASK_PRIORITIES,
  PANEL_TASK_TYPES,
  PANEL_TASK_WORK_TYPES,
  type PanelTaskPriority,
  type PanelTaskWorkType,
} from "@/types/task";
import { normalisePanelTaskStatus } from "./panelTaskStatus";
import { parseCommunication } from "./communicationParser";
import { parseLookupSingle, parsePersonField, parseSinglePersonField } from "./taskMapper";
import { parseSpDate } from "./spDates";
import { toNumberOrNull } from "./graphValues";

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
    status: normalisePanelTaskStatus(f.Status as string),
    taskType: clampType(f.TaskType as string),
    workType: clampWorkType(f.WorkType as string),
    priority: clampPriority(f.Priority as string),
    projectRef:
      parseLookupSingle(f.ProjectReference) ??
      (f.ProjectReferenceLookupId
        ? { lookupId: toInt(f.ProjectReferenceLookupId, 0), title: "" }
        : null),
    // A single lookup: Graph routinely hands back the bare id only. The
    // order's title is joined in the view, from the orders list.
    orderRef:
      parseLookupSingle(f.PanelOrderRef) ??
      (f.PanelOrderRefLookupId ? { lookupId: toInt(f.PanelOrderRefLookupId, 0), title: "" } : null),
    assigned: assignedPeople(f.Assigned, f.AssignedLookupId),
    description: (f.Description as string) ?? "",
    startDate: parseSpDate(f.StartDate),
    dueDate: parseSpDate(f.DueDate),
    estimatedHours: toNumberOrNull(f.EstimatedHours),
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
    task.assigned = task.assigned.map((p) =>
      !p.displayName && p.lookupId ? usersById.get(p.lookupId) ?? { ...p, displayName: `User #${p.lookupId}` } : p,
    );
  }
  return tasks;
}

/**
 * Assigned in either shape: the expanded people (multi or single), else the
 * bare id(s) Graph hands back for a person column — names joined later.
 */
function assignedPeople(expanded: unknown, lookupIds: unknown): Person[] {
  const people = parsePersonField(expanded);
  if (people.length) return people;
  const single = parseSinglePersonField(expanded);
  if (single) return [single];
  const ids = Array.isArray(lookupIds) ? lookupIds : lookupIds ? [lookupIds] : [];
  return ids.map((id) => toInt(id, 0)).filter((id) => id > 0).map((lookupId) => ({ lookupId, displayName: "" }));
}

function clampWorkType(raw: string | undefined): PanelTaskWorkType | null {
  return raw && (PANEL_TASK_WORK_TYPES as readonly string[]).includes(raw)
    ? (raw as PanelTaskWorkType)
    : null;
}

function clampPriority(raw: string | undefined): PanelTaskPriority | null {
  return raw && (PANEL_TASK_PRIORITIES as readonly string[]).includes(raw)
    ? (raw as PanelTaskPriority)
    : null;
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
