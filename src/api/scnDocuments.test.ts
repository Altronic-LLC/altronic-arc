import { beforeEach, describe, expect, it } from "vitest";
import * as api from "./scnDocuments";
import {
  __resetScnDocumentsMock,
  createScnFolder,
  deleteScnDocument,
  getScnDocumentPath,
  listScnDocuments,
  renameScnDocument,
  scnFolderNameProblem,
  scnItemNameProblem,
  uploadScnDocument,
} from "./scnDocuments";

beforeEach(() => {
  __resetScnDocumentsMock();
});

describe("scnFolderNameProblem", () => {
  it("accepts an ordinary name", () => {
    expect(scnFolderNameProblem("LTB Analysis 2026")).toBeNull();
  });

  it.each(['A"B', "A*B", "A:B", "A<B", "A>B", "A?B", "A/B", "A\\B", "A|B"])(
    "refuses %s",
    (name) => {
      expect(scnFolderNameProblem(name)).toMatch(/can't contain/);
    },
  );

  it("refuses blank, leading/trailing spaces and dots", () => {
    expect(scnFolderNameProblem("   ")).toMatch(/required/);
    expect(scnFolderNameProblem(" Q4")).toMatch(/space/);
    expect(scnFolderNameProblem("Q4 ")).toMatch(/space/);
    expect(scnFolderNameProblem(".Q4")).toMatch(/full stop/);
    expect(scnFolderNameProblem("Q4.")).toMatch(/full stop/);
  });
});

describe("the mock library", () => {
  it("mirrors the live root: folders first, then the four loose files", async () => {
    const root = await listScnDocuments();
    expect(root.filter((e) => e.isFolder).map((e) => e.name)).toEqual([
      "ARCHIVE",
      "EECR",
      "General",
      "Inventory Review Reports",
      "LTB Analysis",
      "SCN",
      "Single Use Reports",
    ]);
    expect(root.filter((e) => !e.isFolder).map((e) => e.name)).toEqual([
      "Master List Single Use_6-8-2022.xlsx",
      "Obsolete SCN2024-070 Varispark.docx",
      "SCN FLOW.pdf",
      "Submitting an SCN.docx",
    ]);
  });

  it("browses into a folder and builds its breadcrumb", async () => {
    const general = (await listScnDocuments()).find((e) => e.name === "General")!;
    const inside = await listScnDocuments(general.id);
    const templates = inside.find((e) => e.name === "Templates")!;
    const path = await getScnDocumentPath(templates.id);
    expect(path.map((c) => c.name)).toEqual(["Documents", "General", "Templates"]);
    expect(path[0].id).toBeNull();
  });

  it("creates a folder, and refuses a duplicate name", async () => {
    await createScnFolder(null, "Q4 Reviews");
    expect((await listScnDocuments()).some((e) => e.name === "Q4 Reviews" && e.isFolder)).toBe(true);
    await expect(createScnFolder(null, "general")).rejects.toThrow(
      'A folder called "general" already exists here.',
    );
  });

  it("uploads a file, renaming rather than replacing a clash", async () => {
    const file = new File(["x"], "SCN FLOW.pdf");
    const entry = await uploadScnDocument(null, file);
    expect(entry.name).toBe("SCN FLOW 1.pdf");
    const names = (await listScnDocuments()).map((e) => e.name);
    expect(names).toContain("SCN FLOW.pdf");
    expect(names).toContain("SCN FLOW 1.pdf");
  });

  // INVERTED deliberately (Ray, 2026-10-07: "Go ahead and allow delete and
  // rename"). This used to assert NO delete/rename export. It now pins EXACTLY
  // these two — so a permanent delete or a bulk remove can't slip in unseen.
  it("exports exactly one delete and one rename", () => {
    expect(Object.keys(api).filter((k) => /delete|remove|rename/i.test(k)).sort()).toEqual([
      "deleteScnDocument",
      "renameScnDocument",
    ]);
  });

  it("renames a file, and refuses a name a sibling already has", async () => {
    const pdf = (await listScnDocuments()).find((e) => e.name === "SCN FLOW.pdf")!;
    const renamed = await renameScnDocument(pdf.id, "SCN Flow 2026.pdf", { currentName: pdf.name });
    expect(renamed).toMatchObject({ id: pdf.id, name: "SCN Flow 2026.pdf" });
    const names = (await listScnDocuments()).map((e) => e.name);
    expect(names).toContain("SCN Flow 2026.pdf");
    expect(names).not.toContain("SCN FLOW.pdf");
    await expect(renameScnDocument(pdf.id, "general")).rejects.toThrow(
      'A file or folder called "general" already exists here.',
    );
  });

  it("an unchanged name changes nothing; a case-only change is allowed", async () => {
    const eecr = (await listScnDocuments()).find((e) => e.name === "EECR")!;
    expect(await renameScnDocument(eecr.id, "EECR", { currentName: "EECR", isFolder: true })).toBeNull();
    const renamed = await renameScnDocument(eecr.id, "Eecr", { currentName: "EECR", isFolder: true });
    expect(renamed?.name).toBe("Eecr");
  });

  it("deletes a folder WITH its subtree", async () => {
    const general = (await listScnDocuments()).find((e) => e.name === "General")!;
    const templates = (await listScnDocuments(general.id)).find((e) => e.name === "Templates")!;
    await deleteScnDocument(general.id);
    expect((await listScnDocuments()).some((e) => e.name === "General")).toBe(false);
    expect(await listScnDocuments(general.id)).toEqual([]);
    expect(await listScnDocuments(templates.id)).toEqual([]);
    // Deleting it again is "already gone", not an error.
    await expect(deleteScnDocument(general.id)).resolves.toBeUndefined();
  });
});

describe("scnItemNameProblem", () => {
  it("names a file as a file, and a folder by default", () => {
    expect(scnItemNameProblem("", "file")).toBe("A file name is required.");
    expect(scnItemNameProblem("a|b.pdf", "file")).toMatch(/^A file name can't contain/);
    expect(scnItemNameProblem("Report.docx", "file")).toBeNull();
    expect(scnItemNameProblem(" ")).toBe("A folder name is required.");
  });
});
