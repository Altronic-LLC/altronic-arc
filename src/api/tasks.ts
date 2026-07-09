import { graphFetch, graphFetchAll } from "./graph";
import { SP_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";
import type {
  CommentAttachment,
  GraphListItem,
  Person,
  ProjectReference,
  Status,
  Task,
  TaskEirReference,
} from "@/types/task";
import { toTask } from "@/lib/taskMapper";
import { appendComment, parseCommunication, replaceComment } from "@/lib/communicationParser";
import { attachProjectTitles, attachTaskRelationships } from "@/lib/taskGraph";
import { multiPersonField } from "@/lib/graphFields";
import { MOCK_PROJECTS, MOCK_TASKS } from "@/data/mockData";

// =============================================================================
// Tasks API
//
// In mock mode, these functions operate on an in-memory copy of MOCK_TASKS.
// In real mode, they hit Microsoft Graph.
//
// The mock implementation simulates a small delay so loading states and
// optimistic updates can be verified visually during development.
// =============================================================================

// SharePoint internal column names we actually consume in taskMapper.ts.
// Passed to `$expand=fields($select=…)` so the list endpoint only returns
// these fields instead of all 200+ columns on the Project Task List. Cuts
// payload size dramatically and speeds up initial load. Keep this list in
// sync with `taskMapper.toTask()` — any new field the mapper reads has to
// be added here too, otherwise it'll come back undefined in real mode.
const TASK_FIELD_SELECT = [
  "Title",
  "NumberedTitle",
  "Description",
  "Status",
  "Priority",
  "Category",
  "Labels",
  "DueDate",
  "AuthorLookupId",
  "EditorLookupId",
  "Parent_x0020_Project_x0020_ReferLookupId",
  "ProjectReference",
  "ParentTaskLookupId",
  "Assigned",
  "Watchers",
  "SoftwareRevision",
  "Attachments",
  "Communication",
].join(",");

// In demo mode we keep the task list in memory but also persist to
// localStorage so changes survive page refresh. Each tab reads from
// localStorage on load and writes after each mutation; data lives under
// the key "aets:mock-store-v1" with a small schema-version embedded so
// we can change the type shape later without crashing.
const MOCK_STORAGE_KEY = "aets:mock-store-v1";
const MOCK_PROJECTS_KEY = "aets:mock-projects-v1";

function loadMockStoreFromStorage(): Task[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Task[];
    // Re-hydrate Date fields (JSON.parse leaves them as strings).
    return parsed.map((t) => ({
      ...t,
      // Backwards compat: localStorage from before the `author` field was
      // added won't have it. Default to null so the type stays satisfied
      // and the UI shows "Unknown" for those grandfathered tasks.
      author: t.author ?? null,
      // Backwards compat: localStorage from before the EIR-promotion feature
      // won't carry this field.
      eirReference: t.eirReference ?? null,
      createdAt: new Date(t.createdAt),
      modifiedAt: new Date(t.modifiedAt),
      dueDate: t.dueDate ? new Date(t.dueDate) : null,
      comments: t.comments.map((c) => ({
        ...c,
        timestamp: new Date(c.timestamp),
        attachments: c.attachments ?? [],
      })),
    }));
  } catch {
    return null;
  }
}

function saveMockStoreToStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockStore));
  } catch {
    // Storage quota exceeded, private mode, etc. Silent — demo still
    // works in-memory, just doesn't persist this session.
  }
}

function loadMockProjectsFromStorage(): ProjectReference[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_PROJECTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProjectReference[];
  } catch {
    return null;
  }
}

function saveMockProjectsToStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOCK_PROJECTS_KEY, JSON.stringify(mockProjectStore));
  } catch {
    // ignored
  }
}

let mockStore: Task[] = (() => {
  const fromStorage = loadMockStoreFromStorage();
  if (fromStorage) return fromStorage;
  return MOCK_TASKS.map((t) => ({
    ...t,
    comments: t.comments.map((c) => ({ ...c, attachments: c.attachments ?? [] })),
    childTasks: [],
  }));
})();

let mockProjectStore: ProjectReference[] =
  loadMockProjectsFromStorage() ?? [...MOCK_PROJECTS];

