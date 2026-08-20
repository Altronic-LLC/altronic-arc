import { describe, it, expect } from "vitest";
import {
  createProjectFolder,
  listProjectFolderEntries,
  projectRefWriteKey,
  uploadFileToFolder,
} from "./projectFiles";

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

  it("accepts a file past the 4 MB simple-PUT threshold (chunked upload)", async () => {
    // 5 MB used to be rejected outright; it now routes to an upload session.
    const big = new File([new Uint8Array(5 * 1024 * 1024)], "big-drawing.pdf");
    const uploaded = await uploadFileToFolder("mf-eng", big);
    expect(uploaded.name).toBe("big-drawing.pdf");
  });

  it("still rejects files over the 250 MB ceiling, naming the actual size", async () => {
    // Sparse-ish: allocate the object without materialising 260 MB of bytes.
    const huge = new File([], "enormous.zip");
    Object.defineProperty(huge, "size", { value: 260 * 1024 * 1024 });
    await expect(uploadFileToFolder("mf-eng", huge)).rejects.toThrow(/260\.0 MB.*250\.0 MB/s);
  });
});

// Graph's simple PUT upload defaults to REPLACING a same-named file, so
// uploadFileToFolder must dodge that itself rather than trust the server.
// "spec-notes.txt" was already written into mf-eng by the first test in the
// block above — reuse that as the pre-existing collision.
describe("uploadFileToFolder collision handling (mock)", () => {
  it("suffixes '(2)' instead of replacing an existing file, and leaves the original alone", async () => {
    const before = await listProjectFolderEntries("mf-eng");
    const original = before.find((e) => e.name === "spec-notes.txt");
    expect(original).toBeDefined();

    const dupe = new File(["second copy"], "spec-notes.txt", { type: "text/plain" });
    const uploaded = await uploadFileToFolder("mf-eng", dupe);
    expect(uploaded.name).toBe("spec-notes (2).txt");

    const after = await listProjectFolderEntries("mf-eng");
    // both names are present — nothing got overwritten
    expect(after.some((e) => e.name === "spec-notes.txt")).toBe(true);
    expect(after.some((e) => e.name === "spec-notes (2).txt")).toBe(true);
    // the original entry (id, size) is untouched
    expect(after.find((e) => e.name === "spec-notes.txt")).toEqual(original);
  });

  it("suffixes '(3)' when '(2)' is also taken", async () => {
    const anotherDupe = new File(["third copy"], "spec-notes.txt", { type: "text/plain" });
    const uploaded = await uploadFileToFolder("mf-eng", anotherDupe);
    expect(uploaded.name).toBe("spec-notes (3).txt");

    const entries = await listProjectFolderEntries("mf-eng");
    expect(entries.filter((e) => e.name.startsWith("spec-notes")).map((e) => e.name)).toEqual(
      expect.arrayContaining(["spec-notes.txt", "spec-notes (2).txt", "spec-notes (3).txt"]),
    );
  });

  it("leaves a name that isn't already in the folder untouched", async () => {
    const unique = new File(["fresh"], "unique-report.pdf", { type: "application/pdf" });
    const uploaded = await uploadFileToFolder("mf-eng", unique);
    expect(uploaded.name).toBe("unique-report.pdf");
  });
});

describe("createProjectFolder (mock)", () => {
  it("creates a top-level folder tagged with its project", async () => {
    const created = await createProjectFolder("0042-New Programme", 4242);
    expect(created.isFolder).toBe(true);
    expect(created.projectLookupId).toBe(4242);

    const root = await listProjectFolderEntries();
    expect(root.some((e) => e.name === "0042-New Programme")).toBe(true);
  });

  it("gives the new folder its own empty listing to browse into", async () => {
    const created = await createProjectFolder("0043-Empty Programme", 4343);
    expect(await listProjectFolderEntries(created.id)).toEqual([]);
  });

  // resolveFolderForProject picks the FIRST folder matching a project, so two
  // folders for one project would make task uploads land arbitrarily.
  it("refuses a project that already has a folder", async () => {
    await createProjectFolder("0044-First", 4444);
    await expect(createProjectFolder("0044-Second", 4444)).rejects.toThrow(
      /already has a folder/i,
    );
  });

  it("refuses a duplicate folder name", async () => {
    await createProjectFolder("0045-Unique", 4545);
    await expect(createProjectFolder("0045-unique", 4546)).rejects.toThrow(
      /already exists/i,
    );
  });

  it("requires a name and a project", async () => {
    await expect(createProjectFolder("   ", 1)).rejects.toThrow(/name is required/i);
    await expect(createProjectFolder("x", 0)).rejects.toThrow(/Pick the project/i);
  });
});

describe("projectRefWriteKey", () => {
  // Reading auto-detects the column because its internal name varies by site;
  // writing needs the exact key, so it's learned from a folder that has one.
  it("prefers the writable LookupId sibling", () => {
    expect(
      projectRefWriteKey([
        { Title: "x", ProjectReference: "0017-AMP", ProjectReferenceLookupId: 501 },
      ]),
    ).toBe("ProjectReferenceLookupId");
  });

  it("copes with the encoded column name", () => {
    expect(
      projectRefWriteKey([{ Project_x0020_ReferenceLookupId: 7 }]),
    ).toBe("Project_x0020_ReferenceLookupId");
  });

  it("derives the sibling when only the display column came back", () => {
    expect(projectRefWriteKey([{ ProjectReference: "0017-AMP" }])).toBe(
      "ProjectReferenceLookupId",
    );
  });

  it("falls back to the default on an empty library", () => {
    expect(projectRefWriteKey([])).toBe("ProjectReferenceLookupId");
    expect(projectRefWriteKey([{ Title: "no project column here" }])).toBe(
      "ProjectReferenceLookupId",
    );
  });
});
