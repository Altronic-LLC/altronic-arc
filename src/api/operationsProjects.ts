import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_OPERATIONS_PROJECTS_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, ProjectReference } from "@/types/task";
import { MOCK_OPERATIONS_PROJECTS } from "@/data/operationsMockData";

// =============================================================================
// Operations Projects API — the Operations department's own parent-project
// reference list (separate from Engineering's Project Overview list), on the
// PMO site. Mirrors listProjects/createProject/updateProject in api/tasks.ts,
// but this list keeps the project number and name in SEPARATE columns
// (ProjectNumber, Title) plus a combined ProjectRef column ("0002-Name") that
// tasks actually look up against — so create/update write all three, unlike
// Engineering where the combined form lives directly in Title.
// =============================================================================

let mockStore: ProjectReference[] = [...MOCK_OPERATIONS_PROJECTS];

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function buildProjectRef(projectNumber: string, title: string): string {
  return `${projectNumber}-${title}`;
}

/** List every Operations Project, sorted numerically by ProjectRef (e.g. "0000", "0002", "0003", ...). */
export async function listOperationsProjects(): Promise<ProjectReference[]> {
  if (USE_MOCK) {
    const sorted = [...mockStore].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
    return delay(sorted);
  }

  const path =
    `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_PROJECTS_LIST_ID}/items` +
    `?$expand=fields($select=ProjectRef)&$top=200`;
  const items = await graphFetchAll<GraphListItem>(path);
  const projects = items.map((item) => ({
    lookupId: parseInt(item.id, 10),
    title: (item.fields.ProjectRef as string) ?? `(project #${item.id})`,
  }));
  projects.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return projects;
}

/** Create a new Operations Project. Used by the admin page. */
export async function createOperationsProject(input: {
  projectNumber: string;
  title: string;
}): Promise<ProjectReference> {
  const projectRef = buildProjectRef(input.projectNumber, input.title);

  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((p) => p.lookupId)) + 1;
    const project: ProjectReference = { lookupId: nextId, title: projectRef };
    mockStore = [...mockStore, project];
    return delay(project);
  }

  const path = `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_PROJECTS_LIST_ID}/items`;
  const created = await graphFetch<GraphListItem>(path, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Title: input.title,
        ProjectNumber: input.projectNumber,
        ProjectRef: projectRef,
      },
    }),
  });
  return {
    lookupId: parseInt(created.id, 10),
    title: (created.fields.ProjectRef as string) ?? projectRef,
  };
}

/**
 * Rename an existing Operations Project. `projectNumber` stays fixed (it's
 * the identity of the project); only the name changes, and ProjectRef is
 * recomputed to match.
 */
export async function updateOperationsProject(
  lookupId: number,
  input: { projectNumber: string; title: string },
): Promise<ProjectReference> {
  const projectRef = buildProjectRef(input.projectNumber, input.title);

  if (USE_MOCK) {
    const idx = mockStore.findIndex((p) => p.lookupId === lookupId);
    if (idx < 0) throw new Error(`Operations project ${lookupId} not found`);
    const next = { lookupId, title: projectRef };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(next);
  }

  await graphFetch(
    `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_PROJECTS_LIST_ID}/items/${lookupId}/fields`,
    {
      method: "PATCH",
      body: JSON.stringify({
        Title: input.title,
        ProjectNumber: input.projectNumber,
        ProjectRef: projectRef,
      }),
    },
  );
  return { lookupId, title: projectRef };
}
