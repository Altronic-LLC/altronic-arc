import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Application Photos (BusinessIT#48) at the REQUEST level, USE_MOCK forced off.
// The library's root is a FOLDER two levels into the ALTRONICSALESTEAM drive
// (`General/A-Application Photos`), so the shapes that matter are the
// path-addressed root, the upload target and the breadcrumb starting there.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const uploadToDriveTarget = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      public body: string,
      public url: string,
    ) {
      super(`Graph ${status} ${statusText} at ${url}: ${body}`);
    }
  }
  return { graphFetch, graphFetchAll, GraphError };
});

vi.mock("./projectFiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./projectFiles")>();
  return { ...actual, uploadToDriveTarget };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

import { GraphError } from "./graph";
import { SITES } from "./config";
import {
  APPLICATION_PHOTOS_FOLDER_URL,
  createApplicationPhotosFolder,
  deleteApplicationPhoto,
  getApplicationPhotosPath,
  listApplicationPhotos,
  uploadApplicationPhoto,
} from "./applicationPhotos";

const DRIVE = `/sites/${SITES.salesTeam}/drive`;
const ROOT = `${DRIVE}/root:/General/A-Application%20Photos:`;

// A BLOCK body — a returned mock would run as the test's cleanup.
beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  uploadToDriveTarget.mockReset();
  graphFetchAll.mockResolvedValue([]);
});

describe("Application Photos (real mode)", () => {
  it("points at the ALTRONICSALESTEAM site's folder", () => {
    expect(APPLICATION_PHOTOS_FOLDER_URL).toMatch(/\/sites\/ALTRONICSALESTEAM\/Shared%20Documents\/General\/A-Application%20Photos$/);
  });

  it("lists the root by PATH, and a subfolder by id", async () => {
    await listApplicationPhotos();
    expect(graphFetchAll.mock.calls[0][0].startsWith(`${ROOT}/children?`)).toBe(true);
    await listApplicationPhotos("01ABC");
    expect(graphFetchAll.mock.calls[1][0].startsWith(`${DRIVE}/items/01ABC/children?`)).toBe(true);
  });

  it("creates a folder at the root with conflictBehavior fail", async () => {
    graphFetch.mockResolvedValue({ id: "n1", name: "Compression", webUrl: "u", folder: {} });
    await createApplicationPhotosFolder(null, "Compression");
    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toBe(`${ROOT}/children`);
    expect(JSON.parse(init.body)).toMatchObject({ name: "Compression", "@microsoft.graph.conflictBehavior": "fail" });
  });

  it("uploads a photo to the root by path and to a subfolder by id, renaming a clash — never overwriting", async () => {
    uploadToDriveTarget.mockResolvedValue({ id: "f", name: "Photo.jpg", webUrl: "u", file: {} });
    const photo = new File(["x"], "Photo 2026-10-19 14-52-03.jpg", { type: "image/jpeg" });
    await uploadApplicationPhoto(null, photo);
    expect(uploadToDriveTarget.mock.calls[0][0]).toBe(`${ROOT}/Photo%202026-10-19%2014-52-03.jpg:`);
    expect(uploadToDriveTarget.mock.calls[0][2]).toMatchObject({ conflict: "rename" });
    await uploadApplicationPhoto("01ABC", photo);
    expect(uploadToDriveTarget.mock.calls[1][0]).toBe(`${DRIVE}/items/01ABC:/Photo%202026-10-19%2014-52-03.jpg:`);
  });

  it("starts the breadcrumb at the photo folder — nothing above it is shown", async () => {
    graphFetch.mockImplementation(async (url: string) => {
      if (url.includes("/items/")) {
        return {
          id: "sub",
          name: "2026",
          webUrl: "w2026",
          parentReference: { path: "/drives/b!x/root:/General/A-Application Photos/Compression" },
        };
      }
      return { id: "cmp", name: "Compression", webUrl: "wcmp" };
    });
    const crumbs = await getApplicationPhotosPath("sub");
    expect(crumbs.map((c) => c.name)).toEqual(["Application Photos", "Compression", "2026"]);
  });

  it("treats a 404 on delete as already gone", async () => {
    graphFetch.mockRejectedValue(new GraphError(404, "Not Found", "", "u"));
    await expect(deleteApplicationPhoto("x")).resolves.toBeUndefined();
  });
});
