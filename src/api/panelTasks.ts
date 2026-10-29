import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_TASKS_LIST_ID, SP_PANELTEAM_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds } from "./siteUsers";
import type { GraphListItem, PanelTask, Person } from "@/types/task";
import { PANEL_TASK_DEFAULT_STATUS } from "@/types/task";
import { attachPanelTaskReferences, toPanelTask } from "@/lib/panelTaskMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { listPanelProjects } from "./panelProjects";
import { listPanelSiteUsers } from "./panelOrders";
import { MOCK_PANEL_PROJECTS, MOCK_PANEL_TASKS } from "@/data/panelMockData";
import { autoWatchers } from "@/lib/people";
import { parseSpDate, toSpDateOnly } from "@/lib/spDates";
import { mockDelay } from "./mockLatency";

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
  // Added by scripts/setup-panel-planning.ps1 (steps 7-8) — they must exist
  // before this ships, or the whole read 400s.
  "WorkType",
  "Priority",
  "ProjectReferenceLookupId",
  "ProjectReference",
  // The order a standard task was raised for (single lookup, both halves).
  // scripts/setup-panel-planning.ps1 adds the column; it must exist
  // before this ships, or the whole read 400s.
  "PanelOrderRefLookupId",
  "PanelOrderRef",
  "AssignedLookupId",
  "Assigned",
  "Description",
  "StartDate",
  "DueDate",
  "EstimatedHours",
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
      // Stores written before the schedule fields existed have none.
      startDate: parseSpDate(t.startDate),
      dueDate: parseSpDate(t.dueDate),
      estimatedHours: t.estimatedHours ?? null,
      orderRef: t.orderRef ?? null,
      workType: t.workType ?? null,
      priority: t.priority ?? null,
      // Stores written before several assignees (2026-10-29) hold one person
      // or null; everything downstream expects a list.
      assigned: Array.isArray(t.assigned)
        ? t.assigned
        : t.assigned
          ? [t.assigned as unknown as Person]
          : [],
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

