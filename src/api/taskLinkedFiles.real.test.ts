import { beforeEach, describe, expect, it, vi } from "vitest";

// Linked files' Graph requests in REAL mode (BusinessIT#62) — none of this is
// visible from the mock branch: the column is read ON ITS OWN (never in the
// task list's $select), a missing column is learned once from a 400, a write
// reads fresh and re-reads after a conflict, and a value ARC can't read is
// never written over.

const graph = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
  SP_SITE_ID: "eng-site",
  SP_LIST_ID: "task-list",
}));
vi.mock("./graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./graph")>()),
  graphFetch: graph.fetch,
}));

import * as api from "./taskLinkedFiles";
import { GraphError } from "./graph";
import type { LinkedFile } from "@/lib/linkedFiles";

const item = "/sites/eng-site/lists/task-list/items/47";
const by = { name: "Demo User", email: "demo.user@altronic-llc.com" };

function stored(...ids: string[]): string {
  const files: LinkedFile[] = ids.map((id) => ({
    id,
    name: `${id}.pdf`,
    webUrl: `https://sp.test/${id}`,
    folderPath: "381-MT",
    linkedBy: "Someone",
    linkedByEmail: "someone@altronic-llc.com",
    linkedAt: "2026-11-01T12:00:00.000Z",
  }));
  return JSON.stringify(files);
}

const read = (value: unknown) => ({ fields: { LinkedFiles: value } });

beforeEach(() => {
  graph.fetch.mockReset();
  api.__resetLinkedFilesMock({});
});

describe("readTaskLinkedFiles", () => {
  it("reads only the LinkedFiles column of one task", async () => {
    graph.fetch.mockResolvedValue(read(stored("a")));
    const out = await api.readTaskLinkedFiles(47);
    expect(graph.fetch.mock.calls[0][0]).toBe(`${item}?$expand=fields($select=LinkedFiles)`);
    expect(out.files.map((f) => f.id)).toEqual(["a"]);
    expect(api.linkedFilesColumnAvailable()).toBe(true);
  });

  it("reads a task with nothing linked as an empty list", async () => {
    graph.fetch.mockResolvedValue({ fields: {} });
    expect(await api.readTaskLinkedFiles(47)).toEqual({ files: [], corrupt: false });
  });

  it("learns a missing column from a 400 and stops asking", async () => {
    graph.fetch.mockRejectedValue(new GraphError(400, "Bad Request", "invalidRequest", "u"));
    await expect(api.readTaskLinkedFiles(47)).rejects.toBeInstanceOf(api.LinkedFilesColumnMissingError);
    expect(api.linkedFilesColumnAvailable()).toBe(false);
    await expect(api.readTaskLinkedFiles(48)).rejects.toBeInstanceOf(api.LinkedFilesColumnMissingError);
    expect(graph.fetch).toHaveBeenCalledTimes(1);
  });

  it("lets any other failure through as itself", async () => {
    graph.fetch.mockRejectedValue(new GraphError(503, "Unavailable", "", "u"));
    await expect(api.readTaskLinkedFiles(47)).rejects.toMatchObject({ status: 503 });
    expect(api.linkedFilesColumnAvailable()).toBeNull();
  });
});