/** Demo-mode-only: clear local data and reset to the bundled seed. */
export function resetMockStore(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MOCK_STORAGE_KEY);
    window.localStorage.removeItem(MOCK_PROJECTS_KEY);
  } catch {
    // ignored
  }
  mockStore = MOCK_TASKS.map((t) => ({
    ...t,
    comments: t.comments.map((c) => ({ ...c, attachments: c.attachments ?? [] })),
    childTasks: [],
  }));
  mockProjectStore = [...MOCK_PROJECTS];
}

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/**
 * List all tasks. Walks @odata.nextLink in real mode to ensure complete
 * results — the SharePoint list has hundreds of items. After loading,
 * resolves parent/child task relationships and project lookup titles.
 */
export async function listTasks(): Promise<Task[]> {
  if (USE_MOCK) {
    // Deep enough copy that mutations from attachTaskRelationships don't
    // leak back into mockStore (which is meant to be the canonical source).
    const copy = mockStore.map((t) => ({
      ...t,
      parentTask: t.parentTask ? { ...t.parentTask } : null,
      childTasks: [],
    }));
    attachTaskRelationships(copy);
    attachProjectTitles(copy, mockProjectStore);
    return delay(copy);
  }

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items?$expand=fields($select=${TASK_FIELD_SELECT})&$top=200`;
  // Kick the items + projects requests off in parallel — they're
  // independent until we merge titles in below. Saves one round-trip
  // worth of latency on the initial load.
  const [items, projects] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listProjects(),
  ]);
  const tasks = items.map(toTask);
  attachTaskRelationships(tasks);
  // Resolve project titles. Tolerates missing VITE_SP_PROJECTS_LIST_ID
  // (listProjects returns []) by leaving titles empty.
  attachProjectTitles(tasks, projects);
  return tasks;
}

/** Fetch a single task by its list-item ID. */
/**
 * Fetch the raw SharePoint `fields` bag for a single task item, with no
 * `$select` filter so every column on the list is in the response. Used
 * by feature UIs (e.g. the PCB checklist) that need columns the typed
 * mapper doesn't surface.
 */
export async function getTaskRawFields(id: number): Promise<Record<string, unknown>> {
  if (USE_MOCK) {
    const t = mockStore.find((x) => x.id === id);
    return (t?.rawFields ?? {}) as Record<string, unknown>;
  }
  if (!SP_LIST_ID) return {};
  const item = await graphFetch<GraphListItem>(
    `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${id}?$expand=fields`,
  );
  return (item.fields ?? {}) as Record<string, unknown>;
}

export async function getTask(id: number): Promise<Task | null> {
  // We always fetch via listTasks to ensure parent/child links are populated;
  // the cost is small in mock mode and a single Graph call won't return the
  // child list anyway. For real-mode performance optimisation later, fetch
  // the one item by ID for editable fields and merge with the cached list
  // for derived ones.
  const all = await listTasks();
  return all.find((t) => t.id === id) ?? null;
}

/**
 * Update arbitrary fields on a task. Pass only the fields you want to change.
 * Returns the updated task.
 *
 * Uses Graph's PATCH on `/items/{id}/fields` which accepts SharePoint
 * internal column names directly (e.g. { Status: "In Progress" }).
 */
export async function updateTaskFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<Task> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Task ${id} not found`);

    const next = { ...mockStore[idx] };
    if ("Status" in fields) next.status = fields.Status as Status;
    if ("Title" in fields) next.title = fields.Title as string;
    if ("Description" in fields) next.description = fields.Description as string;
    if ("Priority" in fields) next.priority = fields.Priority as Task["priority"];
    if ("Category" in fields) next.category = fields.Category as Task["category"];
    if ("Labels" in fields) next.labels = (fields.Labels as Task["labels"]) ?? [];
    if ("DueDate" in fields) {
      const v = fields.DueDate;
      next.dueDate = v ? new Date(v as string) : null;
    }
    // Person fields — write paths use the *LookupId* shape under the hood;
    // for mock mode we accept either Person[] (semantic) or the lookup-id
    // form, prefer Person[].
    if ("Assigned" in fields && Array.isArray(fields.Assigned)) {
      next.assigned = fields.Assigned as Person[];
    }
    if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
      next.watchers = fields.Watchers as Person[];
    }
    if ("SoftwareRevision" in fields) {
      next.softwareRevision = (fields.SoftwareRevision as string) ?? "";
    }
    if ("EIRReference" in fields) {
      const v = fields.EIRReference as { Url?: string; Description?: string } | null;
      next.eirReference = v
        ? { url: v.Url ?? "", label: v.Description ?? v.Url ?? "" }
        : null;
    }
    if ("ParentTaskLookupId" in fields) {
      const v = fields.ParentTaskLookupId;
      if (!v) {
        next.parentTask = null;
      } else {
        const parent = mockStore.find((t) => t.id === Number(v));
        next.parentTask = parent
          ? { id: parent.id, numberedTitle: parent.numberedTitle, status: parent.status }
          : null;
      }
    }
    if ("Parent_x0020_Project_x0020_ReferLookupId" in fields) {
      const v = fields.Parent_x0020_Project_x0020_ReferLookupId;
      if (!v) {
        next.parentProject = null;
      } else {
        const proj = mockProjectStore.find((p) => p.lookupId === Number(v));
        next.parentProject = proj ?? { lookupId: Number(v), title: "" };
      }
    }
    if ("ProjectReference" in fields && Array.isArray(fields.ProjectReference)) {
      const ids = fields.ProjectReference as number[];
      next.relatedProjects = ids
        .map((lid) => mockProjectStore.find((p) => p.lookupId === lid))
        .filter((p): p is ProjectReference => !!p);
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${id}/fields`;
  await graphFetch(path, { method: "PATCH", body: JSON.stringify(fields) });

  // Re-fetch the canonical state.
  const reloaded = await getTask(id);
  if (!reloaded) throw new Error(`Task ${id} disappeared after update`);
  return reloaded;
}

/** Convenience: just change the status. Used by Kanban drag-and-drop. */
export async function setTaskStatus(id: number, status: Status): Promise<Task> {
  return updateTaskFields(id, { Status: status });
}

/** Change the parent task (or clear it with `null`). */
export async function setParentTask(id: number, parentId: number | null): Promise<Task> {
  return updateTaskFields(id, { ParentTaskLookupId: parentId });
}

/** Change the parent project (or clear with `null`). */
export async function setParentProject(id: number, projectLookupId: number | null): Promise<Task> {
  return updateTaskFields(id, { Parent_x0020_Project_x0020_ReferLookupId: projectLookupId });
}

/** Replace the related-projects list with the given lookup IDs. */
export async function setRelatedProjects(id: number, lookupIds: number[]): Promise<Task> {
  return updateTaskFields(id, { ProjectReference: lookupIds });
}

/** Replace the Assigned people list. */
export async function setAssigned(id: number, people: Person[]): Promise<Task> {
  if (USE_MOCK) {
    return updateTaskFields(id, { Assigned: people });
  }
  // Multi-person writes go through the shared helper so the @odata.type
  // annotation is never forgotten (see src/lib/graphFields.ts for the
  // history of why this matters). The helper always emits the annotated
  // shape; passing only-unresolved people would silently clear the field,
  // so we guard that case here.
  const resolved = people.filter((p) => !!p.lookupId);
  if (people.length > 0 && resolved.length === 0) {
    throw new Error(
      "Cannot update Assigned: none of the selected people had a resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updateTaskFields(id, multiPersonField("Assigned", people));
}

/** Replace the Watchers list. */
export async function setWatchers(id: number, people: Person[]): Promise<Task> {
  if (USE_MOCK) {
    return updateTaskFields(id, { Watchers: people });
  }
  const resolved = people.filter((p) => !!p.lookupId);
  if (people.length > 0 && resolved.length === 0) {
    throw new Error(
      "Cannot update Watchers: none of the watchers had a resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updateTaskFields(id, multiPersonField("Watchers", people));
}

/** Add the given person to the watchers list (if not already there). */
export async function watchTask(id: number, person: Person): Promise<Task> {
  if (!USE_MOCK && !person.lookupId) {
    // SharePoint person fields require a numeric lookupId. If we don't have
    // one for the current user, the write would silently drop them from the
    // list. Fail loud instead so the UI can surface the problem.
    throw new Error(
      "Cannot add to watchers: your SharePoint user lookupId hasn't been resolved yet. " +
        "Please wait a moment and try again, or refresh the page.",
    );
  }
  const task = await getTask(id);
  if (!task) throw new Error(`Task ${id} not found`);
  const alreadyWatching = task.watchers.some(
    (w) => w.email === person.email || (w.lookupId && w.lookupId === person.lookupId),
  );
  if (alreadyWatching) return task;
  return setWatchers(id, [...task.watchers, person]);
}

/** Remove the given person from the watchers list. */
export async function unwatchTask(id: number, person: Person): Promise<Task> {
  const task = await getTask(id);
  if (!task) throw new Error(`Task ${id} not found`);
  const next = task.watchers.filter(
    (w) => !(w.email === person.email || (w.lookupId && w.lookupId === person.lookupId)),
  );
  if (next.length === task.watchers.length) return task; // wasn't watching
  return setWatchers(id, next);
}

/**
 * Append a comment to a task's Communication field. Optimistic UI should
 * insert the comment locally before this resolves.
 *
 * Attachments: in mock mode, attachments are kept on the in-memory comment
 * record (URL.createObjectURL blob URLs). In real mode the attachments are
 * NOT yet uploaded — this is the stub described in backlog item 2. When
 * upload-to-SharePoint is wired up, do it here before the PATCH and put
 * the resulting URLs into the body HTML or a separate attachments list.
 */
export async function addComment(
  id: number,
  comment: {
    authorName: string;
    authorEmail: string;
    bodyHtml: string;
    attachments?: CommentAttachment[];
  },
): Promise<Task> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Task ${id} not found`);
    const next = { ...mockStore[idx] };
    next.comments = [
      {
        timestamp: new Date(),
        authorName: comment.authorName,
        authorEmail: comment.authorEmail,
        bodyHtml: comment.bodyHtml,
        attachments: comment.attachments ?? [],
      },
      ...next.comments,
    ];
    if (comment.attachments && comment.attachments.length > 0) {
      next.hasAttachments = true;
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  // Real Graph: append to the Communication string field.
  // TODO (backlog: attachments storage rules): upload attachments to a
  // SharePoint document library first, then embed their URLs in bodyHtml
  // before writing. Today, attachments on real mode are dropped on the
  // floor; the body text still appends correctly.
  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${id}?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, {
    authorName: comment.authorName,
    authorEmail: comment.authorEmail,
    bodyHtml: comment.bodyHtml,
  });
  return updateTaskFields(id, { Communication: newRaw });
}