/** List all panel tasks, resolving project titles + assignee names. */
export async function listPanelTasks(): Promise<PanelTask[]> {
  if (USE_MOCK) {
    return mockDelay(mockStore.map((t) => ({ ...t })));
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
    if ("WorkType" in fields) next.workType = (fields.WorkType as PanelTask["workType"]) ?? null;
    if ("Priority" in fields) next.priority = (fields.Priority as PanelTask["priority"]) ?? null;
    if ("Description" in fields) next.description = (fields.Description as string) ?? "";
    if ("StartDate" in fields) next.startDate = parseSpDate(fields.StartDate);
    if ("DueDate" in fields) next.dueDate = parseSpDate(fields.DueDate);
    if ("EstimatedHours" in fields) {
      next.estimatedHours = (fields.EstimatedHours as number | null) ?? null;
    }
    if ("Assigned" in fields && Array.isArray(fields.Assigned)) next.assigned = fields.Assigned as Person[];
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
    return mockDelay({ ...next });
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

/** What the Capacity view needs from a task: when, and how many hours. */
export interface PanelTaskSchedule {
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
}

/**
 * The three schedule columns as a write payload — date-only at midday UTC,
 * `null` to clear. One PATCH, so a task can't end up half-rescheduled.
 */
export function panelTaskScheduleFields(
  schedule: Partial<PanelTaskSchedule>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (schedule.startDate !== undefined) fields.StartDate = toSpDateOnly(schedule.startDate);
  if (schedule.dueDate !== undefined) fields.DueDate = toSpDateOnly(schedule.dueDate);
  if (schedule.estimatedHours !== undefined) fields.EstimatedHours = schedule.estimatedHours;
  return fields;
}

/** Change any of a task's start date, due date and estimated hours. */
export async function setPanelTaskSchedule(
  id: number,
  schedule: Partial<PanelTaskSchedule>,
): Promise<PanelTask> {
  return updatePanelTaskFields(id, panelTaskScheduleFields(schedule));
}

/**
 * Save a Capacity plan for one task: any of assignee, start and due, in ONE
 * PATCH so the task can't land half-planned. A new assignee also becomes a
 * watcher (the house rule), and one that can't be resolved on the panel site
 * REFUSES the write rather than clearing the column.
 */
export async function setPanelTaskPlan(
  id: number,
  plan: { assigned?: Person[]; startDate?: Date; dueDate?: Date },
): Promise<PanelTask> {
  const fields: Record<string, unknown> = panelTaskScheduleFields({
    startDate: plan.startDate,
    dueDate: plan.dueDate,
  });
  if (plan.assigned) {
    const current = await getPanelTask(id);
    const watchers = autoWatchers(current?.watchers, plan.assigned);
    if (USE_MOCK) {
      Object.assign(fields, { Assigned: plan.assigned, Watchers: watchers });
    } else {
      Object.assign(fields, await assignedFields(plan.assigned, watchers));
    }
  }
  return updatePanelTaskFields(id, fields);
}

/**
 * Assigned (multi-person, the two-key shape) + Watchers, resolved on the panel
 * site. Anybody who can't be resolved REFUSES the write — a task quietly
 * missing one of its people reads as nobody's work.
 */
async function assignedFields(people: Person[], watchers: Person[]): Promise<Record<string, unknown>> {
  const resolved = await ensureLookupIds(SP_PANELTEAM_SITE_URL, people);
  const missing = resolved.filter((p) => !p.lookupId);
  if (missing.length) {
    throw new Error(
      `Couldn't find ${missing.map((p) => p.displayName).join(", ")} on the panel team's SharePoint site, so the task wasn't assigned.`,
    );
  }
  return {
    ...multiPersonField("Assigned", resolved),
    ...multiPersonField("Watchers", await ensureLookupIds(SP_PANELTEAM_SITE_URL, watchers)),
  };
}

/** Replace everyone assigned ([] clears it). New assignees also become watchers. */
export async function setPanelTaskAssigned(id: number, people: Person[]): Promise<PanelTask> {
  // The assignee also becomes a watcher — see api/tasks.ts.
  const current = await getPanelTask(id);
  const watchers = autoWatchers(current?.watchers, people);
  if (USE_MOCK) {
    return updatePanelTaskFields(id, { Assigned: people, Watchers: watchers });
  }
  return updatePanelTaskFields(id, await assignedFields(people, watchers));
}

/** Replace the Watchers list. */
export async function setPanelTaskWatchers(id: number, people: Person[]): Promise<PanelTask> {
  if (USE_MOCK) {
    return updatePanelTaskFields(id, { Watchers: people });
  }
  const ensured = await ensureLookupIds(SP_PANELTEAM_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updatePanelTaskFields(id, multiPersonField("Watchers", ensured));
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
    return mockDelay({ ...next });
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
    return mockDelay({ ...next });
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
  workType?: PanelTask["workType"];
  priority?: PanelTask["priority"];
  projectLookupId?: number | null;
  description?: string;
  assigned?: Person[];
  watchers?: Person[];
  startDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number | null;
  /** The Panel Order this task was raised for (its standard tasks). */
  orderLookupId?: number | null;
}): Promise<PanelTask> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((t) => t.id)) + 1;
    const now = new Date();
    const task: PanelTask = {
      id: nextId,
      title: input.title,
      status: input.status ?? PANEL_TASK_DEFAULT_STATUS,
      taskType: input.taskType ?? null,
      workType: input.workType ?? null,
      priority: input.priority ?? null,
      projectRef: input.projectLookupId
        ? {
            lookupId: input.projectLookupId,
            title: MOCK_PANEL_PROJECTS.find((p) => p.id === input.projectLookupId)?.title ?? "",
          }
        : null,
      orderRef: input.orderLookupId ? { lookupId: input.orderLookupId, title: "" } : null,
      assigned: input.assigned ?? [],
      description: input.description ?? "",
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      estimatedHours: input.estimatedHours ?? null,
      watchers: input.watchers ?? [],
      comments: [],
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
      author: null,
    };
    mockStore = [task, ...mockStore];
    saveMockStoreToStorage();
    return mockDelay({ ...task });
  }

  const fields: Record<string, unknown> = {
    Title: input.title,
    Status: input.status ?? PANEL_TASK_DEFAULT_STATUS,
  };
  if (input.taskType) fields.TaskType = input.taskType;
  if (input.workType) fields.WorkType = input.workType;
  if (input.priority) fields.Priority = input.priority;
  if (input.projectLookupId) fields.ProjectReferenceLookupId = input.projectLookupId;
  // A single lookup: a bare integer, never the Collection(Edm.Int32) shape.
  if (input.orderLookupId) fields.PanelOrderRefLookupId = input.orderLookupId;
  if (input.description) fields.Description = input.description;
  // Blank schedule fields are left out of the create, like every other blank.
  Object.assign(
    fields,
    panelTaskScheduleFields({
      startDate: input.startDate ?? undefined,
      dueDate: input.dueDate ?? undefined,
      estimatedHours: input.estimatedHours ?? undefined,
    }),
  );
  // Resolve lookupIds (creating on demand) for directory-picked people.
  // Anyone asked for who can't be resolved REFUSES the create — a task
  // silently missing an assignee reads as nobody's (or fewer people's) work.
  if (input.assigned?.length) {
    const assigned = await ensureLookupIds(SP_PANELTEAM_SITE_URL, input.assigned);
    const missing = assigned.filter((p) => !p.lookupId);
    if (missing.length) {
      throw new Error(
        `Couldn't find ${missing.map((p) => p.displayName).join(", ")} on the panel team's SharePoint site, so the task wasn't created.`,
      );
    }
    Object.assign(fields, multiPersonField("Assigned", assigned));
  }
  const watchers = input.watchers
    ? await ensureLookupIds(SP_PANELTEAM_SITE_URL, input.watchers)
    : [];
  if (watchers.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_TASKS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return toPanelTask(created);
}
