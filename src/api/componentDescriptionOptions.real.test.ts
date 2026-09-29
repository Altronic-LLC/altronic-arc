import { beforeEach, describe, expect, it, vi } from "vitest";

// Component Description Options in REAL mode: the request shapes, and what an
// unset list id does. None of this is visible from mock mode.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => ({ listId: "options-list" as string | undefined }));

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
    SITES: { ...actual.SITES, engineering: "engineering-site" },
    get SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID() {
      return config.listId;
    },
  };
});

import {
  createComponentDescriptionOption,
  deleteComponentDescriptionOption,
  listComponentDescriptionOptions,
  updateComponentDescriptionOption,
} from "./componentDescriptionOptions";

const BASE = "/sites/engineering-site/lists/options-list/items";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  config.listId = "options-list";
});

describe("Component Description Options (real mode)", () => {
  it("reads Kind, Types one per line and SortOrder", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { Title: "Capacitor", Kind: "Description", Types: "Ceramic\nTantalum", SortOrder: 20 } },
      { id: "2", fields: { Title: "SIL CAT 1", Kind: "SIL Category", Types: "stray", SortOrder: 10 } },
      { id: "3", fields: { Title: "", Kind: "Description" } },
    ]);
    const rows = await listComponentDescriptionOptions();
    expect(graphFetchAll.mock.calls[0][0]).toBe(`${BASE}?$expand=fields($select=Title,Kind,Types,SortOrder)&$top=500`);
    expect(rows).toEqual([
      { id: 1, kind: "Description", name: "Capacitor", types: ["Ceramic", "Tantalum"], sortOrder: 20 },
      // A SIL category never carries types, whatever the column holds.
      { id: 2, kind: "SIL Category", name: "SIL CAT 1", types: [], sortOrder: 10 },
    ]);
  });

  it("creates a row with every column, the name cleaned", async () => {
    graphFetch.mockResolvedValue({ id: "9", fields: { Title: "SIL CAT 3", Kind: "SIL Category", SortOrder: 30 } });
    await createComponentDescriptionOption({ kind: "SIL Category", name: " SIL CAT 3 - ", types: [], sortOrder: 30 });
    expect(graphFetch).toHaveBeenCalledWith(BASE, {
      method: "POST",
      body: JSON.stringify({ fields: { Title: "SIL CAT 3", Kind: "SIL Category", Types: "", SortOrder: 30 } }),
    });
  });

  it("patches only what changed, then reads the row back", async () => {
    graphFetch
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "1", fields: { Title: "Capacitor", Kind: "Description", Types: "Ceramic\nFilm", SortOrder: 20 } });
    const row = await updateComponentDescriptionOption({ id: 1, types: ["Ceramic", "Film"] });
    expect(graphFetch.mock.calls[0]).toEqual([
      `${BASE}/1/fields`,
      { method: "PATCH", body: JSON.stringify({ Types: "Ceramic\nFilm" }) },
    ]);
    expect(row.types).toEqual(["Ceramic", "Film"]);
  });

  it("deletes the row", async () => {
    graphFetch.mockResolvedValue(undefined);
    await deleteComponentDescriptionOption(4);
    expect(graphFetch).toHaveBeenCalledWith(`${BASE}/4`, { method: "DELETE" });
  });

  it("reads nothing and refuses every write while the list id is unset", async () => {
    config.listId = undefined;
    expect(await listComponentDescriptionOptions()).toEqual([]);
    await expect(
      createComponentDescriptionOption({ kind: "Description", name: "Fuse", types: [], sortOrder: 10 }),
    ).rejects.toThrow(/isn't configured/);
    await expect(updateComponentDescriptionOption({ id: 1, name: "X" })).rejects.toThrow(/isn't configured/);
    await expect(deleteComponentDescriptionOption(1)).rejects.toThrow(/isn't configured/);
    expect(graphFetch).not.toHaveBeenCalled();
    expect(graphFetchAll).not.toHaveBeenCalled();
  });
});
