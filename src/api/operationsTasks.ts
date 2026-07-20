import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_OPERATIONS_TASKS_LIST_ID, SP_PMO_SITE_URL, USE_MOCK } from "./config";
import { spFetch } from "./sharepoint";
import { ensureLookupIds, ensurePersonLookupId, ensureSiteUserLookupId } from "./siteUsers";
import type { GraphListItem, OperationsTask, Person, ProjectReference } from "@/types/task";
import { toOperationsTask } from "@/lib/operationsTaskMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { listOperationsProjects } from "./operationsProjects";
import { listOperationsEquipment } from "./operationsEquipment";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";

// =============================================================================
// Operations Tasks API — mirrors api/tasks.ts's USE_MOCK-branching structure,
// against a different SharePoint site/list (Altronic_PMO's Operations Task
// List instead of Engineering's Project Task List). Key differences from
// Engineering tasks: Assigned is a SINGLE person (not multi), there's no
// parent/child task hierarchy or related-projects, and there's an extra
// single lookup to the Altronic Equipment List.
// =============================================================================

const OPERATIONS_FIELD_SELECT = [
  "Title",
  "TaskDescription",
  "Status",
  "PriorityRequest",
  "TaskType",
  "Location",
  "DueDate",
  "AuthorLookupId",
  "EditorLookupId",
  "AssignedLookupId",
  "Assigned",
  "Watchers",
  "ProjectRefLookupId",
  "ProjectRef",
  "AltronicEquipmentLookupId",
  "AltronicEquipment",
  "Communication",
  "TaskNumber",
  "Attachments",
].join(",");

const MOCK_STORAGE_KEY = "aets:mock-operations-store-v1";

function loadMockStoreFromStorage(): OperationsTask[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OperationsTask[];
    return parsed.map((t) => ({
      ...t,
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
    // Storage quota exceeded, private mode, etc. — demo still works in-memory.
  }
}

let mockStore: OperationsTask[] = loadMockStoreFromStorage() ?? [...MOCK_OPERATIONS_TASKS];

/** Demo-mode-only: clear local data and reset to the bundled seed. */
export function resetOperationsMockStore(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(MOCK_STORAGE_KEY);
    } catch {
      // ignored
    }
  }
  mockStore = [...MOCK_OPERATIONS_TASKS];
}

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

interface SpSiteUser {
  Id: number;
  Title: string;
  Email?: string;
}

/**
 * Resolve the PMO site's user list (SharePoint's "site users" — the same
 * directory `AssignedLookupId`/etc. point into) to a lookupId → Person map,
 * via the classic SP REST API (same auth path as attachments). This is the
 * only way to get a display name for a single-value person field — unlike
 * multi-value person fields (Watchers), Graph never resolves single-value
 * ones, only the bare LookupId (see toOperationsTask's comment).
 *
 * Best-effort: if SP REST isn't reachable (no AllSites.Manage consent yet),
 * returns an empty map so callers just show the un-named fallback rather
 * than breaking the whole task list.
 */
async function listPmoSiteUsers(): Promise<Map<number, Person>> {
  try {
    const res = await spFetch<{ value: SpSiteUser[] }>(
      `${SP_PMO_SITE_URL}/_api/web/siteusers?$select=Id,Title,Email`,
    );
    const map = new Map<number, Person>();
    for (const u of res.value) {
      if (!u.Title) continue;
      map.set(u.Id, { displayName: u.Title, email: u.Email || undefined, lookupId: u.Id });
    }
    return map;
  } catch (err) {
    console.warn(
      "[operationsTasks] Couldn't resolve PMO site users — Assigned names will show blank until this works:",
      err,
    );
    return new Map();
  }
}

/**
 * Resolve a single email to its PMO site user lookupId — used to auto-watch
 * someone @-mentioned for the first time who's never been an assignee or
 * watcher on any Operations task (so they're not in the task-derived
 * directory built from existing tasks). Re-fetches the site user list, same
 * as `listPmoSiteUsers`; there's no caching layer here since this only runs
 * on the rare cold-start mention.
 */
