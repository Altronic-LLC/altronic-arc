import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The Power BI files in REAL mode — invisible from the mock branch: they go to
// published/ in the Plant Layout Files drive (looked up from the library's
// list id), REPLACE a file of the same name (ARC owns these), and a name with
// no file is simply absent rather than an error.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const uploadToDriveTarget = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  GraphError: class GraphError extends Error {
    constructor(public status: number) {
      super(`Graph ${status}`);
    }
  },
}));
vi.mock("./projectFiles", () => ({ uploadToDriveTarget }));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
  SP_PLANT_LAYOUT_FILES_LIST_ID: "files-lib",
}));

import { GraphError } from "./graph";
import {
  __resetPlantLayoutFilesForTests,
  findPublishedFiles,
  readPublishedFile,
  writePublishedFile,
} from "./plantLayoutFiles";

beforeEach(() => {
  __resetPlantLayoutFilesForTests();
  graphFetch.mockReset();
  uploadToDriveTarget.mockReset();
  vi.unstubAllGlobals();
});

describe("writePublishedFile", () => {
  it("puts the file in published/ of the library's drive, replacing one of the same name", async () => {
    graphFetch.mockResolvedValueOnce({ id: "drive-1" });
    uploadToDriveTarget.mockResolvedValue({
      id: "f1",
      name: "plant-v2.svg",
      webUrl: "https://sp/plant-v2.svg",
      size: 10,
      lastModifiedDateTime: "2026-11-13T10:00:00Z",
    });
    const out = await writePublishedFile("plant-v2.svg", "<svg/>", "image/svg+xml");
    expect(graphFetch).toHaveBeenCalledWith(expect.stringContaining("/lists/files-lib/drive"));
    const [target, file, opts] = uploadToDriveTarget.mock.calls[0];
    expect(target).toBe("/drives/drive-1/root:/published/plant-v2.svg:");
    expect(file.name).toBe("plant-v2.svg");
    expect(opts).toEqual({ conflict: "replace" });
    expect(out).toMatchObject({ name: "plant-v2.svg", webUrl: "https://sp/plant-v2.svg", size: 10 });
  });
});

describe("findPublishedFiles", () => {
  it("returns the files that exist and leaves out a 404", async () => {
    graphFetch.mockImplementation(async (url: string) => {
      if (url.includes("/lists/files-lib/drive")) return { id: "drive-1" };
      if (url.includes("plant-v2.svg")) return { id: "f1", name: "plant-v2.svg", webUrl: "https://sp/a", size: 5 };
      throw new (GraphError as unknown as new (s: number) => Error)(404);
    });
    const out = await findPublishedFiles(["plant-v2.svg", "plant-v2-tags.csv"]);
    expect(Object.keys(out)).toEqual(["plant-v2.svg"]);
    expect(graphFetch).toHaveBeenCalledWith(expect.stringContaining("/drives/drive-1/root:/published/plant-v2-tags.csv:"));
  });

  it("throws anything but a 404 — 'couldn't look' never reads as 'not there'", async () => {
    graphFetch.mockImplementation(async (url: string) => {
      if (url.includes("/lists/files-lib/drive")) return { id: "drive-1" };
      throw new (GraphError as unknown as new (s: number) => Error)(403);
    });
    await expect(findPublishedFiles(["plant-v2.svg"])).rejects.toThrow("Graph 403");
  });
});

describe("readPublishedFile", () => {
  it("reads the bytes through the pre-authenticated download link, without our token", async () => {
    graphFetch.mockImplementation(async (url: string) =>
      url.includes("/lists/") ? { id: "drive-1" } : { "@microsoft.graph.downloadUrl": "https://download/x" },
    );
    const fetchMock = vi.fn(async () => new Response("a,b\r\n"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readPublishedFile("plant-tags.csv")).resolves.toBe("a,b\r\n");
    expect(fetchMock).toHaveBeenCalledWith("https://download/x");
  });
});
