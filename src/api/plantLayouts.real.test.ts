import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Plant Map in REAL mode — the request shapes, which the mock-mode tests can't
// see: the drive is looked up from the LIBRARY's list id, the walls file is
// read through its pre-authenticated download link (no token), a new layout
// uploads the file FIRST and points the row at it, and a save re-reads the row
// and refuses one that isn't a Draft.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const uploadToDriveTarget = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {
    constructor(public status: number) {
      super(`Graph ${status}`);
    }
  },
}));

vi.mock("./projectFiles", () => ({ uploadToDriveTarget }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_PLANT_LAYOUTS_LIST_ID: "layouts-list",
    SP_PLANT_LAYOUT_FILES_LIST_ID: "files-lib",
    SP_LAYOUT_COMPONENTS_LIST_ID: "components-list",
  };
});

import { GraphError } from "./graph";
import {
  LayoutNotDraftError,
  copyLayoutToDraft,
  createPlantLayout,
  getPlantLayout,
  listPlantLayouts,
  publishPlantLayout,
  savePlantLayoutDraft,
} from "./plantLayouts";
import { __resetPlantLayoutFilesForTests, readWallsFile, wallsFileName } from "./plantLayoutFiles";
import { listLayoutComponents } from "./layoutComponents";
import { serializeLayoutDoc } from "@/lib/plantLayoutDoc";

const DOC = { schema: 1 as const, units: "in" as const, extent: { w: 100, h: 50 }, items: [], areas: [] };

function row(id: string, fields: Record<string, unknown>) {
  return {
    id,
    fields,
    createdDateTime: "2026-11-01T00:00:00Z",
    lastModifiedDateTime: "2026-11-02T00:00:00Z",
    lastModifiedBy: { user: { displayName: "Morgan Example" } },
  };
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  uploadToDriveTarget.mockReset();
  __resetPlantLayoutFilesForTests();
  vi.unstubAllGlobals();
});

describe("listPlantLayouts / getPlantLayout", () => {
  it("reads the list on the PMO site and maps a row", async () => {
    graphFetchAll.mockResolvedValue([
      row("4", { Title: "Main", Area: "Floor", LayoutKey: "main-x", Status: "Published", Version: 3, WallsFile: "F1", LayoutJson: serializeLayoutDoc(DOC), SupersedesId: 2 }),
    ]);
    const [layout] = await listPlantLayouts();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/\/lists\/layouts-list\/items\?.*\$expand=fields\(\$select=Title,Building,Area,LayoutKey,Status,Version,WallsFile,LayoutJson,SupersedesId\)/);
    expect(layout).toMatchObject({ id: 4, status: "Published", version: 3, wallsFileId: "F1", supersedesId: 2, docCorrupt: false, modifiedBy: "Morgan Example" });
    // No Building on the row (one saved before the column) reads its title.
    expect(layout.building).toBe("Main");
    expect(layout.doc.extent).toEqual({ w: 100, h: 50 });
  });

  it("marks an unreadable LayoutJson as corrupt rather than empty", async () => {
    graphFetchAll.mockResolvedValue([row("5", { Title: "Bad", Status: "Draft", LayoutJson: "{oops" })]);
    const [layout] = await listPlantLayouts();
    expect(layout.docCorrupt).toBe(true);
  });

  it("answers null only for a 404", async () => {
    graphFetch.mockRejectedValueOnce(new (GraphError as unknown as new (s: number) => Error)(404));
    expect(await getPlantLayout(9)).toBeNull();
    graphFetch.mockRejectedValueOnce(new (GraphError as unknown as new (s: number) => Error)(503));
    await expect(getPlantLayout(9)).rejects.toThrow("Graph 503");
  });
});

describe("the walls drawing", () => {
  it("looks the drive up from the library once, then reads through the download link WITHOUT a token", async () => {
    graphFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/lists/files-lib/drive?$select=id")) return { id: "DRIVE" };
      return { id: "F1", "@microsoft.graph.downloadUrl": "https://download.example/f1" };
    });
    const fetchSpy = vi.fn(async () => new Response("<svg/>", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await readWallsFile("F1")).toBe("<svg/>");
    await readWallsFile("F1");
    const driveLookups = graphFetch.mock.calls.filter(([p]) => String(p).includes("/drive?"));
    expect(driveLookups).toHaveLength(1);
    expect(graphFetch.mock.calls.some(([p]) => p === "/drives/DRIVE/items/F1?$select=id,@microsoft.graph.downloadUrl")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://download.example/f1");
  });

  it("names the file SharePoint will take", () => {
    expect(wallsFileName('Main: "Plant"?.SVG')).toBe("Main- -Plant-.svg");
    expect(wallsFileName(".svg")).toBe("walls.svg");
  });
});