/**
 * Edit the body of an existing comment on a task. Matched by the original
 * timestamp + author email — those are kept unchanged so the audit trail
 * (who said it and when) stays intact; only the bodyHtml changes.
 *
 * Authorisation: the caller is expected to check that the current user is
 * the comment's author before invoking this. The API layer doesn't enforce
 * it; it's a UI affordance, mirroring how SharePoint itself secures the
 * Communication field as a whole (anyone with list-write access can edit
 * any record). Locking down by author would mean splitting comments into
 * their own list with per-item permissions — a bigger lift, not done here.
 */
export async function editComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<Task> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Task ${id} not found`);
    const next = { ...mockStore[idx] };
    const targetEmail = target.authorEmail.toLowerCase();
    next.comments = next.comments.map((c) =>
      c.timestamp.getTime() === target.timestamp.getTime() &&
      c.authorEmail.toLowerCase() === targetEmail
        ? { ...c, bodyHtml: newBodyHtml }
        : c,
    );
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${id}?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  return updateTaskFields(id, { Communication: newRaw });
}

/**
 * Create a new task. Title is required; everything else is optional.
 *
 * All accepted fields are written in a single POST. Person and lookup
 * fields are sent in their SharePoint write shapes (LookupId / multi-LookupId).
 */
export async function createTask(input: {
  title: string;
  /**
   * Optional pre-computed NumberedTitle (e.g. "T12-0017-EMI sweep"). When
   * the caller has the task list to count from (the form does, via
   * useTasks), it can pass this and we'll write it directly. Per the
   * project-task-numbering memory, NumberedTitle is NOT a SharePoint
   * calculated column — the app is responsible for filling it in.
   */
  numberedTitle?: string;
  description?: string;
  status?: Status;
  priority?: string | null;
  category?: string | null;
  dueDate?: Date | null;
  labels?: string[];
  parentProjectLookupId?: number | null;
  assigned?: Person[];
  watchers?: Person[];
  softwareRevision?: string;
  /**
   * Source-EIR link for the `EIRReference` Hyperlink column, set when this
   * task is being promoted from an EIR. Written as `{ Url, Description }`.
   */
  eirReference?: TaskEirReference | null;
  /**
   * Pre-serialised `Communication` value (raw pipe-delimited records) to
   * seed the new task's comment thread — used by the EIR→Task promotion to
   * carry the EIR's discussion across. See `buildPromotedCommunication`.
   */
  communication?: string;
}): Promise<Task> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((t) => t.id)) + 1;
    const now = new Date();
    const parentProject = input.parentProjectLookupId
      ? mockProjectStore.find((p) => p.lookupId === input.parentProjectLookupId) ?? null
      : null;
    const task: Task = {
      id: nextId,
      numberedTitle:
        input.numberedTitle ??
        `T${nextId}-${parentProject?.title.slice(0, 4) ?? "0000"}-${input.title}`,
      title: input.title,
      description: input.description ?? "",
      status: input.status ?? "BACKLOG",
      priority: (input.priority as Task["priority"]) ?? null,
      category: (input.category as Task["category"]) ?? null,
      labels: (input.labels as Task["labels"]) ?? [],
      dueDate: input.dueDate ?? null,
      createdAt: now,
      modifiedAt: now,
      authorLookupId: 0,
      author: null,
      editorLookupId: 0,
      parentProject,
      relatedProjects: [],
      parentTask: null,
      childTasks: [],
      assigned: input.assigned ?? [],
      watchers: input.watchers ?? [],
      softwareRevision: input.softwareRevision ?? "",
      eirReference: input.eirReference ?? null,
      comments: input.communication ? parseCommunication(input.communication) : [],
      hasAttachments: false,
    };
    mockStore = [task, ...mockStore];
    saveMockStoreToStorage();
    return delay(task);
  }

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items`;
  // On create, only send fields the user actually filled in. SharePoint
  // rejects null/empty values on POST (especially for lookup columns) — it
  // wants the field omitted instead. The TaskFormModal hands us null/[] for
  // unspecified choices so the equivalent guards live here.
  const fields: Record<string, unknown> = { Title: input.title };
  // NumberedTitle is a writable text column (the v0.6.4 attempt 400'd, but
  // that turned out to be the AssignedLookupId shape — the schema dump in
  // v0.6.10 confirmed NumberedTitle is readonly=False, type=text). The
  // form computes it as T{n}-{projectRef}-{title} where n is the count
  // of existing tasks under the parent project + 1.
  if (input.numberedTitle) fields.NumberedTitle = input.numberedTitle;
  if (input.description) fields.Description = input.description;
  if (input.status) fields.Status = input.status;
  if (input.priority) fields.Priority = input.priority;
  if (input.category) fields.Category = input.category;
  if (input.labels && input.labels.length > 0) fields.Labels = input.labels;
  if (input.dueDate) fields.DueDate = input.dueDate.toISOString();
  if (input.parentProjectLookupId) {
    fields.Parent_x0020_Project_x0020_ReferLookupId = input.parentProjectLookupId;
  }
  if (input.softwareRevision) {
    fields.SoftwareRevision = input.softwareRevision;
  }
  // Person fields: only include real lookup IDs. The current user's
  // lookupId is resolved async — if it isn't ready yet (lookupId === 0)
  // we just skip the field rather than failing the entire create. The
  // user can re-assign afterward once their identity is known.
  if (input.assigned?.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Assigned", input.assigned));
  }
  if (input.watchers?.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", input.watchers));
  }
  // EIRReference is a Hyperlink column — Graph wants the nested
  // { Url, Description } shape (Description = the link text). Skipped
  // entirely when not promoting, so ordinary tasks leave the column empty.
  if (input.eirReference && (input.eirReference.url || input.eirReference.label)) {
    fields.EIRReference = {
      Url: input.eirReference.url,
      Description: input.eirReference.label,
    };
  }
  // Seed the comment thread in the same POST when carrying an EIR's
  // discussion across (already a serialised Communication string).
  if (input.communication) fields.Communication = input.communication;

  const created = await graphFetch<GraphListItem>(path, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return toTask(created);
}

