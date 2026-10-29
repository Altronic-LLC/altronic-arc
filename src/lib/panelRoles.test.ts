import { describe, it, expect } from "vitest";
import { panelRights, panelTeamAccess } from "./panelRoles";

describe("panelRights", () => {
  it("no roles → no rights", () => {
    expect(panelRights([])).toEqual({ production: false, engineering: false });
  });

  it("Tech and Manager grant production only", () => {
    expect(panelRights(["Tech"])).toEqual({ production: true, engineering: false });
    expect(panelRights(["Manager"])).toEqual({ production: true, engineering: false });
  });

  it("Engineer grants engineering only", () => {
    expect(panelRights(["Engineer"])).toEqual({ production: false, engineering: true });
  });

  it("Admin and Super User grant both", () => {
    expect(panelRights(["Admin"])).toEqual({ production: true, engineering: true });
    expect(panelRights(["Super User"])).toEqual({ production: true, engineering: true });
  });

  it("Viewer grants neither", () => {
    expect(panelRights(["Viewer"])).toEqual({ production: false, engineering: false });
  });

  it("rights union across multiple role rows", () => {
    expect(panelRights(["Tech", "Engineer"])).toEqual({ production: true, engineering: true });
    expect(panelRights(["Viewer", "Manager"])).toEqual({ production: true, engineering: false });
  });
});

describe("panelTeamAccess", () => {
  it("lets anyone on the list open, and anyone but a Viewer edit", () => {
    expect(panelTeamAccess({ roles: ["Engineer"], isArcAdmin: false, resolving: false })).toMatchObject({
      canOpen: true,
      canEdit: true,
      hint: "",
    });
    const viewer = panelTeamAccess({ roles: ["Viewer"], isArcAdmin: false, resolving: false });
    expect(viewer).toMatchObject({ canOpen: true, canEdit: false });
    expect(viewer.hint).toMatch(/Viewers/);
  });

  it("keeps everyone else out, and says who to ask", () => {
    const out = panelTeamAccess({ roles: [], isArcAdmin: false, resolving: false });
    expect(out).toMatchObject({ canOpen: false, canEdit: false });
    expect(out.hint).toMatch(/ARC admin/);
  });

  it("lets an ARC admin in with no role, so the list is never locked from inside", () => {
    expect(panelTeamAccess({ roles: [], isArcAdmin: true, resolving: false })).toMatchObject({
      canOpen: true,
      canEdit: true,
    });
  });

  it("says 'checking' rather than 'no' while the lists load — but a yes is final", () => {
    expect(panelTeamAccess({ roles: [], isArcAdmin: false, resolving: true })).toMatchObject({
      resolving: true,
      hint: "Checking your panel team access…",
    });
    expect(panelTeamAccess({ roles: ["Tech"], isArcAdmin: false, resolving: true }).resolving).toBe(false);
  });
});

describe("panelTeamAccess: the standard tasks (Panel Task Templates)", () => {
  const manages = (roles: Parameters<typeof panelTeamAccess>[0]["roles"], isArcAdmin = false) =>
    panelTeamAccess({ roles, isArcAdmin, resolving: false }).canManageTemplates;

  it("is for a panel Manager, Admin or Super User, or an ARC admin", () => {
    expect(manages(["Manager"])).toBe(true);
    expect(manages(["Admin"])).toBe(true);
    expect(manages(["Super User"])).toBe(true);
    expect(manages([], true)).toBe(true);
  });

  it("is not for an Engineer, Tech or Viewer — and says who can", () => {
    for (const role of ["Engineer", "Tech", "Viewer"] as const) expect(manages([role])).toBe(false);
    expect(panelTeamAccess({ roles: ["Engineer"], isArcAdmin: false, resolving: false }).templatesHint).toMatch(
      /Manager, Admin or Super User/,
    );
  });

  it("says 'checking' while the lists load", () => {
    expect(panelTeamAccess({ roles: [], isArcAdmin: false, resolving: true }).templatesHint).toMatch(/Checking/);
  });
});

describe("panelTeamAccess: capacity settings and company holidays", () => {
  it("is for a panel Super User or an ARC admin only", () => {
    const can = (roles: Parameters<typeof panelTeamAccess>[0]["roles"], isArcAdmin = false) =>
      panelTeamAccess({ roles, isArcAdmin, resolving: false }).canManageCapacity;
    expect(can(["Super User"])).toBe(true);
    expect(can([], true)).toBe(true);
    for (const role of ["Admin", "Manager", "Engineer", "Tech", "Viewer"] as const) expect(can([role])).toBe(false);
    expect(panelTeamAccess({ roles: ["Manager"], isArcAdmin: false, resolving: false }).capacityHint).toMatch(
      /Super User/,
    );
  });
});
