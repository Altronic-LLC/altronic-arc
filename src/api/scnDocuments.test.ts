import { beforeEach, describe, expect, it } from "vitest";
import * as api from "./scnDocuments";
import {
  __resetScnDocumentsMock,
  createScnFolder,
  getScnDocumentPath,
  listScnDocuments,
  scnFolderNameProblem,
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

  it("has no delete or rename — by choice", () => {
    expect(Object.keys(api).filter((k) => /delete|remove|rename/i.test(k))).toEqual([]);
  });
});
