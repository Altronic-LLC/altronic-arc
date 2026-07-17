import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_TASKS_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, PanelTask, Person } from "@/types/task";
import { attachPanelTaskReferences, toPanelTask } from "@/lib/panelTaskMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { listPanelProjects } from "./panelProjects";
import { listPanelSiteUsers } from "./panelOrders";
import { MOCK_PANEL_PROJECTS, MOCK_PANEL_TASKS } from "@/data/panelMockData";

// =============================================================================
// Panel Tasks API — the panel team's task list on the ALTRONICPANELTEAM site.
// Mirrors api/panelOrders.ts (same site, same cross-site person/lookup
// quirks) but lighter: single-person Assigned, a single lookup to the shared
// Panel Project Reference list, a Description with checklist support, its own
// Communication thread, and Watchers. Reuses listPanelProjects +
// listPanelSiteUsers from the orders/projects modules (same department).
// =============================================================================

const PANEL_TASK_FIELD_SELECT = [
  "Title",
  "Status",
  "TaskType",
  "ProjectReferenceLookupId",
  "ProjectReference",
  "AssignedLookupId",
  "Assigned",
  "Description",
  "Communication",
  "Watchers",
  "Attachments",
  "AuthorLookupId",
  "EditorLookupId",
].join(",");

const MOCK_STORAGE_KEY = "aets:mock-panel-tasks-store-v1";

function loadMockStoreFromStorage(): PanelTask[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PanelTask[];
    return parsed.map((t) => ({
      ...t,
      createdAt: new Date(t.createdAt),
      modifiedAt: new Date(t.modifiedAt),
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
    // Storage quota exceeded, private mode, etc. — demo still works in-memory.
  }
}

let mockStore: PanelTask[] = loadMockStoreFromStorage() ?? MOCK_PANEL_TASKS.map((t) => ({ ...t }));

/** Demo-mode-only: clear local data and reset to the bundled seed. */
export function resetPanelTasksMockStore(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(MOCK_STORAGE_KEY);
    } catch {
      // ignored
    }
  }
  mockStore = MOCK_PANEL_TASKS.map((t) => ({ ...t }));
}

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** List all panel tasks, resolving project titles + assignee names. */
export async function listPanelTasks(): Promise<PanelTask[]> {
  if (USE_MOCK) {
    return delay(mockStore.map((t) => ({ ...t })));
  }

  const path =
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_TASKS_LIST_ID}/items` +
    `?$expand=fields($select=${PANEL_TASK_FIELD_SELECT})&$top=200`;
  const [items, projects, users] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listPanelProjects(),
    listPanelSiteUsers(),
  ]);
  const tasks = items.map(toPanelTask);
  attachPanelTaskReferences(tasks, projects, users);
  return tasks;
}

export async function getPanelTask(id: number): Promise<PanelTask | null> {
  const all = await listPanelTasks();
  return all.find((t) => t.id === id) ?? null;
}

/** Update arbitrary fields on a panel task. Returns the updated task. */
export async function updatePanelTaskFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<PanelTask> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Panel task ${id} not found`);

    const next = { ...mockStore[idx] };
    if ("Title" in fields) next.title = fields.Title as string;
    if ("Status" in fields) next.status = fields.Status as PanelTask["status"];
    if ("TaskType" in fields) next.taskType = fields.TaskType as PanelTask["taskType"];
    if ("Description" in fields) next.description = (fields.Description as string) ?? "";
    if ("Assigned" in fields) next.assigned = (fields.Assigned as Person | null) ?? null;
    if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
      next.watchers = fields.Watchers as Person[];
    }
    if ("ProjectReferenceLookupId" in fields) {
      const v = fields.ProjectReferenceLookupId;
      next.projectRef = v
        ? {
            lookupId: Number(v),
            title: MOCK_PANEL_PROJECTS.find((p) => p.id === Number(v))?.title ?? "",
          }
        : null;
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const path = `/sites/${SITES.panelTeam}/lists/${SP_PANEL_TASKS_LIST_ID}/items/${id}/fields`;
  await graphFetch(path, { method: "PATCH", body: JSON.stringify(fields) });

  const reloaded = await getPanelTask(id);
  if (!reloaded) throw new Error(`Panel task ${id} disappeared after update`);
  return reloaded;
}

/** Change the project reference (or clear with `null`). */
export async function setPanelTaskProject(
  id: number,
  projectLookupId: number | null,
): Promise<PanelTask> {
  return updatePanelTaskFields(id, { ProjectReferenceLookupId: projectLookupId });
}

