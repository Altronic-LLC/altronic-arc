import { beforeEach, describe, expect, it, vi } from "vitest";

// Panel Settings in real mode: unset = the defaults and a refused write; set =
// a setting's row is updated when it exists and added when it doesn't.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => ({ listId: undefined as string | undefined }));

vi.mock("./graph", () => ({ graphFetch, graphFetchAll }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, panelTeam: "panel-site" },
    get SP_PANEL_SETTINGS_LIST_ID() {
      return config.listId;
    },
  };
});

import { getPanelSettings, setPanelAmberPercent } from "./panelSettings";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetchAll.mockResolvedValue([]);
  config.listId = undefined;
});

describe("Panel Settings (real mode)", () => {
  it("uses the defaults, and refuses a change, while the list isn't set up", async () => {
    expect(await getPanelSettings()).toEqual({ amberPercent: 85 });
    await expect(setPanelAmberPercent(90)).rejects.toThrow(/setup-panel-planning\.ps1/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("reads the threshold from its row", async () => {
    config.listId = "settings";
    graphFetchAll.mockResolvedValue([{ id: "1", fields: { Title: "CapacityAmberPercent", Value: "90" } }]);
    expect(await getPanelSettings()).toEqual({ amberPercent: 90 });
  });

  it("updates the row that's there", async () => {
    config.listId = "settings";
    graphFetch.mockResolvedValueOnce({ value: [{ id: "4" }] }).mockResolvedValueOnce({});
    await setPanelAmberPercent(90);
    expect(graphFetch.mock.calls[0][0]).toContain("fields/Title eq 'CapacityAmberPercent'");
    expect(graphFetch.mock.calls[1][0]).toMatch(/items\/4\/fields$/);
    expect(JSON.parse(graphFetch.mock.calls[1][1].body)).toEqual({ Value: "90" });
  });

  it("adds the row when there isn't one", async () => {
    config.listId = "settings";
    graphFetch.mockResolvedValueOnce({ value: [] }).mockResolvedValueOnce({ id: "5" });
    await setPanelAmberPercent(75);
    expect(graphFetch.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(graphFetch.mock.calls[1][1].body)).toEqual({
      fields: { Title: "CapacityAmberPercent", Value: "75" },
    });
  });
});
