import type {
  GraphListItem,
  OperationsPriority,
  OperationsStatus,
  OperationsTask,
  OperationsTaskType,
  OperationsLocation,
  Person,
} from "@/types/task";
import {
  OPERATIONS_LOCATIONS,
  OPERATIONS_PRIORITIES,
  OPERATIONS_STATUSES,
  OPERATIONS_TASK_TYPES,
} from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseLookupSingle, parsePersonField, parseSinglePersonField } from "./taskMapper";

/**
 * Map a raw Graph list item from the Operations Task List to an
 * OperationsTask. Mirrors `toTask()` in taskMapper.ts — same idea, different
 * SharePoint list (different site, different internal column names, and a
 * few field-shape differences: Assigned is single-person, and Project
 * Ref / Altronic Equipment are single lookups with no parent/child task
 * hierarchy at all).
 *
 * `parentProject`/`equipment` titles may come back empty if Graph didn't
 * expand the lookup's resolved value on this call — callers should resolve
 * them afterward the same way `attachProjectTitles` does for tasks (see
 * `listOperationsTasks()` in api/operationsTasks.ts).
 */
export function toOperationsTask(item: GraphListItem): OperationsTask {
  const f = item.fields;

  return {
    id: parseInt(item.id, 10),
    taskNumber: (f.TaskNumber as string) ?? "",
    title: (f.Title as string) ?? "(untitled)",
    description: (f.TaskDescription as string) ?? "",
    status: clampRequired<OperationsStatus>(f.Status as string, OPERATIONS_STATUSES, "Backlog"),
    priority: clampOptional<OperationsPriority>(f.PriorityRequest as string, OPERATIONS_PRIORITIES),
    taskType: clampOptional<OperationsTaskType>(f.TaskType as string, OPERATIONS_TASK_TYPES),
    location: clampOptional<OperationsLocation>(f.Location as string, OPERATIONS_LOCATIONS),
    dueDate: parseDate(f.DueDate as string),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
    authorLookupId: toInt(f.AuthorLookupId, 0),
    author: parseCreatedByUser(item.createdBy),
    editor: parseCreatedByUser(item.lastModifiedBy),
    editorLookupId: toInt(f.EditorLookupId, 0),
    assigned: parseSinglePersonField(f.Assigned),
    watchers: parsePersonField(f.Watchers),
    parentProject:
      parseLookupSingle(f.ProjectRef) ??
      (f.ProjectRefLookupId ? { lookupId: toInt(f.ProjectRefLookupId, 0), title: "" } : null),
    equipment:
      parseLookupSingle(f.AltronicEquipment) ??
      (f.AltronicEquipmentLookupId
        ? { lookupId: toInt(f.AltronicEquipmentLookupId, 0), title: "" }
        : null),
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
    rawFields: f as Record<string, unknown>,
  };
}

function clampRequired<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

function clampOptional<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T | null {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return null;
}

function parseCreatedByUser(
  createdBy: { user?: { displayName?: string; email?: string } } | undefined,
): Person | null {
  const user = createdBy?.user;
  if (!user || !user.displayName) return null;
  return { displayName: user.displayName, email: user.email };
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toInt(raw: unknown, fallback: number): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}