describe("linkTaskFiles", () => {
  it("reads fresh, adds the new file after the old ones, and PATCHes the column", async () => {
    graph.fetch.mockResolvedValueOnce(read(stored("a"))).mockResolvedValueOnce(undefined);
    const out = await api.linkTaskFiles(
      47,
      [{ id: "b", name: "b.dwg", webUrl: "https://sp.test/b", folderPath: "381-MT / Misc" }],
      by,
    );
    expect(out.map((f) => f.id)).toEqual(["a", "b"]);
    const [path, init] = graph.fetch.mock.calls[1];
    expect(path).toBe(`${item}/fields`);
    expect(init.method).toBe("PATCH");
    const written = JSON.parse(JSON.parse(init.body).LinkedFiles);
    expect(written.map((f: LinkedFile) => f.id)).toEqual(["a", "b"]);
    expect(written[1]).toMatchObject({ linkedBy: "Demo User", folderPath: "381-MT / Misc" });
  });

  it("sends nothing when every picked file is already linked", async () => {
    graph.fetch.mockResolvedValueOnce(read(stored("a")));
    await api.linkTaskFiles(47, [{ id: "a", name: "a.pdf", webUrl: "u", folderPath: "" }], by);
    expect(graph.fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses to write over a value it couldn't read", async () => {
    graph.fetch.mockResolvedValueOnce(read("{broken"));
    await expect(
      api.linkTaskFiles(47, [{ id: "b", name: "b.pdf", webUrl: "u", folderPath: "" }], by),
    ).rejects.toBeInstanceOf(api.LinkedFilesUnreadableError);
    expect(graph.fetch).toHaveBeenCalledTimes(1);
  });

  it("re-reads after an edit conflict, so somebody else's link isn't lost", async () => {
    graph.fetch
      .mockResolvedValueOnce(read(stored("a")))
      .mockRejectedValueOnce(new GraphError(409, "Conflict", "resourceModified", "u"))
      .mockResolvedValueOnce(read(stored("a", "z"))) // somebody linked z meanwhile
      .mockResolvedValueOnce(undefined);
    const out = await api.linkTaskFiles(47, [{ id: "b", name: "b.pdf", webUrl: "u", folderPath: "" }], by);
    expect(out.map((f) => f.id)).toEqual(["a", "z", "b"]);
    const written = JSON.parse(JSON.parse(graph.fetch.mock.calls[3][1].body).LinkedFiles);
    expect(written.map((f: LinkedFile) => f.id)).toEqual(["a", "z", "b"]);
  });
});

describe("unlinkTaskFile", () => {
  it("writes the list without the file", async () => {
    graph.fetch.mockResolvedValueOnce(read(stored("a", "b"))).mockResolvedValueOnce(undefined);
    const out = await api.unlinkTaskFile(47, "a");
    expect(out.map((f) => f.id)).toEqual(["b"]);
    expect(JSON.parse(JSON.parse(graph.fetch.mock.calls[1][1].body).LinkedFiles)).toHaveLength(1);
  });

  it("clears the column when the last file is unlinked", async () => {
    graph.fetch.mockResolvedValueOnce(read(stored("a"))).mockResolvedValueOnce(undefined);
    await api.unlinkTaskFile(47, "a");
    expect(JSON.parse(graph.fetch.mock.calls[1][1].body)).toEqual({ LinkedFiles: null });
  });

  it("never touches the file itself — no drive request", async () => {
    graph.fetch.mockResolvedValueOnce(read(stored("a"))).mockResolvedValueOnce(undefined);
    await api.unlinkTaskFile(47, "a");
    expect(graph.fetch.mock.calls.every(([p]) => !String(p).includes("/drive/"))).toBe(true);
  });
});

describe("lookUpLinkedFile", () => {
  it("reads the file by id: its current name, link and folder", async () => {
    graph.fetch.mockResolvedValue({
      name: "renamed.pdf",
      webUrl: "https://sp.test/renamed",
      parentReference: { path: "/drives/b!x/root:/General/Project%20Folders/381-MT/Actuators" },
    });
    const out = await api.lookUpLinkedFile("file-1");
    expect(graph.fetch.mock.calls[0][0]).toBe(
      "/sites/eng-site/drive/items/file-1?$select=id,name,webUrl,parentReference",
    );
    expect(out).toEqual({
      status: "found",
      name: "renamed.pdf",
      webUrl: "https://sp.test/renamed",
      folderPath: "381-MT / Actuators",
    });
  });

  it("says gone on a 404", async () => {
    graph.fetch.mockRejectedValue(new GraphError(404, "Not Found", "itemNotFound", "u"));
    expect(await api.lookUpLinkedFile("file-1")).toEqual({ status: "gone" });
  });

  it("never reads a failure as gone", async () => {
    graph.fetch.mockRejectedValue(new GraphError(403, "Forbidden", "accessDenied", "u"));
    await expect(api.lookUpLinkedFile("file-1")).rejects.toMatchObject({ status: 403 });
  });
});