describe("createPlantLayout", () => {
  it("uploads the drawing to walls/ (never overwriting), then creates a Draft pointing at it", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("/drive?")) return { id: "DRIVE" };
      if (init?.method === "POST") return row("12", JSON.parse(String(init.body)).fields);
      throw new Error(`unexpected ${path}`);
    });
    uploadToDriveTarget.mockResolvedValue({ id: "NEWFILE", name: "Main.svg", webUrl: "" });
    const created = await createPlantLayout({
      building: " Building 2 ",
      title: " Main ",
      area: "Floor",
      walls: { kind: "upload", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"/>', fileName: "Main.svg" },
      extent: { w: 100, h: 50 },
    });
    expect(uploadToDriveTarget.mock.calls[0][0]).toBe("/drives/DRIVE/root:/walls/Main.svg:");
    expect(uploadToDriveTarget.mock.calls[0][2]).toEqual({ conflict: "rename" });
    const post = graphFetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/sites/" + post[0].split("/")[2] + "/lists/layouts-list/items");
    const fields = JSON.parse(String(post[1].body)).fields;
    expect(fields).toMatchObject({ Title: "Main", Building: "Building 2", Area: "Floor", Status: "Draft", Version: 1, WallsFile: "NEWFILE" });
    expect(JSON.parse(fields.LayoutJson)).toEqual({ schema: 1, units: "in", extent: { w: 100, h: 50 }, items: [], areas: [] });
    expect(fields.LayoutKey).toMatch(/^main-/);
    expect(created).toMatchObject({ id: 12, status: "Draft", wallsFileId: "NEWFILE" });
  });

  it("reuses an existing building's drawing — nothing uploaded — and starts with the areas it's given", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return row("13", JSON.parse(String(init.body)).fields);
      throw new Error(`unexpected ${path}`);
    });
    const area = { uid: "a_1", kind: "aisle" as const, x: 50, y: 25, w: 100, d: 10, rot: 0, label: "Main aisle", locked: false };
    const created = await createPlantLayout({
      building: "Main",
      title: "Main — option B",
      area: "",
      walls: { kind: "existing", fileId: "OLDFILE" },
      extent: { w: 100, h: 50 },
      areas: [area],
    });
    expect(uploadToDriveTarget).not.toHaveBeenCalled();
    expect(graphFetch.mock.calls.some(([p]) => String(p).includes("/drive"))).toBe(false);
    const fields = JSON.parse(String(graphFetch.mock.calls[0][1]!.body)).fields;
    expect(fields.WallsFile).toBe("OLDFILE");
    expect(JSON.parse(fields.LayoutJson).areas).toEqual([area]);
    expect(created.wallsFileId).toBe("OLDFILE");
  });

  it("says the file was kept when the row is refused", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("/drive?")) return { id: "DRIVE" };
      if (init?.method === "POST") throw new Error("Graph 403 Forbidden");
      return {};
    });
    uploadToDriveTarget.mockResolvedValue({ id: "NEWFILE", name: "Main 1.svg", webUrl: "" });
    await expect(
      createPlantLayout({
        building: "Main",
        title: "Main",
        area: "",
        walls: { kind: "upload", svg: "<svg/>", fileName: "Main.svg" },
        extent: { w: 1, h: 1 },
      }),
    ).rejects.toThrow(/saved as "Main 1\.svg".*couldn't be created.*403/);
  });
});

