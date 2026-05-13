import type {
  Category,
  GraphListItem,
  Label,
  Person,
  Priority,
  Status,
  Task,
} from "@/types/task";
import { CATEGORIES, LABELS, PRIORITIES, STATUSES } from "@/types/task";
import { parseCommunication } from "./communicationParser";

/**
 * Map a raw Graph list item to a Task. This is the boundary between the
 * SharePoint shape (string-heavy, lossy types, internal column names) and
 * the typed domain model the rest of the app uses.
 *
 * Field names here match the SharePoint internal `name` (e.g. `DueDate`,
 * `Parent_x0020_Project_x0020_ReferLookupId`). If a list column is renamed in
 * SharePoint, only this function needs to change.
 */
export function toTask(item: GraphListItem): Task {
  const f = item.fields;

  return {
    id: parseInt(item.id, 10),
    numberedTitle: (f.NumberedTitle as string) ?? (f.Title as string) ?? "(untitled)",
    title: (f.Title as string) ?? "(untitled)",
    description: (f.Description as string) ?? "",
    status: clampRequired<Status>(f.Status as string, STATUSES, "BACKLOG"),
    priority: clampOptional<Priority>(f.Priority as string, PRIORITIES),
    category: clampOptional<Category>(f.Category as string, CATEGORIES),
    labels: parseLabels(f.Labels as string),
    dueDate: parseDate(f.DueDate as string),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
    authorLookupId: toInt(f.AuthorLookupId, 0),
    editorLookupId: toInt(f.EditorLookupId, 0),
    parentProject: f.Parent_x0020_Project_x0020_ReferLookupId
      ? { lookupId: toInt(f.Parent_x0020_Project_x0020_ReferLookupId, 0), title: "" }
      : null,
    assigned: parsePersonField(f.Assigned),
    watchers: parsePersonField(f.Watchers),
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
  };
}

/** Return a value from `allowed` if `raw` matches, otherwise `fallback`. */
function clampRequired<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

/** Return a value from `allowed` if `raw` matches, otherwise null. */
function clampOptional<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T | null {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return null;
}

function parseLabels(raw: string | undefined): Label[] {
  if (!raw) return [];
  // SharePoint multi-choice values come back as ";#"-separated strings.
  // But sometimes they come as plain strings (single-choice degenerate case).
  const parts = raw
    .split(/[;#,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.filter((p): p is Label => (LABELS as readonly string[]).includes(p));
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

/**
 * Person-or-group field handling. Graph returns these in a few different
 * shapes depending on whether the field is single- or multi-person:
 *
 *   Single:   { LookupId: 46, LookupValue: "Sarah Shaffer", Email: "..." }
 *   Multi:    [ { LookupId: 46, ... }, { LookupId: 87, ... } ]
 *   Empty:    undefined | null | "" | []
 *
 * We normalise to Person[] in all cases.
 */
function parsePersonField(raw: unknown): Person[] {
  if (!raw) return [];

  const items = Array.isArray(raw) ? raw : [raw];
  const people: Person[] = [];

  for (const entry of items) {
    if (typeof entry !== "object" || entry === null) continue;
    const obj = entry as Record<string, unknown>;

    const displayName =
      (obj.LookupValue as string) ?? (obj.displayName as string) ?? (obj.title as string);
    if (!displayName) continue;

    people.push({
      displayName,
      email: (obj.Email as string) ?? (obj.email as string),
      lookupId: toInt(obj.LookupId ?? obj.lookupId, 0),
    });
  }

  return people;
}
