import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Supply Chain Files at the REQUEST level, USE_MOCK forced off. The library's
// root is a FOLDER inside the PMO drive (`General/Supply Chain Files`), so the
// shapes that matter are the path-addressed root, the upload target and the
// breadcrumb never showing anything above that folder.
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
  createSupplyChainFolder,
  deleteSupplyChainFile,
  getSupplyChainFilesPath,
  listSupplyChainFiles,
  uploadSupplyChainFile,
} from "./supplyChainFiles";

const DRIVE = `/sites/${SITES.pmo}/drive`;
const ROOT = `${DRIVE}/root:/General/Supply%20Chain%20Files:`;

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  uploadToDriveTarget.mockReset();
  graphFetchAll.mockResolvedValue([]);
});

describe("Supply Chain Files (real mode)", () => {
  it("lists the root by PATH, and a subfolder by id", async () => {
    await listSupplyChainFiles();
    expect(graphFetchAll.mock.calls[0][0].startsWith(`${ROOT}/children?`)).toBe(true);
    await listSupplyChainFiles("01ABC");
    expect(graphFetchAll.mock.calls[1][0].startsWith(`${DRIVE}/items/01ABC/children?`)).toBe(true);
  });

  it("creates a folder at the root with conflictBehavior fail", async () => {
    graphFetch.mockResolvedValue({ id: "n1", name: "Audits", webUrl: "u", folder: {} });
    await createSupplyChainFolder(null, "Audits");
    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toBe(`${ROOT}/children`);
    expect(JSON.parse(init.body)).toMatchObject({
      name: "Audits",
      "@microsoft.graph.conflictBehavior": "fail",
    });
  });

  it("turns a 409 into a sentence naming the folder", async () => {
    graphFetch.mockRejectedValue(new GraphError(409, "Conflict", "nameAlreadyExists", "u"));
    await expect(createSupplyChainFolder(null, "Audits")).rejects.toThrow(
      'A folder called "Audits" already exists here.',
    );
  });

  it("uploads to the root by path and to a subfolder by id, renaming a clash", async () => {
    uploadToDriveTarget.mockResolvedValue({ id: "f", name: "a.pdf", webUrl: "u", file: {} });
    const file = new File(["x"], "a b.pdf");
    await uploadSupplyChainFile(null, file);
    expect(uploadToDriveTarget.mock.calls[0][0]).toBe(`${ROOT}/a%20b.pdf:`);
    expect(uploadToDriveTarget.mock.calls[0][2]).toMatchObject({ conflict: "rename" });
    await uploadSupplyChainFile("01ABC", file);
    expect(uploadToDriveTarget.mock.calls[1][0]).toBe(`${DRIVE}/items/01ABC:/a%20b.pdf:`);
  });

  it("starts the breadcrumb at the folder — nothing above it is shown", async () => {
    graphFetch.mockImplementation(async (url: string) => {
      if (url.includes("/items/")) {
        return {
          id: "sub",
          name: "2026",
          webUrl: "w2026",
          parentReference: { path: "/drives/b!x/root:/General/Supply Chain Files/Audits" },
        };
      }
      return { id: "aud", name: "Audits", webUrl: "waud" };
    });
    const crumbs = await getSupplyChainFilesPath("sub");
    expect(crumbs.map((c) => c.name)).toEqual(["Supply Chain Files", "Audits", "2026"]);
    const byPath = graphFetch.mock.calls.filter(([u]) => String(u).includes("root:"));
    expect(byPath).toHaveLength(1);
    expect(byPath[0][0]).toContain("General/Supply%20Chain%20Files/Audits:");
  });

  it("treats a 404 on delete as already gone", async () => {
    graphFetch.mockRejectedValue(new GraphError(404, "Not Found", "", "u"));
    await expect(deleteSupplyChainFile("x")).resolves.toBeUndefined();
  });
});