describe("savePlantLayoutDraft", () => {
  it("re-reads the row and refuses one that has been published", async () => {
    graphFetch.mockResolvedValueOnce(row("4", { Title: "Main", Status: "Published", LayoutJson: serializeLayoutDoc(DOC) }));
    await expect(savePlantLayoutDraft(4, DOC)).rejects.toBeInstanceOf(LayoutNotDraftError);
    expect(graphFetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("never writes over a layout it couldn't read", async () => {
    graphFetch.mockResolvedValueOnce(row("4", { Title: "Main", Status: "Draft", LayoutJson: "{oops" }));
    await expect(savePlantLayoutDraft(4, DOC)).rejects.toThrow(/won't write over it/);
    expect(graphFetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("PATCHes only LayoutJson on a Draft", async () => {
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) =>
      init?.method === "PATCH" ? {} : row("4", { Title: "Main", Status: "Draft", LayoutJson: serializeLayoutDoc(DOC) }),
    );
    await savePlantLayoutDraft(4, DOC);
    const patch = graphFetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toMatch(/\/lists\/layouts-list\/items\/4\/fields$/);
    expect(Object.keys(JSON.parse(String(patch[1].body)))).toEqual(["LayoutJson"]);
  });
});

describe("listLayoutComponents", () => {
  it("reads the symbol library, treating missing flags safely", async () => {
    graphFetchAll.mockResolvedValue([
      row("3", { Title: "Desk", ComponentKey: "desk", FootprintW: "60", FootprintD: 30, SvgMarkup: "<svg/>" }),
    ]);
    const [c] = await listLayoutComponents();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/\/lists\/components-list\/items\?\$expand=fields\(\$select=Title,ComponentKey,/);
    expect(c).toMatchObject({ id: 3, key: "desk", footprintW: 60, footprintD: 30, collides: true, active: true, category: "Other" });
  });
});

describe("copyLayoutToDraft", () => {
  const published = row("4", {
    Title: "Main", Area: "Floor", LayoutKey: "main-x", Status: "Published", Version: 3, WallsFile: "F1",
    LayoutJson: serializeLayoutDoc(DOC),
  });

  it("creates the next version as a Draft, same walls and items, pointing back at the original", async () => {
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) =>
      init?.method === "POST" ? row("9", JSON.parse(String(init.body)).fields) : published,
    );
    graphFetchAll.mockResolvedValue([published, row("2", { Title: "Main", LayoutKey: "main-x", Status: "Superseded", Version: 2 })]);
    const { layout, existing } = await copyLayoutToDraft(4);
    expect(existing).toBe(false);
    const fields = JSON.parse(String(graphFetch.mock.calls.find(([, i]) => i?.method === "POST")![1].body)).fields;
    expect(fields).toMatchObject({ Title: "Main", LayoutKey: "main-x", Status: "Draft", Version: 4, WallsFile: "F1", SupersedesId: 4 });
    expect(JSON.parse(fields.LayoutJson)).toEqual(DOC);
    expect(layout).toMatchObject({ id: 9, status: "Draft", version: 4 });
  });

  it("hands back the draft that already exists instead of making a second", async () => {
    graphFetch.mockResolvedValue(published);
    graphFetchAll.mockResolvedValue([published, row("7", { Title: "Main", LayoutKey: "main-x", Status: "Draft", Version: 4 })]);
    const { layout, existing } = await copyLayoutToDraft(4);
    expect(existing).toBe(true);
    expect(layout.id).toBe(7);
    expect(graphFetch.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
  });
});

describe("publishPlantLayout", () => {
  const draft = row("9", {
    Title: "Main", LayoutKey: "main-x", Status: "Draft", Version: 4, WallsFile: "F1", LayoutJson: serializeLayoutDoc(DOC),
  });
  const live = row("4", { Title: "Main", LayoutKey: "main-x", Status: "Published", Version: 3, WallsFile: "F1" });
  const older = row("2", { Title: "Main", LayoutKey: "main-x", Status: "Superseded", Version: 2, WallsFile: "F1" });
  const patches = () =>
    graphFetch.mock.calls
      .filter(([, i]) => i?.method === "PATCH")
      .map(([path, i]) => [String(path).split("/items/")[1], JSON.parse(String(i!.body))]);

  it("publishes the draft FIRST, then supersedes the version that was published — and nothing else", async () => {
    graphFetch.mockImplementation(async () => draft);
    graphFetchAll.mockResolvedValue([draft, live, older]);
    const result = await publishPlantLayout(9);
    expect(patches()).toEqual([
      ["9/fields", { Status: "Published" }],
      ["4/fields", { Status: "Superseded" }],
    ]);
    expect(result.superseded.map((l) => l.id)).toEqual([4]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps the new version published when an old one can't be superseded, and says which", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && String(path).includes("/items/4/")) throw new Error("Graph 403 Forbidden");
      return draft;
    });
    graphFetchAll.mockResolvedValue([draft, live]);
    const result = await publishPlantLayout(9);
    expect(result.superseded).toEqual([]);
    expect(result.warnings).toEqual([expect.stringMatching(/v3 is still marked Published — set it to Superseded.*403/)]);
  });

  it("refuses anything but a readable Draft, writing nothing", async () => {
    graphFetch.mockResolvedValue(live);
    await expect(publishPlantLayout(4)).rejects.toThrow("This layout is already Published.");
    graphFetch.mockResolvedValue(row("9", { ...draft.fields, LayoutJson: "{not json" }));
    await expect(publishPlantLayout(9)).rejects.toThrow(/couldn't be read/);
    expect(patches()).toEqual([]);
  });
});
