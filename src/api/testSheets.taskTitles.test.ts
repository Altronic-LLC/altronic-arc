import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Test Sheets name each sheet's task without downloading the task list.
//
// listTestSheets called listTasks() — the whole Project Task List, every
// comment thread — just to put a numbered title beside each sheet, and every
// test-sheet edit re-read through getTestSheet, which did all of that again.
// Now the list takes its task titles from the caller (the cache), and the
// re-read after an edit reads one sheet and one task (2026-10-26).
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const listTasks = vi.hoisted(() => vi.fn());
const getTask = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_SITE_ID: "site-1",
    SP_TEST_RESULTS_LIST_ID: "sheets-1",
  };
});

vi.mock("./tasks", () => ({
  listTasks,
  getTask,
  listProjects: vi.fn(async () => [{ lookupId: 42, title: "Engineering Apps" }]),
}));

import { getTestSheet, listTestSheets, updateTestSheetFields } from "./testSheets";

const SHEET = {
  id: "5",
  createdDateTime: "2026-10-01T12:00:00Z",
  lastModifiedDateTime: "2026-10-26T12:00:00Z",
  fields: { Title: "Burn-in", ProjectReferenceLookupId: "42", TaskReferenceLookupId: "15" },
};

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  listTasks.mockReset();
  getTask.mockReset();
  listTasks.mockRejectedValue(new Error("must not download the task list"));
  getTask.mockResolvedValue({ id: 15, numberedTitle: "T3-0042-Hub V4" });
  graphFetchAll.mockResolvedValue([SHEET]);
  graphFetch.mockResolvedValue(SHEET);
});

describe("listTestSheets", () => {
  it("names each sheet's task from the titles it is given", async () => {
    const sheets = await listTestSheets(async () => [{ id: 15, numberedTitle: "T3-0042-Hub V4" }]);
    expect(sheets[0].parentTask?.numberedTitle).toBe("T3-0042-Hub V4");
    expect(sheets[0].parentProject?.title).toBe("Engineering Apps");
    expect(listTasks).not.toHaveBeenCalled();
  });
});

describe("getTestSheet", () => {
  it("reads one sheet and the one task it names", async () => {
    const sheet = await getTestSheet(5);
    expect(sheet?.parentTask?.numberedTitle).toBe("T3-0042-Hub V4");
    expect(getTask).toHaveBeenCalledWith(15);
    expect(graphFetch.mock.calls[0][0]).toContain("/lists/sheets-1/items/5?$expand=fields($select=");
    expect(graphFetchAll).not.toHaveBeenCalled();
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("answers null for a sheet that no longer exists", async () => {
    graphFetch.mockRejectedValue(Object.assign(new Error("Graph 404"), { status: 404 }));
    await expect(getTestSheet(5)).resolves.toBeNull();
  });

  it("an edit's re-read is that same single read", async () => {
    await updateTestSheetFields(5, { Results: "Pass" });
    expect(graphFetchAll).not.toHaveBeenCalled();
    expect(listTasks).not.toHaveBeenCalled();
  });
});
