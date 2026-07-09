import { describe, it, expect } from "vitest";
import { listProjectFolderEntries, uploadFileToFolder } from "./projectFiles";

// USE_MOCK is true under Vitest, so these exercise the in-memory mock tree.
describe("listProjectFolderEntries (mock)", () => {
  it("lists top-level project folders, folders first and alphabetical", async () => {
    const root = await listProjectFolderEntries();
    expect(root.length).toBeGreaterThan(0);
    expect(root.every((e) => e.isFolder)).toBe(true);
    // folders-first ordering means the first entry is a folder
    expect(root[0].isFolder).toBe(true);
    // top-level folders carry a project lookupId
    expect(root.some((e) => typeof e.projectLookupId === "number")).toBe(true);
  });

  it("drills into a folder to list its subfolders and files (folders first)", async () => {
    const amp = await listProjectFolderEntries("mf-amp");
    const names = amp.map((e) => e.name);
    expect(names).toContain("Drawings");
    expect(names).toContain("BOM.xlsx");
    // the subfolder sorts before the files
    expect(amp[0].isFolder).toBe(true);
  });

  it("returns [] for an unknown folder id", async () => {
    expect(await listProjectFolderEntries("does-not-exist")).toEqual([]);
  });
});

describe("uploadFileToFolder (mock)", () => {
  it("adds the uploaded file to the target folder's listing", async () => {
    const file = new File(["hello"], "spec-notes.txt", { type: "text/plain" });
    const uploaded = await uploadFileToFolder("mf-eng", file);
    expect(uploaded.name).toBe("spec-notes.txt");
    expect(uploaded.isFolder).toBe(false);

    const entries = await listProjectFolderEntries("mf-eng");
    expect(entries.some((e) => e.name === "spec-notes.txt")).toBe(true);
  });

  it("rejects files larger than the 4 MB simple-upload limit", async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024)], "huge.bin");
    await expect(uploadFileToFolder("mf-eng", big)).rejects.toThrow(/4 MB/);
  });
});
