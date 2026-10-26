import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Reading ONE task reads one item — never the whole Project Task List.
//
// getTask() used to call listTasks() and pick a row out: ~17 sequential
// pages carrying every comment thread on the list. Every task write re-reads
// through it, and Watch / Assign read through it first, so a single comment
// or status change downloaded the whole list (twice, counting the refetch
// after it). Investigated 2026-10-26 when the list started answering 504.
//
// Real mode only — the mock branch never builds a request.
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

// People resolution makes its own requests and isn't what this pins.
vi.mock("./siteUsers", () => ({
  ensureLookupIds: vi.fn(async (_site: string, people: unknown[]) => people),
}));

import { getTask, setTaskStatus, watchTask } from "./tasks";

const ITEM = {
  id: "7",
  createdDateTime: "2026-10-01T12:00:00Z",
  lastModifiedDateTime: "2026-10-26T12:00:00Z",
  fields: { Title: "Hub V4", NumberedTitle: "T3-0017-Hub V4", Status: "In Progress" },
};

function gets(): string[] {
  return graphFetch.mock.calls
    .filter(([, init]) => !(init as RequestInit | undefined)?.method)
    .map(([path]) => String(path));
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetchAll.mockImplementation(async () => {
    throw new Error("reading one task must not download the whole list");
  });
  graphFetch.mockResolvedValue(ITEM);
});

describe("getTask", () => {
  it("reads the one item by id, with the list read's column set", async () => {
    const task = await getTask(7);
    expect(task?.id).toBe(7);
    expect(task?.numberedTitle).toBe("T3-0017-Hub V4");
    expect(gets()).toHaveLength(1);
    expect(gets()[0]).toContain("/sites/site-1/lists/list-1/items/7?$expand=fields($select=");
    expect(gets()[0]).toContain("Communication");
    expect(graphFetchAll).not.toHaveBeenCalled();
  });

  it("answers null for a task that no longer exists", async () => {
    graphFetch.mockRejectedValue(Object.assign(new Error("Graph 404"), { status: 404 }));
    await expect(getTask(7)).resolves.toBeNull();
  });

  it("does NOT read any other failure as 'gone'", async () => {
    const denied = Object.assign(new Error("Graph 403"), { status: 403, body: "accessDenied" });
    graphFetch.mockRejectedValue(denied);
    await expect(getTask(7)).rejects.toBe(denied);
  });
});

describe("task writes re-read one item", () => {
  it("a status change PATCHes, then reads back only that task", async () => {
    const task = await setTaskStatus(7, "Complete");
    expect(task.id).toBe(7);
    expect(gets()).toEqual([expect.stringContaining("/items/7?$expand=fields($select=")]);
    expect(graphFetchAll).not.toHaveBeenCalled();
  });

  it("Watch reads the current watchers from the one item", async () => {
    await watchTask(7, { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 12 });
    expect(graphFetchAll).not.toHaveBeenCalled();
    for (const path of gets()) expect(path).toContain("/items/7?");
  });
});
