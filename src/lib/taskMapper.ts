import type {
  Category,
  GraphListItem,
  Label,
  Person,
  Priority,
  ProjectReference,
  Status,
  Task,
  TaskEirReference,
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
    author: parseCreatedByUser(item.createdBy),
    editor: parseCreatedByUser(item.lastModifiedBy),
    editorLookupId: toInt(f.EditorLookupId, 0),
    parentProject: f.Parent_x0020_Project_x0020_ReferLookupId
      ? { lookupId: toInt(f.Parent_x0020_Project_x0020_ReferLookupId, 0), title: "" }
      : null,
    relatedProjects: parseProjectLookupMulti(f.ProjectReference),
    parentTask: f.ParentTaskLookupId
      ? {
          id: toInt(f.ParentTaskLookupId, 0),
          numberedTitle: "",
          status: "BACKLOG",
        }
      : null,
    // childTasks is computed after all tasks are loaded — see
    // attachChildTasks() in src/lib/taskGraph.ts. The mapper leaves it empty.
    childTasks: [],
    assigned: parsePersonField(f.Assigned),
    watchers: parsePersonField(f.Watchers),
    softwareRevision: (f.SoftwareRevision as string) ?? "",
    eirReference: parseHyperlinkField(f.EIRReference),
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
    // Keep the raw bag so feature UIs (e.g. the PCB checklist) can read
    // columns that aren't part of the typed Task shape.
    rawFields: f as Record<string, unknown>,
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

/**
 * Map Graph's `createdBy.user` identity to a Person. The identity comes from
 * the listItem envelope (not from `fields`), so it's always returned by
 * default — no `$expand` needed. Some user objects don't include `email`
 * (e.g. external/guest users), in which case we leave it undefined.
 */
function parseCreatedByUser(
  createdBy: { user?: { displayName?: string; email?: string } } | undefined,
): Person | null {
  const user = createdBy?.user;
  if (!user || !user.displayName) return null;
  return {
    displayName: user.displayName,
    email: user.email,
    // No SharePoint lookupId available from this identity. Leaving it
    // undefined is fine — the "Created By" UI only needs the display name.
  };
}

/**
 * Normalise a SharePoint **Hyperlink** column value to `{ url, label }`.
 *
 * Graph returns hyperlink/URL fields as an object `{ Url, Description }`
 * (Description is the display text). Some responses or legacy data hand us
 * a bare string instead — treated as both url and label. Returns null for
 * empty / unrecognised values so `Task.eirReference` stays null when unset.
 */
function parseHyperlinkField(raw: unknown): TaskEirReference | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s ? { url: s, label: s } : null;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const url = ((obj.Url as string) ?? (obj.url as string) ?? "").trim();
    const label =
      ((obj.Description as string) ?? (obj.description as string) ?? "").trim();
    if (!url && !label) return null;
    return { url, label: label || url };
  }
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
export function parsePersonField(raw: unknown): Person[] {
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

/**
 * Single-person field handling — for columns where SharePoint disallows
 * multiple values (e.g. Operations Task List's `Assigned`). Graph returns
 * the exact same shape as one entry of a multi-person field; this just
 * takes the first (and only) one.
 */
export function parseSinglePersonField(raw: unknown): Person | null {
  return parsePersonField(raw)[0] ?? null;
}

/**
 * Single-value lookup field handling — the counterpart to
 * `parseProjectLookupMulti` for a lookup column that only allows one value
 * (e.g. Operations Task List's `ProjectRef` and `AltronicEquipment`).
 * Mirrors the shape/behavior of a single entry from the multi-value case.
 */
export function parseLookupSingle(raw: unknown): ProjectReference | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const lookupId = toInt(obj.LookupId ?? obj.lookupId, 0);
  if (!lookupId) return null;
  return {
    lookupId,
    title: (obj.LookupValue as string) ?? (obj.title as string) ?? "",
  };
}

/**
 * Multi-value lookup field handling. SharePoint returns these as either:
 *
 *   [{ LookupId: 274, LookupValue: "0000-Engineering Apps" }, ...]
 *
 * or, depending on Graph version / field config, as an object with a
 * `results` array. We accept both.
 *
 * The `title` comes from LookupValue when present. If it's missing, the
 * caller (or a separate resolution pass via listProjects()) needs to fill
 * it in by looking up the project list item.
 */
function parseProjectLookupMulti(raw: unknown): ProjectReference[] {
  if (!raw) return [];

  // Some SP responses wrap in { results: [...] }
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { results?: unknown }).results)
    ? (raw as { results: unknown[] }).results
    : [];

  const refs: ProjectReference[] = [];
  for (const entry of items) {
    if (typeof entry !== "object" || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const lookupId = toInt(obj.LookupId ?? obj.lookupId, 0);
    if (!lookupId) continue;
    refs.push({
      lookupId,
      title: (obj.LookupValue as string) ?? (obj.title as string) ?? "",
    });
  }
  return refs;
}
