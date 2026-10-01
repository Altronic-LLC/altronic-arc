import { describe, expect, it } from "vitest";
import { parseCommunication, appendComment } from "./communicationParser";
import { COMPONENT_FIELDS, PART_FIELDS, nextPartNumber } from "./partFields";
import { deletePartGate, type PartsAccess } from "./partsRoles";
import {
  blankColumns,
  deletionReason,
  deletionRecordHtml,
  isDeletedPart,
  partEvent,
  replacementColumns,
  reuseRecordHtml,
} from "./partLifecycle";
import { toAltronicPart } from "./altronicPartMapper";

describe("isDeletedPart", () => {
  it("is the Sign-off marker — not a description that happens to say deleted", () => {
    expect(isDeletedPart({ signOffStatus: "Deleted" })).toBe(true);
    expect(isDeletedPart({ signOffStatus: null })).toBe(false);
    expect(isDeletedPart({ signOffStatus: "Approved" })).toBe(false);
  });
});

describe("blankColumns / replacementColumns", () => {
  it("names every descriptor column, each blank for its kind", () => {
    const blank = blankColumns(COMPONENT_FIELDS);
    expect(Object.keys(blank).sort()).toEqual(COMPONENT_FIELDS.map((s) => s.column).sort());
    expect(blank).toMatchObject({ Description: "", Notes: "", HasDataSheet: false });
    expect(blankColumns(PART_FIELDS)).toMatchObject({ DateAssigned: null, Purchased: null, Manufacturer: "" });
  });

  it("replaces EVERY column on reuse — the new value where given, blank elsewhere", () => {
    const cols = replacementColumns(PART_FIELDS, { description: "New part", purchased: "Purchased" });
    expect(Object.keys(cols).sort()).toEqual(PART_FIELDS.map((s) => s.column).sort());
    expect(cols).toMatchObject({ Description: "New part", Purchased: "Purchased", Manufacturer: "", DateDrawing: null });
  });
});

describe("the history records", () => {
  function thread(...records: { authorName: string; bodyHtml: string }[]) {
    let raw = "";
    for (const r of records) raw = appendComment(raw, { ...r, authorEmail: "x@altronic-llc.com" });
    return parseCommunication(raw);
  }

  it("finds the deletion, and reads its reason back — escaped on the way in", () => {
    const comments = thread(
      { authorName: "Glenn Terry", bodyHtml: "<p><strong>Engineering review approved.</strong></p>" },
      { authorName: "Sheila Horn", bodyHtml: deletionRecordHtml('Raised twice — see "604612" <dup>') },
    );
    const record = partEvent(comments, "deleted")!;
    expect(record.authorName).toBe("Sheila Horn");
    expect(record.bodyHtml).not.toContain("<dup>");
    expect(deletionReason(record)).toBe('Raised twice — see "604612" <dup>');
    expect(partEvent(comments, "reused")).toBeNull();
  });

  it("says when and by whom a reused number was deleted", () => {
    const html = reuseRecordHtml({ by: "Sheila Horn", at: new Date(2026, 8, 1) });
    expect(html).toContain('data-part-event="reused"');
    expect(html).toContain("Sheila Horn");
    expect(html).toMatch(/Sep 1, 2026/);
  });
});

describe("a reused row's submitter", () => {
  it("is the reuse record's author, not the row's original creator", () => {
    const raw = appendComment("", { authorName: "Brandon Mirto", authorEmail: "Brandon.Mirto@altronic-llc.com", bodyHtml: reuseRecordHtml(null) });
    const part = toAltronicPart({
      id: "4",
      createdDateTime: "2012-02-14T12:00:00Z",
      lastModifiedDateTime: "2026-09-28T14:00:00Z",
      createdBy: { user: { displayName: "Load Account", email: "load@altronic-llc.com" } },
      fields: { Title: "204602", Communication: raw },
    });
    expect(part.createdBy).toEqual({ displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" });
    expect(part.createdAt.getFullYear()).toBe(new Date().getFullYear());
  });

  it("is the row's creator for an ordinary part", () => {
    const part = toAltronicPart({
      id: "4",
      createdDateTime: "2012-02-14T12:00:00Z",
      lastModifiedDateTime: "2026-09-28T14:00:00Z",
      createdBy: { user: { displayName: "Load Account", email: "load@altronic-llc.com" } },
      fields: { Title: "204602" },
    });
    expect(part.createdBy?.displayName).toBe("Load Account");
  });
});

describe("nextPartNumber — deleted numbers first", () => {
  const all = ["604596", "604600", "604612", "604650"];

  it("offers the LOWEST deleted number in the list", () => {
    expect(nextPartNumber("604", all, ["604650", "604600"])).toBe("604600");
  });

  it("ignores deleted numbers in other lists", () => {
    expect(nextPartNumber("604", all, ["605010"])).toBe("604651");
  });

  it("falls back to one past the highest — counting deleted rows, so a fresh number never lands on one", () => {
    expect(nextPartNumber("604", [...all, "604700"], [])).toBe("604701");
  });

  it("finds room in a FULL list when a number there was deleted", () => {
    expect(nextPartNumber("602", ["602999"], [])).toBeNull();
    expect(nextPartNumber("602", ["602999", "602417"], ["602417"])).toBe("602417");
  });
});

describe("deletePartGate", () => {
  const access = (roles: PartsAccess["roles"]): PartsAccess => ({ roles, configured: true, resolving: false, failed: false });

  it("is the SAP admin's alone", () => {
    expect(deletePartGate(access(["sap admin"])).allowed).toBe(true);
    for (const r of ["editor", "hco editor", "reviewing engineer"] as const) {
      expect(deletePartGate(access([r])).allowed).toBe(false);
    }
  });

  it("is closed when the roles list isn't configured", () => {
    expect(deletePartGate({ roles: ["sap admin"], configured: false, resolving: false, failed: false }).allowed).toBe(false);
  });
});
