import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The SCN Documents library at the REQUEST level, USE_MOCK forced off — the
// mock branch reads its own store and would pass whatever URL the real one
// built. Each case pins a shape that matters:
//
//  - every URL is `/sites/{SITES.scn}/drive/…`, the shape lib/listAccess.ts
//    reads as a DRIVE refusal (so a 403 locks the documents screen);
//  - a new folder is created with `conflictBehavior: fail` and a 409 becomes a
//    sentence naming the folder;
//  - an upload goes through the shared `uploadToDriveTarget` with `rename`, so
//    an existing file is never replaced.
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
  createScnFolder,
  downloadScnDocument,
  getScnDocumentPath,
  listScnDocuments,
  pathSegments,
  uploadScnDocument,
} from "./scnDocuments";

const DRIVE = `/sites/${SITES.scn}/drive`;

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  uploadToDriveTarget.mockReset();
  graphFetchAll.mockResolvedValue([]);
});

describe("listScnDocuments (real mode)", () => {
  it("lists the library ROOT when no folder is given, paged", async () => {
    await listScnDocuments();
    const url = String(graphFetchAll.mock.calls[0][0]);
    expect(url.startsWith(`${DRIVE}/root/children?`)).toBe(true);
    expect(url).toContain(
      "$select=id,name,webUrl,size,lastModifiedDateTime,folder,file,parentReference",
    );
  });

  it("lists a folder by its drive-item id", async () => {
    await listScnDocuments("01ABC");
    expect(String(graphFetchAll.mock.calls[0][0]).startsWith(`${DRIVE}/items/01ABC/children?`)).toBe(
      true,
    );
  });

  it("maps and sorts folders first, then files alphabetically", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "f2", name: "b.pdf", webUrl: "u", file: {}, size: 10, lastModifiedDateTime: "2026-01-01T00:00:00Z" },
      { id: "d1", name: "Zeta", webUrl: "u", folder: { childCount: 2 } },
      { id: "f1", name: "a.docx", webUrl: "u", file: {}, size: 5 },
    ]);
    const entries = await listScnDocuments();
    expect(entries.map((e) => e.name)).toEqual(["Zeta", "a.docx", "b.pdf"]);
    expect(entries[0]).toMatchObject({ isFolder: true, childCount: 2 });
  });
});

