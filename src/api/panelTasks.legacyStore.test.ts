import { afterEach, describe, expect, it, vi } from "vitest";

// Demo mode keeps Panel Tasks in localStorage. A store saved before several
// assignees (2026-10-29) holds `assigned` as one person or null; reading it
// as-is broke the Dashboard ("list.some is not a function"). It must come back
// as a list, and the other later fields as their defaults.

const KEY = "aets:mock-panel-tasks-store-v1";
const ANA = { displayName: "Ana Ruiz", email: "ana@example.com", lookupId: 7 };

function storedTask(id: number, assigned: unknown) {
  return {
    id,
    title: `Task ${id}`,
    status: "New",
    taskType: null,
    projectRef: null,
    assigned,
    description: "",
    watchers: [],
    comments: [],
    hasAttachments: false,
    createdAt: "2026-10-01T00:00:00Z",
    modifiedAt: "2026-10-01T00:00:00Z",
    author: null,
  };
}

afterEach(() => {
  window.localStorage.removeItem(KEY);
  vi.resetModules();
});

describe("the demo Panel Tasks store, saved by an older ARC", () => {
  it("reads a single assignee or none as a list", async () => {
    window.localStorage.setItem(KEY, JSON.stringify([storedTask(1, ANA), storedTask(2, null)]));
    vi.resetModules();
    const { listPanelTasks } = await import("./panelTasks");
    const tasks = await listPanelTasks();
    expect(tasks.find((t) => t.id === 1)?.assigned).toEqual([ANA]);
    expect(tasks.find((t) => t.id === 2)?.assigned).toEqual([]);
    expect(tasks.every((t) => t.orderRef === null && t.estimatedHours === null)).toBe(true);
  });

  it("keeps a list that's already a list", async () => {
    window.localStorage.setItem(KEY, JSON.stringify([storedTask(3, [ANA])]));
    vi.resetModules();
    const { listPanelTasks } = await import("./panelTasks");
    expect((await listPanelTasks())[0].assigned).toEqual([ANA]);
  });
});
