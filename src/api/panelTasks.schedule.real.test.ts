import { beforeEach, describe, expect, it, vi } from "vitest";

// The three schedule columns in real mode: selected on read, written as
// midday-UTC date-only values in ONE PATCH, and left out of a create when blank.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({ graphFetch, graphFetchAll }));
vi.mock("./panelProjects", () => ({ listPanelProjects: vi.fn().mockResolvedValue([]) }));
vi.mock("./panelOrders", () => ({ listPanelSiteUsers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("./siteUsers", () => ({
  ensureLookupIds: vi.fn(async (_u: string, p: unknown[]) => p),
  ensurePersonLookupId: vi.fn(async (_u: string, p: unknown) => p),
}));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, panelTeam: "panel-site" },
    SP_PANEL_TASKS_LIST_ID: "tasks-list",
  };
});

import { createPanelTask, listPanelTasks, setPanelTaskPlan, setPanelTaskSchedule } from "./panelTasks";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetchAll.mockResolvedValue([
    {
      id: "5",
      createdDateTime: "2026-10-01T00:00:00Z",
      lastModifiedDateTime: "2026-10-01T00:00:00Z",
      fields: {
        Title: "Draw",
        StartDate: "2026-11-02T12:00:00Z",
        DueDate: "2026-11-06T12:00:00Z",
        EstimatedHours: "16.5",
      },
    },
  ]);
});

describe("panel task schedule columns (real mode)", () => {
  it("selects and maps StartDate, DueDate and EstimatedHours", async () => {
    const [task] = await listPanelTasks();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/StartDate,DueDate,EstimatedHours/);
    expect(task.startDate?.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(task.dueDate?.toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(task.estimatedHours).toBe(16.5);
  });

  it("writes the schedule in one PATCH, date-only at midday UTC, null to clear", async () => {
    graphFetch.mockResolvedValue({});
    await setPanelTaskSchedule(5, {
      startDate: new Date("2026-11-02T05:00:00Z"),
      dueDate: null,
      estimatedHours: 8,
    });
    const patches = graphFetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0][1].body)).toEqual({
      StartDate: "2026-11-02T12:00:00Z",
      DueDate: null,
      EstimatedHours: 8,
    });
  });

  it("leaves blank schedule fields out of a create", async () => {
    graphFetch.mockResolvedValue({
      id: "6",
      createdDateTime: "2026-10-01T00:00:00Z",
      lastModifiedDateTime: "2026-10-01T00:00:00Z",
      fields: { Title: "New" },
    });
    await createPanelTask({ title: "New", startDate: null, estimatedHours: null });
    const body = JSON.parse(graphFetch.mock.calls[0][1].body);
    expect(body.fields).not.toHaveProperty("StartDate");
    expect(body.fields).not.toHaveProperty("DueDate");
    expect(body.fields).not.toHaveProperty("EstimatedHours");
  });

  it("saves a Capacity plan in ONE PATCH: assignees in the multi-person shape, them watching, and the dates", async () => {
    graphFetch.mockResolvedValue({});
    await setPanelTaskPlan(5, {
      assigned: [
        { displayName: "Eric", email: "eric@example.com", lookupId: 65 },
        { displayName: "Ana", email: "ana@example.com", lookupId: 71 },
      ],
      startDate: new Date("2026-11-04T12:00:00Z"),
      dueDate: new Date("2026-11-05T12:00:00Z"),
    });
    const patches = graphFetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0][1].body)).toEqual({
      StartDate: "2026-11-04T12:00:00Z",
      DueDate: "2026-11-05T12:00:00Z",
      "AssignedLookupId@odata.type": "Collection(Edm.Int32)",
      AssignedLookupId: [65, 71],
      "WatchersLookupId@odata.type": "Collection(Edm.Int32)",
      WatchersLookupId: expect.arrayContaining([65, 71]),
    });
  });

  it("refuses a plan whose assignee can't be resolved on the panel site, writing nothing", async () => {
    await expect(
      setPanelTaskPlan(5, { assigned: [{ displayName: "Nobody", email: "nobody@example.com" }] }),
    ).rejects.toThrow(/Couldn't find Nobody/);
    expect(graphFetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });
});
