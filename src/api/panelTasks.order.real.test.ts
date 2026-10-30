import { beforeEach, describe, expect, it, vi } from "vitest";

// A standard task's link to its Panel Order, in real mode: PanelOrderRef is a
// SINGLE lookup, so both halves are selected, a bare id still maps, and the
// create writes a bare integer. An assignee that can't be resolved on the
// panel site refuses the create rather than raising a task missing them.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({ graphFetch, graphFetchAll }));
vi.mock("./panelProjects", () => ({ listPanelProjects: vi.fn().mockResolvedValue([]) }));
vi.mock("./panelOrders", () => ({ listPanelSiteUsers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("./siteUsers", () => ({
  ensureLookupIds: vi.fn(async (_u: string, p: unknown[]) => p),
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

import { createPanelTask, listPanelTasks } from "./panelTasks";

const ITEM = {
  id: "9",
  createdDateTime: "2026-10-29T00:00:00Z",
  lastModifiedDateTime: "2026-10-29T00:00:00Z",
  fields: { Title: "P-0001 — BOM Creation", PanelOrderRefLookupId: "12" },
};

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
});

describe("Panel Tasks: PanelOrderRef (real mode)", () => {
  it("selects both halves and maps a bare id", async () => {
    graphFetchAll.mockResolvedValue([ITEM]);
    const [task] = await listPanelTasks();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/PanelOrderRefLookupId,PanelOrderRef/);
    expect(task.orderRef).toEqual({ lookupId: 12, title: "" });
  });

  it("writes the order as a bare integer on create", async () => {
    graphFetch.mockResolvedValue(ITEM);
    await createPanelTask({ title: "P-0001 — BOM Creation", orderLookupId: 12 });
    const body = JSON.parse(graphFetch.mock.calls[0][1].body as string);
    expect(body.fields.PanelOrderRefLookupId).toBe(12);
    expect(body.fields).not.toHaveProperty("PanelOrderRefLookupId@odata.type");
  });

  it("leaves the order out when there isn't one", async () => {
    graphFetch.mockResolvedValue(ITEM);
    await createPanelTask({ title: "Loose task" });
    const body = JSON.parse(graphFetch.mock.calls[0][1].body as string);
    expect(body.fields).not.toHaveProperty("PanelOrderRefLookupId");
  });

  it("selects the chain, hold and SAP # columns and maps them", async () => {
    graphFetchAll.mockResolvedValue([
      { ...ITEM, fields: { ...ITEM.fields, ChainStep: 2, StatusBeforeHold: "In Progress", SAPNumber: "9200-0004-00" } },
    ]);
    const [task] = await listPanelTasks();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/ChainStep,StatusBeforeHold,SAPNumber/);
    expect(task).toMatchObject({ chainStep: 2, statusBeforeHold: "In Progress", sapNumber: "9200-0004-00" });
  });

  it("reads a blank StatusBeforeHold as not held", async () => {
    graphFetchAll.mockResolvedValue([{ ...ITEM, fields: { ...ITEM.fields, StatusBeforeHold: "" } }]);
    const [task] = await listPanelTasks();
    expect(task.statusBeforeHold).toBeNull();
    expect(task.chainStep).toBeNull();
  });

  it("writes the chain step and SAP # on create", async () => {
    graphFetch.mockResolvedValue(ITEM);
    await createPanelTask({ title: "P-0001 — BOM Creation", orderLookupId: 12, chainStep: 2, sapNumber: " 9200-0004-00 " });
    const body = JSON.parse(graphFetch.mock.calls[0][1].body as string);
    expect(body.fields.ChainStep).toBe(2);
    expect(body.fields.SAPNumber).toBe("9200-0004-00");
  });

  it("refuses the create when the assignee can't be resolved", async () => {
    await expect(
      createPanelTask({ title: "Drawing", assigned: [{ displayName: "Ana Ruiz", email: "ana@x.com" }] }),
    ).rejects.toThrow(/Couldn't find Ana Ruiz/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
