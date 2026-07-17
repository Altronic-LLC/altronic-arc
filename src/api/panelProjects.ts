import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_PROJECTS_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, PanelProject } from "@/types/task";
import { PANEL_PROJECT_DEPARTMENTS, PANEL_PROJECT_TYPES } from "@/types/task";
import { MOCK_PANEL_PROJECTS } from "@/data/panelMockData";

// =============================================================================
// Panel Project Reference API — the Panels department's admin-managed project
// reference list on the ALTRONICPANELTEAM site. Title = the project reference
// number (numbering scheme TBD — admins type it for now). Panel orders look
// up against this list via their ProjectReference column. Managed only at
// /admin/panel-projects.
// =============================================================================

let mockStore: PanelProject[] = MOCK_PANEL_PROJECTS.map((p) => ({ ...p }));

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function clampChoice<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : null;
}

function toPanelProject(item: GraphListItem): PanelProject {
  const f = item.fields as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    title: (f.Title as string) ?? `(project #${item.id})`,
    projectType: clampChoice(f.ProjectType, PANEL_PROJECT_TYPES),
    description: (f.ProjectDescription as string) ?? "",
    dwgNo: (f.DWGNO as string) ?? "",
    customer: (f.Customer as string) ?? "",
    department: clampChoice(f.Department, PANEL_PROJECT_DEPARTMENTS),
  };
}

/** List every Panel Project, sorted numerically by reference number (Title). */
export async function listPanelProjects(): Promise<PanelProject[]> {
  if (USE_MOCK) {
    const sorted = [...mockStore].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
    return delay(sorted.map((p) => ({ ...p })));
  }

  const path =
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_PROJECTS_LIST_ID}/items` +
    `?$expand=fields($select=Title,ProjectType,ProjectDescription,DWGNO,Customer,Department)&$top=200`;
  const items = await graphFetchAll<GraphListItem>(path);
  const projects = items.map(toPanelProject);
  projects.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return projects;
}

function writeFields(input: Omit<PanelProject, "id">): Record<string, string> {
  return {
    Title: input.title,
    ProjectType: input.projectType ?? "",
    ProjectDescription: input.description ?? "",
    DWGNO: input.dwgNo ?? "",
    Customer: input.customer ?? "",
    Department: input.department ?? "",
  };
}

/** Create a new Panel Project. Used by the admin page. */
export async function createPanelProject(input: Omit<PanelProject, "id">): Promise<PanelProject> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((p) => p.id)) + 1;
    const project: PanelProject = { ...input, id: nextId };
    mockStore = [...mockStore, project];
    return delay({ ...project });
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_PROJECTS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields: writeFields(input) }) },
  );
  return toPanelProject(created);
}

/** Update an existing Panel Project (all editable columns at once). */
export async function updatePanelProject(
  id: number,
  input: Omit<PanelProject, "id">,
): Promise<PanelProject> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Panel project ${id} not found`);
    const next: PanelProject = { ...input, id };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_PROJECTS_LIST_ID}/items/${id}/fields`,
    { method: "PATCH", body: JSON.stringify(writeFields(input)) },
  );
  return { ...input, id };
}
