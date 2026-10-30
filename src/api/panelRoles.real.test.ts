import { beforeEach, describe, expect, it, vi } from "vitest";

// Panel User Roles in real mode: the OnCapacity column (Tim, 2026-10-30).
// This list decides who may open the panel planning tools, so a list that
// hasn't got the column yet must still read — once, without it — and the
// toggle then refuses to write rather than sending a 400.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({ graphFetch, graphFetchAll }));
vi.mock("./panelOrders", () => ({ listPanelSiteUsers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, panelTeam: "panel-site" },
    SP_PANEL_ROLES_LIST_ID: "roles-list",
  };
});

import {
  listPanelRoles,
  panelRolesOnCapacityAvailable,
  resetPanelRolesMockStore,
  updatePanelRole,
} from "./panelRoles";

const ROW = { id: "3", fields: { Title: "", UserLookupId: "7", Role: "Manager", OnCapacity: true } };

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resetPanelRolesMockStore();
});

describe("Panel User Roles: OnCapacity (real mode)", () => {
  it("selects and maps it", async () => {
    graphFetchAll.mockResolvedValue([ROW]);
    const [entry] = await listPanelRoles();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/\$select=Title,UserLookupId,User,Role,OnCapacity\)/);
    expect(entry.onCapacity).toBe(true);
  });

  it("reads the list without it when the column isn't there yet, and remembers", async () => {
    graphFetchAll
      .mockRejectedValueOnce(new Error("Graph 400 Bad Request"))
      .mockResolvedValue([{ ...ROW, fields: { ...ROW.fields, OnCapacity: undefined } }]);
    const [entry] = await listPanelRoles();
    expect(entry.onCapacity).toBe(false);
    expect(graphFetchAll.mock.calls[1][0]).not.toMatch(/OnCapacity/);
    expect(panelRolesOnCapacityAvailable()).toBe(false);

    await listPanelRoles();
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
    expect(graphFetchAll.mock.calls[2][0]).not.toMatch(/OnCapacity/);
    await expect(updatePanelRole({ id: 3, onCapacity: true })).rejects.toThrow(/setup-panel-planning/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("does not hide a failure that isn't the column", async () => {
    graphFetchAll.mockRejectedValue(new Error("Graph 503"));
    await expect(listPanelRoles()).rejects.toThrow(/503/);
  });

  it("writes the toggle as a boolean", async () => {
    graphFetch.mockResolvedValue({});
    await updatePanelRole({ id: 3, onCapacity: true });
    expect(JSON.parse(graphFetch.mock.calls[0][1].body as string)).toEqual({ OnCapacity: true });
  });
});
