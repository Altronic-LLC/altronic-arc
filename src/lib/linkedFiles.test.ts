import { describe, expect, it } from "vitest";
import {
  LINKED_FILES_MAX_CHARS,
  addLinkedFiles,
  folderNamesBelowProjectFolders,
  folderPathText,
  parseLinkedFiles,
  removeLinkedFile,
  sameLinkedFiles,
  serializeLinkedFiles,
  type LinkedFile,
} from "./linkedFiles";

const by = { name: "Demo User", email: "demo.user@altronic-llc.com" };
const at = new Date("2026-11-25T14:00:00Z");

function link(id: string, name = `${id}.pdf`): LinkedFile {
  return {
    id,
    name,
    webUrl: `https://example.test/${id}`,
    folderPath: "381-MT / Misc",
    linkedBy: "Someone",
    linkedByEmail: "someone@altronic-llc.com",
    linkedAt: "2026-11-01T12:00:00.000Z",
  };
}

describe("parseLinkedFiles", () => {
  it("reads blank as no links, not corrupt", () => {
    expect(parseLinkedFiles(null)).toEqual({ files: [], corrupt: false });
    expect(parseLinkedFiles(undefined)).toEqual({ files: [], corrupt: false });
    expect(parseLinkedFiles("   ")).toEqual({ files: [], corrupt: false });
  });

  it("calls anything it can't read corrupt", () => {
    expect(parseLinkedFiles("not json").corrupt).toBe(true);
    expect(parseLinkedFiles('{"id":"a"}').corrupt).toBe(true);
    expect(parseLinkedFiles(42).corrupt).toBe(true);
  });

  it("reads what it wrote", () => {
    const files = [link("a"), link("b")];
    expect(parseLinkedFiles(serializeLinkedFiles(files))).toEqual({ files, corrupt: false });
  });

  it("drops entries that aren't a link, and repeats of one file", () => {
    const raw = JSON.stringify([link("a"), { name: "no id" }, { id: "x" }, "junk", link("a", "again.pdf")]);
    const out = parseLinkedFiles(raw);
    expect(out.corrupt).toBe(false);
    expect(out.files.map((f) => f.id)).toEqual(["a"]);
    expect(out.files[0].name).toBe("a.pdf");
  });
});

describe("serializeLinkedFiles", () => {
  it("writes null for no links, which clears the column", () => {
    expect(serializeLinkedFiles([])).toBeNull();
  });

  it("refuses a value past the limit rather than letting SharePoint cut it", () => {
    const many = Array.from({ length: 400 }, (_, i) => link(`id-${i}`, `${"x".repeat(150)}-${i}.pdf`));
    expect(JSON.stringify(many).length).toBeGreaterThan(LINKED_FILES_MAX_CHARS);
    expect(() => serializeLinkedFiles(many)).toThrow(/too many linked files/);
  });
});

describe("addLinkedFiles / removeLinkedFile", () => {
  it("adds after the existing ones, stamping only the new ones", () => {
    const out = addLinkedFiles(
      [link("a")],
      [{ id: "b", name: "b.dwg", webUrl: "u", folderPath: "381-MT" }],
      by,
      at,
    );
    expect(out.map((f) => f.id)).toEqual(["a", "b"]);
    expect(out[0].linkedBy).toBe("Someone");
    expect(out[1]).toMatchObject({
      linkedBy: "Demo User",
      linkedByEmail: "demo.user@altronic-llc.com",
      linkedAt: "2026-11-25T14:00:00.000Z",
      folderPath: "381-MT",
    });
  });

  it("never links one file twice", () => {
    const out = addLinkedFiles(
      [link("a")],
      [
        { id: "a", name: "a.pdf", webUrl: "u", folderPath: "" },
        { id: "b", name: "b.pdf", webUrl: "u", folderPath: "" },
        { id: "b", name: "b.pdf", webUrl: "u", folderPath: "" },
      ],
      by,
      at,
    );
    expect(out.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("removes by id", () => {
    expect(removeLinkedFile([link("a"), link("b")], "a").map((f) => f.id)).toEqual(["b"]);
  });

  it("sameLinkedFiles compares the files in order", () => {
    expect(sameLinkedFiles([link("a")], [link("a")])).toBe(true);
    expect(sameLinkedFiles([link("a"), link("b")], [link("b"), link("a")])).toBe(false);
    expect(sameLinkedFiles([link("a")], [])).toBe(false);
  });
});

describe("folderNamesBelowProjectFolders", () => {
  const PF = "General/Project Folders";

  it("gives the folders below Project Folders, decoded", () => {
    const path = "/drives/b!abc/root:/General/Project%20Folders/CAT%203600%20Controls%20381-MT/CAT%203600%20Misc";
    expect(folderNamesBelowProjectFolders(path, PF)).toEqual(["CAT 3600 Controls 381-MT", "CAT 3600 Misc"]);
    expect(folderPathText(folderNamesBelowProjectFolders(path, PF))).toBe(
      "CAT 3600 Controls 381-MT / CAT 3600 Misc",
    );
  });

  it("ignores case on the Project Folders prefix", () => {
    expect(folderNamesBelowProjectFolders("/drive/root:/general/project folders/381", PF)).toEqual(["381"]);
  });

  it("keeps every folder for a file outside Project Folders", () => {
    expect(folderNamesBelowProjectFolders("/drive/root:/Shared/Other", PF)).toEqual(["Shared", "Other"]);
  });

  it("is empty for a missing or unreadable path", () => {
    expect(folderNamesBelowProjectFolders(undefined, PF)).toEqual([]);
    expect(folderNamesBelowProjectFolders("/drives/b!abc/items/x", PF)).toEqual([]);
  });
});