/** Replace the single Assigned person (or clear with `null`) — plain scalar LookupId. */
export async function setPanelTaskAssigned(id: number, person: Person | null): Promise<PanelTask> {
  if (USE_MOCK) {
    return updatePanelTaskFields(id, { Assigned: person });
  }
  if (person && !person.lookupId) {
    throw new Error(
      "Cannot update Assigned: the selected person has no resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updatePanelTaskFields(id, { AssignedLookupId: person?.lookupId ?? null });
}

/** Replace the Watchers list. */
export async function setPanelTaskWatchers(id: number, people: Person[]): Promise<PanelTask> {
  if (USE_MOCK) {
    return updatePanelTaskFields(id, { Watchers: people });
  }
  const resolved = people.filter((p) => !!p.lookupId);
  if (people.length > 0 && resolved.length === 0) {
    throw new Error(
      "Cannot update Watchers: none of the watchers had a resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updatePanelTaskFields(id, multiPersonField("Watchers", people));
}

/** Add the given person to the watchers list (if not already there). */
export async function watchPanelTask(id: number, person: Person): Promise<PanelTask> {
  if (!USE_MOCK && !person.lookupId) {
    throw new Error(
      "Cannot add to watchers: your SharePoint user lookupId hasn't been resolved yet. " +
        "Please wait a moment and try again, or refresh the page.",
    );
  }
  const task = await getPanelTask(id);
  if (!task) throw new Error(`Panel task ${id} not found`);
  const alreadyWatching = task.watchers.some(
    (w) => w.email === person.email || (w.lookupId && w.lookupId === person.lookupId),
  );
  if (alreadyWatching) return task;
  return setPanelTaskWatchers(id, [...task.watchers, person]);
}

/** Remove the given person from the watchers list. */
export async function unwatchPanelTask(id: number, person: Person): Promise<PanelTask> {
  const task = await getPanelTask(id);
  if (!task) throw new Error(`Panel task ${id} not found`);
  const next = task.watchers.filter(
    (w) => !(w.email === person.email || (w.lookupId && w.lookupId === person.lookupId)),
  );
  if (next.length === task.watchers.length) return task;
  return setPanelTaskWatchers(id, next);
}

/** Append a comment to a panel task's Communication field. */
export async function addPanelTaskComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<PanelTask> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Panel task ${id} not found`);
    const next = { ...mockStore[idx] };
    next.comments = [
      {
        timestamp: new Date(),
        authorName: comment.authorName,
        authorEmail: comment.authorEmail,
        bodyHtml: comment.bodyHtml,
        attachments: [],
      },
      ...next.comments,
    ];
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const path =
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_TASKS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, comment);
  return updatePanelTaskFields(id, { Communication: newRaw });
}

/** Edit the body of an existing comment, matched by timestamp + author email. */
export async function editPanelTaskComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<PanelTask> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Panel task ${id} not found`);
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

  const path =
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_TASKS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  return updatePanelTaskFields(id, { Communication: newRaw });
}

/** Create a new panel task. Title is required; everything else optional. */
export async function createPanelTask(input: {
  title: string;
  status?: PanelTask["status"];
  taskType?: PanelTask["taskType"];
  projectLookupId?: number | null;
  description?: string;
  assigned?: Person | null;
  watchers?: Person[];
}): Promise<PanelTask> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((t) => t.id)) + 1;
    const now = new Date();
    const task: PanelTask = {
      id: nextId,
      title: input.title,
      status: input.status ?? "Pending",
      taskType: input.taskType ?? null,
      projectRef: input.projectLookupId
        ? {
            lookupId: input.projectLookupId,
            title: MOCK_PANEL_PROJECTS.find((p) => p.id === input.projectLookupId)?.title ?? "",
          }
        : null,
      assigned: input.assigned ?? null,
      description: input.description ?? "",
      watchers: input.watchers ?? [],
      comments: [],
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
      author: null,
    };
    mockStore = [task, ...mockStore];
    saveMockStoreToStorage();
    return delay({ ...task });
  }

  const fields: Record<string, unknown> = {
    Title: input.title,
    Status: input.status ?? "Pending",
  };
  if (input.taskType) fields.TaskType = input.taskType;
  if (input.projectLookupId) fields.ProjectReferenceLookupId = input.projectLookupId;
  if (input.description) fields.Description = input.description;
  if (input.assigned?.lookupId) fields.AssignedLookupId = input.assigned.lookupId;
  if (input.watchers?.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", input.watchers));
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_TASKS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return toPanelTask(created);
}