export async function resolvePmoSiteUserLookupId(email: string): Promise<number> {
  const users = await listPmoSiteUsers();
  const target = email.toLowerCase();
  for (const u of users.values()) {
    if (u.email?.toLowerCase() === target) return u.lookupId ?? 0;
  }
  // Not a known PMO site user yet (e.g. picked from the staff directory) —
  // ensure them on the site so they can be assigned / auto-watched.
  return ensureSiteUserLookupId(SP_PMO_SITE_URL, email);
}

/**
 * Resolve `parentProject.title` / `equipment.title` / `assigned.displayName`
 * against the Operations Projects / Altronic Equipment / PMO site-user
 * directories. Mirrors `attachProjectTitles` in lib/taskGraph.ts. Mutates
 * in place.
 */
function attachLookupTitles(
  tasks: OperationsTask[],
  projects: ProjectReference[],
  equipment: ProjectReference[],
  usersById: Map<number, Person>,
): OperationsTask[] {
  const projectsById = new Map(projects.map((p) => [p.lookupId, p]));
  const equipmentById = new Map(equipment.map((e) => [e.lookupId, e]));

  for (const task of tasks) {
    if (task.parentProject && !task.parentProject.title) {
      const resolved = projectsById.get(task.parentProject.lookupId);
      if (resolved) task.parentProject = { ...task.parentProject, title: resolved.title };
    }
    if (task.equipment && !task.equipment.title) {
      const resolved = equipmentById.get(task.equipment.lookupId);
      if (resolved) task.equipment = { ...task.equipment, title: resolved.title };
    }
    if (task.assigned && !task.assigned.displayName && task.assigned.lookupId) {
      const resolved = usersById.get(task.assigned.lookupId);
      if (resolved) task.assigned = resolved;
    }
  }
  return tasks;
}

/** List all Operations tasks, resolving project/equipment/assignee lookups. */
export async function listOperationsTasks(): Promise<OperationsTask[]> {
  if (USE_MOCK) {
    const copy = mockStore.map((t) => ({ ...t }));
    return delay(copy);
  }

  const path =
    `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_TASKS_LIST_ID}/items` +
    `?$expand=fields($select=${OPERATIONS_FIELD_SELECT})&$top=200`;
  const [items, projects, equipment, users] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listOperationsProjects(),
    listOperationsEquipment(),
    listPmoSiteUsers(),
  ]);
  const tasks = items.map(toOperationsTask);
  attachLookupTitles(tasks, projects, equipment, users);
  return tasks;
}

export async function getOperationsTask(id: number): Promise<OperationsTask | null> {
  const all = await listOperationsTasks();
  return all.find((t) => t.id === id) ?? null;
}