/** Delete a task. */
export async function deleteTask(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((t) => t.id !== id);
    saveMockStoreToStorage();
    await delay(null);
    return;
  }

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${id}`;
  await graphFetch(path, { method: "DELETE" });
}

// =============================================================================
// Project (lookup directory)
// =============================================================================

/**
 * Fetch all projects from the Project Overview list. Used both for resolving
 * lookup IDs on tasks and for the admin page's project listing.
 */
export async function listProjects(): Promise<ProjectReference[]> {
  if (USE_MOCK) {
    const sorted = [...mockProjectStore].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
    return delay(sorted);
  }

  const projectsListId = import.meta.env.VITE_SP_PROJECTS_LIST_ID;
  if (!projectsListId) {
    console.warn(
      "VITE_SP_PROJECTS_LIST_ID is not set — parent project names cannot be resolved.",
    );
    return [];
  }

  // Projects list — we only need the Title for resolving lookup labels.
  const path = `/sites/${SP_SITE_ID}/lists/${projectsListId}/items?$expand=fields($select=Title)&$top=200`;
  const items = await graphFetchAll<GraphListItem>(path);
  const projects = items.map((item) => ({
    lookupId: parseInt(item.id, 10),
    title: (item.fields.Title as string) ?? `(project #${item.id})`,
  }));
  // Sort by title using natural (numeric-aware) ordering so projects appear
  // in 0000, 0001, ... order in every dropdown. This is the source of truth
  // for the FilterBar and TaskFormModal pickers.
  projects.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return projects;
}

