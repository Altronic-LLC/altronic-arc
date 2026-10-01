import { describe, expect, it } from "vitest";
import {
  addDatasheetGate,
  addPartGate,
  approvalRecordHtml,
  approveGate,
  editPartGate,
  initialSignOff,
  manageDescriptionOptionsGate,
  nextSignOff,
  parsePartsRoles,
  parseSapResponse,
  sapResponseNeedsComment,
  partsRightsFor,
  serializePartsRoles,
  suggestCorrectionGate,
  type PartsAccess,
  type PartsRole,
} from "./partsRoles";

function access(roles: PartsRole[], over: Partial<PartsAccess> = {}): PartsAccess {
  return { roles, configured: true, resolving: false, failed: false, ...over };
}

describe("manageDescriptionOptionsGate", () => {
  it("lets the SAP admin and the reviewing engineers change the description lists — nobody else", () => {
    expect(manageDescriptionOptionsGate(access(["sap admin"])).allowed).toBe(true);
    expect(manageDescriptionOptionsGate(access(["reviewing engineer"])).allowed).toBe(true);
    expect(manageDescriptionOptionsGate(access(["hco editor"]))).toMatchObject({
      allowed: false,
      hint: expect.stringMatching(/Only the SAP admin and the reviewing engineers/),
    });
    expect(manageDescriptionOptionsGate(access(["sap admin"], { configured: false })).allowed).toBe(false);
  });
});

describe("parse / serialize", () => {
  it("keeps known tags, in order, whatever the casing and spacing", () => {
    expect(parsePartsRoles(" SAP Admin ,editor, junk,editor")).toEqual(["editor", "sap admin"]);
    expect(parsePartsRoles(undefined)).toEqual([]);
    expect(serializePartsRoles(["sap admin", "editor"])).toBe("editor, sap admin");
  });

  it("reads the old 'hoc editor' spelling as the HCO editor tag, and writes the new one", () => {
    const roles = parsePartsRoles("hoc editor, reviewing engineer");
    expect(roles).toEqual(["hco editor", "reviewing engineer"]);
    expect(serializePartsRoles(roles)).toBe("hco editor, reviewing engineer");
  });
});

describe("partsRightsFor — the implications", () => {
  it("an editor ADDS parts and components (not 722) but edits nothing", () => {
    expect(partsRightsFor(["editor"])).toEqual({
      addParts: true,
      editParts: false,
      addComponents: true,
      editComponents: false,
      addSil: false,
      approveEngineering: false,
      approveSap: false,
    });
  });

  it("a parts editor (the hco editor tag) is also an editor, and edits both lists", () => {
    expect(partsRightsFor(["hco editor"])).toMatchObject({
      addParts: true,
      editParts: true,
      editComponents: true,
      addSil: true,
    });
  });

  it("a reviewing engineer can correct what they review", () => {
    expect(partsRightsFor(["reviewing engineer"])).toMatchObject({
      editComponents: true,
      approveEngineering: true,
      approveSap: false,
    });
  });

  it("an SAP admin edits every field but does NOT do the engineering review", () => {
    expect(partsRightsFor(["sap admin"])).toMatchObject({
      editParts: true,
      editComponents: true,
      addSil: true,
      approveSap: true,
      approveEngineering: false,
    });
  });

  it("no tags, no rights", () => {
    expect(Object.values(partsRightsFor([])).every((v) => v === false)).toBe(true);
  });
});

