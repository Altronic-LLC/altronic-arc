import { graphFetch, graphFetchAll } from "./graph";
import { SP_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";
import type {
  CommentAttachment,
  GraphListItem,
  Person,
  ProjectReference,
  Status,
  Task,
} from "@/types/task";
import { toTask } from "@/lib/taskMapper";
import { appendComment } from "@/lib/communicationParser";
import { attachProjectTitles, attachTaskRelationships } from "@/lib/taskGraph";
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

let mockStore: Task[] = MOCK_TASKS.map((t) => ({
  ...t,
  comments: t.comments.map((c) => ({ ...c, attachments: c.attachments ?? [] })),
  childTasks: [],
}));

let mockProjectStore: ProjectReference[] = [...MOCK_PROJECTS];

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

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items?$expand=fields&$top=200`;
  const items = await graphFetchAll<GraphListItem>(path);
  const tasks = items.map(toTask);
  attachTaskRelationships(tasks);
  // Resolve project titles. Tolerates missing VITE_SP_PROJECTS_LIST_ID
  // (listProjects returns []) by leaving titles empty.
  const projects = await listProjects();
  attachProjectTitles(tasks, projects);
  return tasks;
}

/** Fetch a single task by its list-item ID. */
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
  // Real Graph: person-multi field expects { results: [lookupId, ...] }
  const lookupIds = people.map((p) => p.lookupId).filter((x): x is number => !!x);
  if (people.length > 0 && lookupIds.length === 0) {
    throw new Error(
      "Cannot update Assigned: none of the selected people had a resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updateTaskFields(id, { AssignedLookupId: { results: lookupIds } });
}

/** Replace the Watchers list. */
export async function setWatchers(id: number, people: Person[]): Promise<Task> {
  if (USE_MOCK) {
    return updateTaskFields(id, { Watchers: people });
  }
  const lookupIds = people.map((p) => p.lookupId).filter((x): x is number => !!x);
  if (people.length > 0 && lookupIds.length === 0) {
    throw new Error(
      "Cannot update Watchers: none of the watchers had a resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updateTaskFields(id, { WatchersLookupId: { results: lookupIds } });
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

/** Create a new task. Title is required; everything else is optional. */
export async function createTask(input: {
  title: string;
  description?: string;
  status?: Status;
  priority?: string;
  category?: string;
}): Promise<Task> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((t) => t.id)) + 1;
    const now = new Date();
    const task: Task = {
      id: nextId,
      numberedTitle: `T${nextId}-0000-${input.title}`,
      title: input.title,
      description: input.description ?? "",
      status: input.status ?? "BACKLOG",
      priority: (input.priority as Task["priority"]) ?? null,
      category: (input.category as Task["category"]) ?? null,
      labels: [],
      dueDate: null,
      createdAt: now,
      modifiedAt: now,
      authorLookupId: 0,
      editorLookupId: 0,
      parentProject: null,
      relatedProjects: [],
      parentTask: null,
      childTasks: [],
      assigned: [],
      watchers: [],
      comments: [],
      hasAttachments: false,
    };
    mockStore = [task, ...mockStore];
    return delay(task);
  }

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items`;
  const fields: Record<string, unknown> = { Title: input.title };
  if (input.description) fields.Description = input.description;
  if (input.status) fields.Status = input.status;
  if (input.priority) fields.Priority = input.priority;
  if (input.category) fields.Category = input.category;

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
  if (USE_MOCK) return delay([...mockProjectStore]);

  const projectsListId = import.meta.env.VITE_SP_PROJECTS_LIST_ID;
  if (!projectsListId) {
    console.warn(
      "VITE_SP_PROJECTS_LIST_ID is not set — parent project names cannot be resolved.",
    );
    return [];
  }

  const path = `/sites/${SP_SITE_ID}/lists/${projectsListId}/items?$expand=fields&$top=200`;
  const items = await graphFetchAll<GraphListItem>(path);
  return items.map((item) => ({
    lookupId: parseInt(item.id, 10),
    title: (item.fields.Title as string) ?? `(project #${item.id})`,
  }));
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