/**
 * Create a new project entry. Used by the admin page.
 *
 * In real mode this writes to the Project Overview list, which is governed
 * by its own SharePoint permissions. App-side admin gating (who sees the
 * admin page) is a UI affordance — the underlying write is still subject
 * to SharePoint permissions on the projects list.
 */
export async function createProject(input: { title: string }): Promise<ProjectReference> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockProjectStore.map((p) => p.lookupId)) + 1;
    const project: ProjectReference = { lookupId: nextId, title: input.title };
    mockProjectStore = [...mockProjectStore, project];
    saveMockProjectsToStorage();
    return delay(project);
  }

  const projectsListId = import.meta.env.VITE_SP_PROJECTS_LIST_ID;
  if (!projectsListId) {
    throw new Error("VITE_SP_PROJECTS_LIST_ID is not set — cannot create projects in real mode.");
  }

  const path = `/sites/${SP_SITE_ID}/lists/${projectsListId}/items`;
  const created = await graphFetch<GraphListItem>(path, {
    method: "POST",
    body: JSON.stringify({ fields: { Title: input.title } }),
  });
  return {
    lookupId: parseInt(created.id, 10),
    title: (created.fields.Title as string) ?? input.title,
  };
}

/**
 * Rename an existing project. The project number and name both live in the
 * Title (e.g. "0017-AMP-5000 Refresh"), so this one write covers both. Used
 * by the Engineering Project Log admin page.
 */
export async function updateProject(
  lookupId: number,
  title: string,
): Promise<ProjectReference> {
  if (USE_MOCK) {
    const idx = mockProjectStore.findIndex((p) => p.lookupId === lookupId);
    if (idx < 0) throw new Error(`Project ${lookupId} not found`);
    mockProjectStore = [
      ...mockProjectStore.slice(0, idx),
      { ...mockProjectStore[idx], title },
      ...mockProjectStore.slice(idx + 1),
    ];
    saveMockProjectsToStorage();
    return delay({ lookupId, title });
  }

  const projectsListId = import.meta.env.VITE_SP_PROJECTS_LIST_ID;
  if (!projectsListId) {
    throw new Error("VITE_SP_PROJECTS_LIST_ID is not set — cannot update projects in real mode.");
  }
  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${projectsListId}/items/${lookupId}/fields`,
    { method: "PATCH", body: JSON.stringify({ Title: title }) },
  );
  return { lookupId, title };
}
