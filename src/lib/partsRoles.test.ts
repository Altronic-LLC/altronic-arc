import { describe, expect, it } from "vitest";
import {
  addPartGate,
  approvalRecordHtml,
  approveGate,
  editPartGate,
  initialSignOff,
  manageDescriptionOptionsGate,
  nextSignOff,
  parsePartsRoles,
  partsRightsFor,
  serializePartsRoles,
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
  it("an editor edits Part List parts and adds components, but not HCO edits or 722", () => {
    expect(partsRightsFor(["editor"])).toEqual({
      editParts: true,
      addComponents: true,
      editComponents: false,
      addSil: false,
      approveEngineering: false,
      approveSap: false,
    });
  });

  it("an HCO editor is also an editor", () => {
    expect(partsRightsFor(["hco editor"])).toMatchObject({ editParts: true, editComponents: true, addSil: true });
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

  it("keep HCO edits to HCO editors", () => {
    expect(editPartGate(access(["editor"]), true).allowed).toBe(false);
    expect(editPartGate(access(["editor"]), false).allowed).toBe(true);
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