/** Update arbitrary fields on an Operations task. Returns the updated task. */
export async function updateOperationsTaskFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<OperationsTask> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Operations task ${id} not found`);

    const next = { ...mockStore[idx] };
    if ("Status" in fields) next.status = fields.Status as OperationsTask["status"];
    if ("Title" in fields) next.title = fields.Title as string;
    if ("TaskDescription" in fields) next.description = fields.TaskDescription as string;
    if ("PriorityRequest" in fields) next.priority = fields.PriorityRequest as OperationsTask["priority"];
    if ("TaskType" in fields) next.taskType = fields.TaskType as OperationsTask["taskType"];
    if ("Location" in fields) next.location = fields.Location as OperationsTask["location"];
    if ("DueDate" in fields) {
      const v = fields.DueDate;
      next.dueDate = v ? new Date(v as string) : null;
    }
    if ("Assigned" in fields) {
      next.assigned = (fields.Assigned as Person | null) ?? null;
    }
    if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
      next.watchers = fields.Watchers as Person[];
    }
    if ("ProjectRefLookupId" in fields) {
      const v = fields.ProjectRefLookupId;
      next.parentProject = v ? { lookupId: Number(v), title: next.parentProject?.title ?? "" } : null;
    }
    if ("AltronicEquipmentLookupId" in fields) {
      const v = fields.AltronicEquipmentLookupId;
      next.equipment = v ? { lookupId: Number(v), title: next.equipment?.title ?? "" } : null;
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const path = `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_TASKS_LIST_ID}/items/${id}/fields`;
  await graphFetch(path, { method: "PATCH", body: JSON.stringify(fields) });

  const reloaded = await getOperationsTask(id);
  if (!reloaded) throw new Error(`Operations task ${id} disappeared after update`);
  return reloaded;
}

/** Convenience: just change the status. Used by Kanban drag-and-drop. */
export async function setOperationsStatus(
  id: number,
  status: OperationsTask["status"],
): Promise<OperationsTask> {
  return updateOperationsTaskFields(id, { Status: status });
}

/** Change the parent project (or clear with `null`). */
export async function setOperationsParentProject(
  id: number,
  projectLookupId: number | null,
): Promise<OperationsTask> {
  return updateOperationsTaskFields(id, { ProjectRefLookupId: projectLookupId });
}

/** Change the equipment reference (or clear with `null`). */
export async function setOperationsEquipment(
  id: number,
  equipmentLookupId: number | null,
): Promise<OperationsTask> {
  return updateOperationsTaskFields(id, { AltronicEquipmentLookupId: equipmentLookupId });
}

/**
 * Replace the single Assigned person (or clear with `null`). Unlike
 * Engineering's multi-person Assigned, this column disallows multiple
 * values — the write is a plain scalar LookupId, same shape as any other
 * single-person field (see setEirReporter in api/eirs.ts). No @odata.type
 * annotation needed; that's only required for the Collection(Edm.Int32)
 * multi-value case.
 */
export async function setOperationsAssigned(
  id: number,
  person: Person | null,
): Promise<OperationsTask> {
  if (USE_MOCK) {
    return updateOperationsTaskFields(id, { Assigned: person });
  }
  // Resolve (creating if needed) the site lookupId — the person may have been
  // picked from the staff directory and never seen on this site before.
  const ensured = await ensurePersonLookupId(SP_PMO_SITE_URL, person);
  if (person && !ensured?.lookupId) {
    throw new Error(
      "Cannot update Assigned: couldn't resolve a SharePoint user for the selected person.",
    );
  }
  return updateOperationsTaskFields(id, { AssignedLookupId: ensured?.lookupId ?? null });
}

/** Replace the Watchers list. */
export async function setOperationsWatchers(
  id: number,
  people: Person[],
): Promise<OperationsTask> {
  if (USE_MOCK) {
    return updateOperationsTaskFields(id, { Watchers: people });
  }
  const ensured = await ensureLookupIds(SP_PMO_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateOperationsTaskFields(id, multiPersonField("Watchers", ensured));
}

/** Add the given person to the watchers list (if not already there). */
export async function watchOperationsTask(id: number, person: Person): Promise<OperationsTask> {
  if (!USE_MOCK && !person.lookupId) {
    throw new Error(
      "Cannot add to watchers: your SharePoint user lookupId hasn't been resolved yet. " +
        "Please wait a moment and try again, or refresh the page.",
    );
  }
  const task = await getOperationsTask(id);
  if (!task) throw new Error(`Operations task ${id} not found`);
  const alreadyWatching = task.watchers.some(
    (w) => w.email === person.email || (w.lookupId && w.lookupId === person.lookupId),
  );
  if (alreadyWatching) return task;
  return setOperationsWatchers(id, [...task.watchers, person]);
}

/** Remove the given person from the watchers list. */
export async function unwatchOperationsTask(id: number, person: Person): Promise<OperationsTask> {
  const task = await getOperationsTask(id);
  if (!task) throw new Error(`Operations task ${id} not found`);
  const next = task.watchers.filter(
    (w) => !(w.email === person.email || (w.lookupId && w.lookupId === person.lookupId)),
  );
  if (next.length === task.watchers.length) return task;
  return setOperationsWatchers(id, next);
}

/** Append a comment to an Operations task's Communication field. */
export async function addOperationsComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<OperationsTask> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Operations task ${id} not found`);
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
    `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_TASKS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, comment);
  return updateOperationsTaskFields(id, { Communication: newRaw });
}

/** Edit the body of an existing comment, matched by timestamp + author email. */
export async function editOperationsComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<OperationsTask> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Operations task ${id} not found`);
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
    `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_TASKS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  return updateOperationsTaskFields(id, { Communication: newRaw });
}

/** Create a new Operations task. Title is required; everything else is optional. */
export async function createOperationsTask(input: {
  title: string;
  taskNumber?: string;
  description?: string;
  status?: OperationsTask["status"];
  priority?: string | null;
  taskType?: string | null;
  location?: string | null;
  dueDate?: Date | null;
  parentProjectLookupId?: number | null;
  equipmentLookupId?: number | null;
  assigned?: Person | null;
  watchers?: Person[];
}): Promise<OperationsTask> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((t) => t.id)) + 1;
    const now = new Date();
    const parentProject = input.parentProjectLookupId
      ? MOCK_OPERATIONS_TASKS.find((t) => t.parentProject?.lookupId === input.parentProjectLookupId)
          ?.parentProject ?? { lookupId: input.parentProjectLookupId, title: "" }
      : null;
    const equipment = input.equipmentLookupId
      ? MOCK_OPERATIONS_TASKS.find((t) => t.equipment?.lookupId === input.equipmentLookupId)
          ?.equipment ?? { lookupId: input.equipmentLookupId, title: "" }
      : null;
    const task: OperationsTask = {
      id: nextId,
      taskNumber: input.taskNumber ?? `Task ${parentProject?.title.slice(0, 4) ?? "0000"}-${nextId}`,
      title: input.title,
      description: input.description ?? "",
      status: input.status ?? "Backlog",
      priority: (input.priority as OperationsTask["priority"]) ?? null,
      taskType: (input.taskType as OperationsTask["taskType"]) ?? null,
      location: (input.location as OperationsTask["location"]) ?? null,
      dueDate: input.dueDate ?? null,
      createdAt: now,
      modifiedAt: now,
      authorLookupId: 0,
      author: null,
      editorLookupId: 0,
      assigned: input.assigned ?? null,
      watchers: input.watchers ?? [],
      parentProject,
      equipment,
      comments: [],
      hasAttachments: false,
    };
    mockStore = [task, ...mockStore];
    saveMockStoreToStorage();
    return delay(task);
  }

  const path = `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_TASKS_LIST_ID}/items`;
  const fields: Record<string, unknown> = { Title: input.title };
  if (input.taskNumber) fields.TaskNumber = input.taskNumber;
  if (input.description) fields.TaskDescription = input.description;
  if (input.status) fields.Status = input.status;
  if (input.priority) fields.PriorityRequest = input.priority;
  if (input.taskType) fields.TaskType = input.taskType;
  if (input.location) fields.Location = input.location;
  if (input.dueDate) fields.DueDate = input.dueDate.toISOString();
  if (input.parentProjectLookupId) fields.ProjectRefLookupId = input.parentProjectLookupId;
  if (input.equipmentLookupId) fields.AltronicEquipmentLookupId = input.equipmentLookupId;
  // Resolve lookupIds (creating on demand) for directory-picked people.
  const assigned = await ensurePersonLookupId(SP_PMO_SITE_URL, input.assigned ?? null);
  if (assigned?.lookupId) fields.AssignedLookupId = assigned.lookupId;
  const watchers = input.watchers ? await ensureLookupIds(SP_PMO_SITE_URL, input.watchers) : [];
  if (watchers.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }

  const created = await graphFetch<GraphListItem>(path, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return toOperationsTask(created);
}
