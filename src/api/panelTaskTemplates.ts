import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_TASK_TEMPLATES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, PanelTaskTemplate, PanelTaskType } from "@/types/task";
import { PANEL_TASK_TYPES } from "@/types/task";
import { DEFAULT_PANEL_TASK_TEMPLATES } from "@/lib/panelOrderTasks";
import { toNumberOrNull } from "@/lib/graphValues";

// =============================================================================
// Panel Task Templates — the tasks a new Panel Order raises (ARC's version of
// Wrike's "Panel Blueprint - Production Job"), on ALTRONICPANELTEAM. The
// panel managers keep it in ARC, so changing a step's hours needs no deploy.
//
// It HAS a delete: a raised task stores its own title, type and hours, so
// removing a template changes no task — it just stops being raised. Active =
// false does the same and keeps the row.
//
// Unset list = the built-in four, read-only, so a new order still raises
// Wrike's blueprint before the list exists.
// =============================================================================

export interface PanelTaskTemplateInput {
  title: string;
  taskType: PanelTaskType | null;
  estimatedHours: number | null;
  sortOrder: number;
  active: boolean;
}

const SELECT = "Title,TaskType,EstimatedHours,SortOrder,Active";

function seed(): PanelTaskTemplate[] {
  return DEFAULT_PANEL_TASK_TEMPLATES.map((t, i) => ({ ...t, id: i + 1 }));
}

let mockStore: PanelTaskTemplate[] = seed();

/** Demo-mode-only: reset the store (tests). */
export function resetPanelTaskTemplatesMockStore(): void {
  mockStore = seed();
}

/** Whether the list is set up. Demo mode always is. */
export const PANEL_TASK_TEMPLATES_CONFIGURED = USE_MOCK || !!SP_PANEL_TASK_TEMPLATES_LIST_ID;

function listPath(): string {
  return `/sites/${SITES.panelTeam}/lists/${SP_PANEL_TASK_TEMPLATES_LIST_ID}/items`;
}

export function toPanelTaskTemplate(item: GraphListItem): PanelTaskTemplate {
  const f = item.fields as Record<string, unknown>;
  const type = typeof f.TaskType === "string" ? f.TaskType : "";
  return {
    id: parseInt(item.id, 10),
    title: typeof f.Title === "string" ? f.Title : "",
    taskType: (PANEL_TASK_TYPES as readonly string[]).includes(type) ? (type as PanelTaskType) : null,
    estimatedHours: toNumberOrNull(f.EstimatedHours),
    sortOrder: toNumberOrNull(f.SortOrder) ?? 0,
    // A blank Active reads as active: a row added in SharePoint without
    // touching the box is meant to be used.
    active: f.Active !== false,
  };
}

/** Every template, in SortOrder. Unset list = the built-in four. */
export async function listPanelTaskTemplates(): Promise<PanelTaskTemplate[]> {
  if (USE_MOCK) return mockDelay(mockStore.map((t) => ({ ...t })));
  if (!SP_PANEL_TASK_TEMPLATES_LIST_ID) return seed();
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toPanelTaskTemplate).sort((a, b) => a.sortOrder - b.sortOrder);
}

function requireConfigured(action: string): void {
  if (!SP_PANEL_TASK_TEMPLATES_LIST_ID) {
    throw new Error(
      `The Panel Task Templates list isn't set up yet, so ARC can't ${action}. ` +
        "Run scripts/setup-panel-planning.ps1 and set VITE_SP_PANEL_TASK_TEMPLATES_LIST_ID.",
    );
  }
}

/** The columns a write sends. A blank type or hours clears the column. */
export function panelTaskTemplateFields(input: PanelTaskTemplateInput): Record<string, unknown> {
  return {
    Title: input.title.trim(),
    TaskType: input.taskType,
    EstimatedHours: input.estimatedHours,
    SortOrder: input.sortOrder,
    Active: input.active,
  };
}

export async function createPanelTaskTemplate(input: PanelTaskTemplateInput): Promise<PanelTaskTemplate> {
  if (USE_MOCK) {
    const row: PanelTaskTemplate = {
      ...input,
      title: input.title.trim(),
      id: Math.max(0, ...mockStore.map((t) => t.id)) + 1,
    };
    mockStore = [...mockStore, row];
    return mockDelay({ ...row });
  }
  requireConfigured("add a task");
  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({ fields: panelTaskTemplateFields(input) }),
  });
  return toPanelTaskTemplate(created);
}

export async function updatePanelTaskTemplate(
  id: number,
  input: PanelTaskTemplateInput,
): Promise<PanelTaskTemplate> {
  if (USE_MOCK) {
    const i = mockStore.findIndex((t) => t.id === id);
    if (i < 0) throw new Error(`Template ${id} not found.`);
    mockStore[i] = { ...input, title: input.title.trim(), id };
    return mockDelay({ ...mockStore[i] });
  }
  requireConfigured("change a task");
  await graphFetch(`${listPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(panelTaskTemplateFields(input)),
  });
  const item = await graphFetch<GraphListItem>(`${listPath()}/${id}?$expand=fields($select=${SELECT})`);
  return toPanelTaskTemplate(item);
}

export async function deletePanelTaskTemplate(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((t) => t.id !== id);
    return mockDelay(undefined);
  }
  requireConfigured("remove a task");
  await graphFetch(`${listPath()}/${id}`, { method: "DELETE" });
}
