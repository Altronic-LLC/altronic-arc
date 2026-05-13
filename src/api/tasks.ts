import { graphFetch, graphFetchAll } from "./graph";
import { SP_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";
import type { GraphListItem, ProjectReference, Status, Task } from "@/types/task";
import { toTask } from "@/lib/taskMapper";
import { appendComment } from "@/lib/communicationParser";
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

let mockStore: Task[] = MOCK_TASKS.map((t) => ({ ...t, comments: [...t.comments] }));

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/**
 * List all tasks. Walks @odata.nextLink in real mode to ensure complete results
 * — the SharePoint list has hundreds of items.
 */
export async function listTasks(): Promise<Task[]> {
  if (USE_MOCK) return delay([...mockStore]);

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items?$expand=fields&$top=200`;
  const items = await graphFetchAll<GraphListItem>(path);
  return items.map(toTask);
}

/** Fetch a single task by its list-item ID. */
export async function getTask(id: number): Promise<Task | null> {
  if (USE_MOCK) {
    const t = mockStore.find((x) => x.id === id);
    return delay(t ? { ...t } : null);
  }

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${id}?$expand=fields`;
  const item = await graphFetch<GraphListItem>(path);
  return toTask(item);
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
    if ("Communication" in fields) {
      // No-op for the parsed comments; the comment-add helper does that work.
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(next);
  }

  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${id}/fields`;
  await graphFetch(path, { method: "PATCH", body: JSON.stringify(fields) });

  // Re-fetch so we get the canonical server state (including new modified time).
  const reloaded = await getTask(id);
  if (!reloaded) throw new Error(`Task ${id} disappeared after update`);
  return reloaded;
}

/** Convenience: just change the status. Used by Kanban drag-and-drop. */
export async function setTaskStatus(id: number, status: Status): Promise<Task> {
  return updateTaskFields(id, { Status: status });
}

/**
 * Append a comment to a task's Communication field. Optimistic UI should
 * insert the comment locally before this resolves.
 */
export async function addComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<Task> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Task ${id} not found`);
    const next = { ...mockStore[idx] };
    next.comments = [
      { timestamp: new Date(), ...comment },
      ...next.comments,
    ];
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(next);
  }

  // Need the existing Communication value so we can append rather than overwrite.
  const path = `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${id}?$expand=fields&$select=id&$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, comment);
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
// Project (parent-lookup) resolution
// =============================================================================

/**
 * Fetch all parent-project entries so we can resolve lookup IDs to display
 * names. In mock mode, returns the canned set. In real mode, requires
 * VITE_SP_PROJECTS_LIST_ID to be set; otherwise returns an empty list and
 * project names fall back to "(project #ID)" in the UI.
 */
export async function listProjects(): Promise<ProjectReference[]> {
  if (USE_MOCK) return delay([...MOCK_PROJECTS]);

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
