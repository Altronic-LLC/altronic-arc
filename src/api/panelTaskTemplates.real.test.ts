import { beforeEach, describe, expect, it, vi } from "vitest";

// Panel Task Templates in real mode: an unset list raises the built-in four
// and refuses writes (naming the script); a set list reads and writes the
// five columns by their internal names.

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
    get SP_PANEL_TASK_TEMPLATES_LIST_ID() {
      return config.listId;
    },
  };
});

import {
  createPanelTaskTemplate,
  listPanelTaskTemplates,
  panelTaskTemplateFields,
  toPanelTaskTemplate,
} from "./panelTaskTemplates";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  config.listId = undefined;
});

const INPUT = { title: " Wiring ", taskType: "BOM" as const, estimatedHours: 3, sortOrder: 5, active: true };

describe("Panel Task Templates (real mode)", () => {
  it("raises the built-in four while the list isn't set up", async () => {
    const rows = await listPanelTaskTemplates();
    expect(rows.map((r) => r.title)).toEqual(["Drawing Creation", "BOM Creation", "SOO Creation", "Programming"]);
    expect(graphFetchAll).not.toHaveBeenCalled();
  });

  it("refuses a write while the list isn't set up, naming the script", async () => {
    await expect(createPanelTaskTemplate(INPUT)).rejects.toThrow(/setup-panel-planning.ps1/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("reads the list in SortOrder", async () => {
    config.listId = "templates";
    graphFetchAll.mockResolvedValue([
      { id: "2", fields: { Title: "B", SortOrder: 2, Active: true } },
      { id: "1", fields: { Title: "A", SortOrder: 1, EstimatedHours: "4.5", TaskType: "SOO" } },
    ]);
    const rows = await listPanelTaskTemplates();
    expect(graphFetchAll.mock.calls[0][0]).toContain("Title,TaskType,EstimatedHours,SortOrder,Active");
    expect(rows.map((r) => r.title)).toEqual(["A", "B"]);
    expect(rows[0]).toMatchObject({ estimatedHours: 4.5, taskType: "SOO", active: true });
  });

  it("writes the five columns, title trimmed", async () => {
    config.listId = "templates";
    graphFetch.mockResolvedValue({ id: "9", fields: { Title: "Wiring" } });
    await createPanelTaskTemplate(INPUT);
    expect(JSON.parse(graphFetch.mock.calls[0][1].body as string).fields).toEqual({
      Title: "Wiring",
      TaskType: "BOM",
      EstimatedHours: 3,
      SortOrder: 5,
      Active: true,
    });
    expect(panelTaskTemplateFields({ ...INPUT, taskType: null, estimatedHours: null })).toMatchObject({
      TaskType: null,
      EstimatedHours: null,
    });
  });

  it("reads a blank Active as active and an unknown type as none", () => {
    expect(toPanelTaskTemplate({ id: "1", fields: { Title: "X", TaskType: "Welding" } } as never)).toMatchObject({
      active: true,
      taskType: null,
    });
    expect(toPanelTaskTemplate({ id: "1", fields: { Title: "X", Active: false } } as never).active).toBe(false);
  });
});