describe("getScnDocumentPath (real mode)", () => {
  it("is just the library root with no folder", async () => {
    const path = await getScnDocumentPath();
    expect(path).toHaveLength(1);
    expect(path[0]).toMatchObject({ id: null, name: "Documents" });
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("reads the folder once, then resolves each ancestor by path in parallel", async () => {
    graphFetch.mockImplementation(async (url: string) => {
      if (url.startsWith(`${DRIVE}/items/leaf`)) {
        return {
          id: "leaf",
          name: "Q3",
          webUrl: "w-leaf",
          parentReference: { path: "/drives/b!x/root:/General/LTB%20Analysis" },
        };
      }
      if (url.includes("root:/General/LTB%20Analysis:")) return { id: "ltb", name: "LTB Analysis", webUrl: "w-ltb" };
      if (url.includes("root:/General:")) return { id: "gen", name: "General", webUrl: "w-gen" };
      throw new Error(`unexpected ${url}`);
    });
    const path = await getScnDocumentPath("leaf");
    expect(path.map((c) => c.id)).toEqual([null, "gen", "ltb", "leaf"]);
    expect(path.map((c) => c.name)).toEqual(["Documents", "General", "LTB Analysis", "Q3"]);
    expect(String(graphFetch.mock.calls[0][0])).toBe(
      `${DRIVE}/items/leaf?$select=id,name,webUrl,parentReference`,
    );
  });

  it("parses a top-level folder's parent path as no ancestors", () => {
    expect(pathSegments("/drives/b!x/root:")).toEqual([]);
    expect(pathSegments("/drive/root:/A%20B/C")).toEqual(["A B", "C"]);
    expect(pathSegments(undefined)).toEqual([]);
  });
});

describe("createScnFolder (real mode)", () => {
  it("POSTs to the root's children with conflictBehavior fail", async () => {
    graphFetch.mockResolvedValue({ id: "new", name: "Q4", webUrl: "w", folder: {} });
    const entry = await createScnFolder(null, "Q4");
    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toBe(`${DRIVE}/root/children`);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: "Q4",
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    });
    expect(entry).toMatchObject({ id: "new", isFolder: true, childCount: 0 });
  });

  it("POSTs into a subfolder by id", async () => {
    graphFetch.mockResolvedValue({ id: "new", name: "Q4", webUrl: "w", folder: {} });
    await createScnFolder("01ABC", "Q4");
    expect(graphFetch.mock.calls[0][0]).toBe(`${DRIVE}/items/01ABC/children`);
  });

  it("turns a 409 into a sentence naming the folder", async () => {
    graphFetch.mockRejectedValue(new GraphError(409, "Conflict", '{"error":{"code":"nameAlreadyExists"}}', "u"));
    await expect(createScnFolder(null, "General")).rejects.toThrow(
      'A folder called "General" already exists here.',
    );
  });

  it("passes any other failure through", async () => {
    graphFetch.mockRejectedValue(new GraphError(403, "Forbidden", "accessDenied", "u"));
    await expect(createScnFolder(null, "Q4")).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an illegal name before sending anything", async () => {
    await expect(createScnFolder(null, "A/B")).rejects.toThrow(/can't contain/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});

describe("uploadScnDocument (real mode)", () => {
  const file = new File(["hello"], "SCN FLOW.pdf", { type: "application/pdf" });

  it("targets the library root by path, through uploadToDriveTarget with rename", async () => {
    uploadToDriveTarget.mockResolvedValue({ id: "f", name: "SCN FLOW.pdf", webUrl: "w", file: {}, size: 5 });
    const progress = vi.fn();
    const entry = await uploadScnDocument(null, file, progress);
    expect(uploadToDriveTarget).toHaveBeenCalledWith(
      `${DRIVE}/root:/SCN%20FLOW.pdf:`,
      file,
      { conflict: "rename", onProgress: progress },
    );
    expect(entry).toMatchObject({ id: "f", isFolder: false });
  });

  it("targets a folder by id", async () => {
    uploadToDriveTarget.mockResolvedValue({ id: "f", name: "SCN FLOW.pdf", webUrl: "w", file: {} });
    await uploadScnDocument("01ABC", file);
    expect(uploadToDriveTarget.mock.calls[0][0]).toBe(`${DRIVE}/items/01ABC:/SCN%20FLOW.pdf:`);
    expect(uploadToDriveTarget.mock.calls[0][2]).toMatchObject({ conflict: "rename" });
  });

  it("refuses a file over the upload limit before sending anything", async () => {
    const big = new File(["x"], "huge.zip");
    Object.defineProperty(big, "size", { value: 300 * 1024 * 1024 });
    await expect(uploadScnDocument(null, big)).rejects.toThrow(/over the/);
    expect(uploadToDriveTarget).not.toHaveBeenCalled();
  });
});

describe("downloadScnDocument (real mode)", () => {
  it("fetches the pre-authenticated downloadUrl, falling back to an unselected read", async () => {
    graphFetch
      .mockResolvedValueOnce({ id: "f" })
      .mockResolvedValueOnce({ id: "f", "@microsoft.graph.downloadUrl": "https://dl/x" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bytes", { status: 200 }));
    const blob = await downloadScnDocument("f");
    expect(String(graphFetch.mock.calls[0][0]).startsWith(`${DRIVE}/items/f?`)).toBe(true);
    expect(graphFetch.mock.calls[1][0]).toBe(`${DRIVE}/items/f`);
    expect(fetchSpy).toHaveBeenCalledWith("https://dl/x");
    expect(await blob.text()).toBe("bytes");
    fetchSpy.mockRestore();
  });
});
