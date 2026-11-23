import { describe, expect, it } from "vitest";
import {
  NO_QUALITY_FIXTURE_RIGHTS,
  editFixturesGate,
  manageFixtureRolesGate,
  parseQualityFixtureRoles,
  qualityFixtureRightsFrom,
  serializeQualityFixtureRoles,
} from "./qualityFixtureRoles";

describe("Quality Fixture Roles tags", () => {
  it("reads a CSV, an array or a single string, case-insensitively, and drops unknown tags", () => {
    expect(parseQualityFixtureRoles("Admin, editor")).toEqual(["editor", "admin"]);
    expect(parseQualityFixtureRoles(["EDITOR"])).toEqual(["editor"]);
    expect(parseQualityFixtureRoles("viewer")).toEqual([]);
    expect(parseQualityFixtureRoles(null)).toEqual([]);
  });

  it("writes a lowercase CSV in canonical order", () => {
    expect(serializeQualityFixtureRoles(["admin", "editor"])).toBe("editor,admin");
  });
});

describe("rights", () => {
  it("an admin is also an editor", () => {
    expect(qualityFixtureRightsFrom(["admin"], { isArcAdmin: false })).toEqual({ canEdit: true, canManageRoles: true });
  });

  it("an editor edits fixtures but not the roles list", () => {
    expect(qualityFixtureRightsFrom(["editor"], { isArcAdmin: false })).toEqual({ canEdit: true, canManageRoles: false });
  });

  it("an ARC admin gets ONLY the roles list", () => {
    expect(qualityFixtureRightsFrom([], { isArcAdmin: true })).toEqual({ canEdit: false, canManageRoles: true });
  });

  it("nobody on the list changes nothing", () => {
    expect(qualityFixtureRightsFrom([], { isArcAdmin: false })).toEqual(NO_QUALITY_FIXTURE_RIGHTS);
  });
});

describe("gates", () => {
  const editor = { rights: qualityFixtureRightsFrom(["editor"], { isArcAdmin: false }), resolving: false, failed: false };
  const nobody = { rights: NO_QUALITY_FIXTURE_RIGHTS, resolving: false, failed: false };

  it("allow the right holder, refuse everyone else with a reason", () => {
    expect(editFixturesGate(editor).allowed).toBe(true);
    expect(editFixturesGate(nobody)).toMatchObject({ allowed: false, resolving: false });
    expect(editFixturesGate(nobody).hint).toMatch(/Fixture Log editor/);
    expect(manageFixtureRolesGate(editor).allowed).toBe(false);
  });

  it("say 'checking' while the list loads, and refuse when it couldn't be read", () => {
    expect(editFixturesGate({ ...nobody, resolving: true })).toEqual({
      allowed: false,
      resolving: true,
      hint: "Checking your access…",
    });
    expect(editFixturesGate({ ...editor, failed: true })).toMatchObject({ allowed: false, resolving: false });
  });
});