describe("the gates", () => {
  it("are CLOSED when the Parts Roles list isn't configured — read-only, never open", () => {
    const off = access(["sap admin"], { configured: false });
    expect(addPartGate(off, "604", false)).toMatchObject({ allowed: false, resolving: false });
    expect(addPartGate(off, "604", false).hint).toMatch(/isn't set up yet/);
    expect(editPartGate(off, false).allowed).toBe(false);
    expect(approveGate(off, "Pending SAP").allowed).toBe(false);
  });

  it("report resolving, not a denial, while the list loads", () => {
    expect(editPartGate(access([], { resolving: true }), false)).toMatchObject({ allowed: false, resolving: true });
  });

  it("refuse, saying why, when the list couldn't be read", () => {
    expect(editPartGate(access(["editor"], { failed: true }), false).hint).toMatch(/Couldn't check/);
  });

  it("keep the 722 list to HCO editors", () => {
    expect(addPartGate(access(["editor"]), "722", true).allowed).toBe(false);
    expect(addPartGate(access(["editor"]), "722", true).hint).toMatch(/722/);
    expect(addPartGate(access(["editor"]), "701", true).allowed).toBe(true);
    expect(addPartGate(access(["hco editor"]), "722", true).allowed).toBe(true);
  });

  it("keep editing, on both lists, to parts editors and up — adding isn't editing", () => {
    expect(editPartGate(access(["editor"]), true).allowed).toBe(false);
    expect(editPartGate(access(["editor"]), false).allowed).toBe(false);
    expect(editPartGate(access(["hco editor"]), false).allowed).toBe(true);
    expect(editPartGate(access(["hco editor"]), true).allowed).toBe(true);
    expect(editPartGate(access(["sap admin"]), false).allowed).toBe(true);
  });

  it("point an editor at Suggest a correction, and anybody else at an admin", () => {
    expect(editPartGate(access(["editor"]), false).hint).toMatch(/Suggest a correction/);
    expect(editPartGate(access([]), false).hint).toMatch(/Ask an ARC admin/);
  });

  it("let an editor add to an existing list", () => {
    expect(addPartGate(access(["editor"]), "604", false).allowed).toBe(true);
    expect(addPartGate(access([]), "604", false).allowed).toBe(false);
  });

  it("give each approval step to its own role", () => {
    expect(approveGate(access(["reviewing engineer"]), "Pending Engineering Review").allowed).toBe(true);
    expect(approveGate(access(["reviewing engineer"]), "Pending SAP").allowed).toBe(false);
    expect(approveGate(access(["sap admin"]), "Pending SAP").allowed).toBe(true);
    expect(approveGate(access(["sap admin"]), "Pending Engineering Review").allowed).toBe(false);
  });

  it("offer no approval on an Approved or legacy (blank) part", () => {
    expect(approveGate(access(["sap admin"]), "Approved")).toEqual({ allowed: false, resolving: false, hint: "" });
    expect(approveGate(access(["sap admin"]), null).allowed).toBe(false);
  });
});

describe("the approval chain", () => {
  it("starts a component at engineering review and a part at SAP", () => {
    expect(initialSignOff(true)).toBe("Pending Engineering Review");
    expect(initialSignOff(false)).toBe("Pending SAP");
  });

  it("moves one step at a time, and never out of Approved or blank", () => {
    expect(nextSignOff("Pending Engineering Review")).toBe("Pending SAP");
    expect(nextSignOff("Pending SAP")).toBe("Approved");
    expect(nextSignOff("Approved")).toBeNull();
    expect(nextSignOff(null)).toBeNull();
  });

  it("records the step and an escaped comment", () => {
    const html = approvalRecordHtml("Pending SAP", "In SAP <today>\n\nThanks");
    expect(html).toContain("Added to SAP — approved.");
    expect(html).toContain("<p>In SAP &lt;today&gt;</p><p>Thanks</p>");
    expect(approvalRecordHtml("Pending Engineering Review", "")).toBe(
      "<p><strong>Engineering review approved.</strong></p>",
    );
  });
});

describe("the SAP step's three answers", () => {
  it("reads an answer off the email link, and nothing else", () => {
    expect(parseSapResponse("added")).toBe("added");
    expect(parseSapResponse("not-needed")).toBe("not-needed");
    expect(parseSapResponse("more-info")).toBe("more-info");
    expect(parseSapResponse("approve-everything")).toBeNull();
    expect(parseSapResponse(null)).toBeNull();
  });

  it("records the answer given as the step", () => {
    expect(approvalRecordHtml("Pending SAP", "", "not-needed")).toBe(
      "<p><strong>Does not need to be added to SAP — approved.</strong></p>",
    );
    expect(approvalRecordHtml("Pending SAP", "Need the vendor #", "more-info")).toContain(
      "Will be added to SAP but requires more information — approved.",
    );
  });

  it("ignores an answer at any step but SAP's", () => {
    expect(approvalRecordHtml("Pending Engineering Review", "", "added")).toBe(
      "<p><strong>Engineering review approved.</strong></p>",
    );
  });

  it("needs a comment only for 'more information'", () => {
    expect(sapResponseNeedsComment("more-info")).toBe(true);
    expect(sapResponseNeedsComment("added")).toBe(false);
    expect(sapResponseNeedsComment(null)).toBe(false);
  });
});

describe("addDatasheetGate — a missing datasheet from the part page", () => {
  it("is open to the Add role on the lists it can add to", () => {
    expect(addDatasheetGate(access(["editor"]), "604", false).allowed).toBe(true);
    expect(addDatasheetGate(access(["editor"]), "701", true).allowed).toBe(true);
  });

  it("keeps 722 to parts editors, as adding to it is", () => {
    expect(addDatasheetGate(access(["editor"]), "722", true).allowed).toBe(false);
    expect(addDatasheetGate(access(["hco editor"]), "722", true).allowed).toBe(true);
  });

  it("is open to anyone who can edit the part, and closed to a reader", () => {
    expect(addDatasheetGate(access(["sap admin"]), "604", false).allowed).toBe(true);
    expect(addDatasheetGate(access([]), "604", false).allowed).toBe(false);
  });

  it("waits, rather than refusing, while the roles load", () => {
    expect(addDatasheetGate(access([], { resolving: true }), "604", false)).toMatchObject({ allowed: false, resolving: true });
  });
});

describe("suggestCorrectionGate", () => {
  it("is for somebody who can add but not edit this part", () => {
    expect(suggestCorrectionGate(access(["editor"]), false).allowed).toBe(true);
    expect(suggestCorrectionGate(access(["editor"]), true).allowed).toBe(true);
  });

  it("isn't offered to somebody who can just edit it", () => {
    expect(suggestCorrectionGate(access(["hco editor"]), false).allowed).toBe(false);
    expect(suggestCorrectionGate(access(["reviewing engineer"]), true).allowed).toBe(false);
    expect(suggestCorrectionGate(access(["sap admin"]), false).allowed).toBe(false);
  });

  it("isn't offered to a reader with no role, or when the list isn't set up", () => {
    expect(suggestCorrectionGate(access([]), false).allowed).toBe(false);
    expect(suggestCorrectionGate(access(["editor"], { configured: false }), false).allowed).toBe(false);
  });
});

describe("addPartGate — a new list", () => {
  it("is the SAP admin's alone", () => {
    expect(addPartGate(access(["editor"]), "411", false, true).allowed).toBe(false);
    expect(addPartGate(access(["reviewing engineer"]), "411", false, true).hint).toMatch(/only the SAP admin can start a new list/);
    expect(addPartGate(access(["sap admin"]), "411", false, true).allowed).toBe(true);
  });

  it("leaves adding to an existing list to any editor", () => {
    expect(addPartGate(access(["editor"]), "410", false, false).allowed).toBe(true);
  });

  it("doesn't apply to the HCO lists, which always exist", () => {
    expect(addPartGate(access(["editor"]), "701", true, true).allowed).toBe(true);
  });
});
