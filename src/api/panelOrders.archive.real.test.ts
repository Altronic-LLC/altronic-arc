import { beforeEach, describe, expect, it, vi } from "vitest";

// Panel Order Headers in REAL mode — the archive columns that
// scripts/move-panel-orders-to-arc.ps1 adds. Invisible from the mock branch:
//  - a read asks for Archived / LegacySource / LegacyCreated, and a 400 (the
//    script hasn't run yet) retries once without them and remembers;
//  - anything other than a 400 propagates rather than retrying;
//  - one order is read on its own, never by downloading the whole list.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graph")>();
  return { ...actual, graphFetch, graphFetchAll };
});
vi.mock("./panelProjects", () => ({ listPanelProjects: vi.fn().mockResolvedValue([]) }));
vi.mock("./sharepoint", () => ({ spFetch: vi.fn().mockResolvedValue({ value: [] }) }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, panelTeam: "panel-site" },
    SP_PANEL_ORDERS_LIST_ID: "orders-list",
  };
});

import { GraphError } from "./graph";
import { __resetPanelOrderArchiveColumns, getPanelOrder, listPanelOrders } from "./panelOrders";

const ITEM = {
  id: "7",
  createdDateTime: "2026-11-13T15:00:00Z",
  lastModifiedDateTime: "2026-11-13T15:00:00Z",
  fields: {
    Title: "5900C-013 / 9100-0101-00",
    Status: "Shipped",
    Archived: true,
    LegacySource: "PanelJobDashboard#101",
    LegacyCreated: "2023-08-14T14:00:00Z",
  },
};

const badRequest = () => new GraphError(400, "Bad Request", "{}", "https://graph/items");

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetPanelOrderArchiveColumns();
});

describe("listPanelOrders", () => {
  it("asks for the archive columns and maps them", async () => {
    graphFetchAll.mockResolvedValue([ITEM]);
    const [o] = await listPanelOrders();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/Archived,LegacySource,LegacyCreated/);
    expect(o.archived).toBe(true);
    expect(o.legacySource).toBe("PanelJobDashboard#101");
    expect(o.legacyCreatedAt?.toISOString()).toBe("2023-08-14T14:00:00.000Z");
  });

  it("retries without them on a 400, and doesn't ask again", async () => {
    graphFetchAll
      .mockRejectedValueOnce(badRequest())
      .mockResolvedValue([{ ...ITEM, fields: { Title: "Order", Status: "Submitted" } }]);
    const [o] = await listPanelOrders();
    expect(graphFetchAll.mock.calls[1][0]).not.toMatch(/Archived/);
    expect(o.archived).toBe(false);
    expect(o.legacySource).toBe("");
    expect(o.legacyCreatedAt).toBeNull();

    await listPanelOrders();
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
    expect(graphFetchAll.mock.calls[2][0]).not.toMatch(/Archived/);
  });

  it("doesn't retry anything but a 400", async () => {
    graphFetchAll.mockRejectedValue(new GraphError(503, "Service Unavailable", "{}", "u"));
    await expect(listPanelOrders()).rejects.toThrow(/503/);
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
  });
});

describe("getPanelOrder", () => {
  it("reads the one item, not the whole list", async () => {
    graphFetch.mockResolvedValue(ITEM);
    const o = await getPanelOrder(7);
    expect(graphFetchAll).not.toHaveBeenCalled();
    expect(graphFetch.mock.calls[0][0]).toContain("/sites/panel-site/lists/orders-list/items/7?");
    expect(o?.archived).toBe(true);
  });

  it("is null on a 404 and throws on anything else", async () => {
    graphFetch.mockRejectedValueOnce(new GraphError(404, "Not Found", "{}", "u"));
    expect(await getPanelOrder(7)).toBeNull();
    graphFetch.mockRejectedValueOnce(new GraphError(403, "Forbidden", "{}", "u"));
    await expect(getPanelOrder(7)).rejects.toThrow(/403/);
  });
});
