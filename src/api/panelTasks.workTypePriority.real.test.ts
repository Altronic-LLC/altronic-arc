import { beforeEach, describe, expect, it, vi } from "vitest";

// Work Type and Priority (the Wrike custom fields) in real mode: selected,
// read (an unknown value reads as not set), written on create, and left out
// of a create when blank.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({ graphFetch, graphFetchAll }));
vi.mock("./panelProjects", () => ({ listPanelProjects: vi.fn().mockResolvedValue([]) }));
vi.mock("./panelOrders", () => ({ listPanelSiteUsers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("./siteUsers", () => ({ ensureLookupIds: vi.fn(async (_u: string, p: unknown[]) => p) }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SITES: { ...actual.SITES, panelTeam: "panel-site" }, SP_PANEL_TASKS_LIST_ID: "tasks-list" };
});

import { createPanelTask, listPanelTasks } from "./panelTasks";

const item = (id: string, fields: Record<string, unknown>) => ({
  id,
  createdDateTime: "2026-10-29T00:00:00Z",
  lastModifiedDateTime: "2026-10-29T00:00:00Z",
  fields: { Title: "T", ...fields },
});

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
});

describe("Panel Tasks: Work Type and Priority (real mode)", () => {
  it("selects and reads both, an unknown value as not set", async () => {
    graphFetchAll.mockResolvedValue([
      item("1", { WorkType: "Production Order", Priority: "High" }),
      item("2", { WorkType: "Something else", Priority: "Urgent" }),
    ]);
    const [a, b] = await listPanelTasks();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/WorkType,Priority/);
    expect([a.workType, a.priority]).toEqual(["Production Order", "High"]);
    expect([b.workType, b.priority]).toEqual([null, null]);
  });

  it("writes both on create, and leaves them out when blank", async () => {
    graphFetch.mockResolvedValue(item("3", {}));
    await createPanelTask({ title: "A", workType: "Non-Production", priority: "Low" });
    expect(JSON.parse(graphFetch.mock.calls[0][1].body).fields).toMatchObject({
      WorkType: "Non-Production",
      Priority: "Low",
    });
    await createPanelTask({ title: "B" });
    const fields = JSON.parse(graphFetch.mock.calls[1][1].body).fields;
    expect(fields).not.toHaveProperty("WorkType");
    expect(fields).not.toHaveProperty("Priority");
  });
});
