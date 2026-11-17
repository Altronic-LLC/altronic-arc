import { describe, expect, it } from "vitest";
import { hrRightsFrom, manageHrRolesGate, newHireGate, parseHrRoles, serializeHrRoles, type HrAccess } from "./hrRoles";

const access = (roles: Parameters<typeof hrRightsFrom>[0], isArcAdmin = false): HrAccess => ({
  rights: hrRightsFrom(roles, { isArcAdmin }),
  resolving: false,
  failed: false,
});

describe("parsing the Roles column", () => {
  it("reads a CSV, an array or nothing, in canonical order, dropping unknown tags", () => {
    expect(parseHrRoles("Admin, new hire, payroll")).toEqual(["new hire", "admin"]);
    expect(parseHrRoles(["new hire it"])).toEqual(["new hire it"]);
    expect(parseHrRoles(null)).toEqual([]);
    expect(serializeHrRoles(["admin", "new hire sap"])).toBe("new hire sap,admin");
  });
});

describe("who may do what", () => {
  it("gives nobody anything without a role — HR is hidden", () => {
    expect(hrRightsFrom([], { isArcAdmin: false })).toEqual({ canOpen: false, canNewHire: false, canManage: false });
  });

  it("lets every New Hire tag open and edit new hires", () => {
    for (const tag of ["new hire", "new hire sap", "new hire it"] as const) {
      expect(newHireGate(access([tag])).allowed).toBe(true);
      expect(manageHrRolesGate(access([tag])).allowed).toBe(false);
    }
  });

  it("gives an HR admin everything", () => {
    expect(hrRightsFrom(["admin"], { isArcAdmin: false })).toEqual({ canOpen: true, canNewHire: true, canManage: true });
  });

  it("gives an ARC admin ONLY the list — never the new hires' details", () => {
    const rights = hrRightsFrom([], { isArcAdmin: true });
    expect(rights).toEqual({ canOpen: true, canNewHire: false, canManage: true });
    expect(newHireGate(access([], true)).allowed).toBe(false);
  });

  it("says it's checking while the list loads, and refuses when it couldn't read it", () => {
    expect(newHireGate({ rights: hrRightsFrom(["new hire"], { isArcAdmin: false }), resolving: true, failed: false })).toMatchObject({
      allowed: false,
      resolving: true,
    });
    expect(newHireGate({ rights: hrRightsFrom([], { isArcAdmin: false }), resolving: false, failed: true }).hint).toMatch(/Couldn't check/);
  });
});
