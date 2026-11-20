import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// =============================================================================
// The task-list preview: ONE page of the most recently changed tasks.
//
// Checked live 2026-10-26 (Test-TaskListOrder.ps1): `$orderby=id desc` and
// `createdDateTime desc` come back oldest-first with no error — silently
// ignored — and `fields/ID desc` is a 400. Only `fields/Modified desc` sorts.
// A preview of the 200 OLDEST tasks would be useless, so the sort is the
// thing worth pinning. Real mode only — the mock branch builds no request.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SP_LIST_ID: "list-1", SP_SITE_ID: "site-1" };
});

import { listRecentTasks, RECENT_TASKS_PAGE } from "./tasks";

function item(id: number, fields: Record<string, unknown>) {
  return {
    id: String(id),
    createdDateTime: "2026-10-01T12:00:00Z",
    lastModifiedDateTime: "2026-10-26T12:00:00Z",
    fields,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  // listProjects reads this straight from the environment, and CI has none.
  vi.stubEnv("VITE_SP_PROJECTS_LIST_ID", "projects-1");
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetch.mockResolvedValue({
    value: [
      item(3430, { Title: "Child", NumberedTitle: "T2-0042-Child", ParentTaskLookupId: "3361", Parent_x0020_Project_x0020_ReferLookupId: "42" }),
      item(3361, { Title: "Parent", NumberedTitle: "T1-0042-Parent", Status: "In Progress" }),
    ],
  });
  // The projects list (for titles) is the only paged read allowed here.
  graphFetchAll.mockImplementation(async (path: string) => {
    if (path.includes("/lists/projects-1/")) return [{ id: "42", fields: { Title: "0042-Hub V4" } }];
    throw new Error("the preview must not page the task list");
  });
});

describe("listRecentTasks", () => {
  it("asks for one page, most recently changed first", async () => {
    await listRecentTasks();
    expect(graphFetch).toHaveBeenCalledTimes(1);
    const [path, init] = graphFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toContain("/lists/list-1/items?");
    expect(path).toContain("$orderby=fields/Modified desc");
    expect(path).toContain(`$top=${RECENT_TASKS_PAGE}`);
    expect(path).toContain("Modified)");
    expect((init.headers as Record<string, string>).Prefer).toBe(
      "HonorNonIndexedQueriesWarningMayFailRandomly",
    );
  });

  it("never uses the sorts SharePoint silently ignores", async () => {
    await listRecentTasks();
    const [path] = graphFetch.mock.calls[0] as [string];
    expect(path).not.toMatch(/orderby=id\b|orderby=createdDateTime|fields\/ID/);
  });

  it("keeps SharePoint's order and fills what it can from the page itself", async () => {
    const tasks = await listRecentTasks();
    expect(tasks.map((t) => t.id)).toEqual([3430, 3361]);
    expect(tasks[0].parentTask).toMatchObject({ id: 3361, numberedTitle: "T1-0042-Parent" });
    expect(tasks[1].childTasks.map((c) => c.id)).toEqual([3430]);
    expect(tasks[0].parentProject?.title).toBe("0042-Hub V4");
  });
});
