import { describe, it, expect } from "vitest";
import { capacityPeople, panelRights, panelTeamAccess } from "./panelRoles";
import type { PanelRole, PanelRoleEntry } from "@/types/task";

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

describe("capacityPeople", () => {
  const row = (id: number, name: string, role: PanelRole, onCapacity = false): PanelRoleEntry => ({
    id,
    user: { displayName: name, email: `${name.toLowerCase()}@example.com`, lookupId: id },
    role,
    note: "",
    onCapacity,
  });

  it("gives every Engineer a row, and anyone else only when On capacity is set", () => {
    const people = capacityPeople([
      row(1, "Ana", "Engineer"),
      row(2, "Ben", "Manager", true),
      row(3, "Cy", "Tech"),
      row(4, "Di", "Engineer", false),
    ]);
    expect(people.map((p) => p.displayName)).toEqual(["Ana", "Ben", "Di"]);
  });

  it("gives a person one row however many role rows they have", () => {
    const people = capacityPeople([row(1, "Ana", "Engineer"), { ...row(5, "Ana", "Super User", true), user: row(1, "Ana", "Engineer").user }]);
    expect(people).toHaveLength(1);
  });

  it("skips a row with nobody on it", () => {
    expect(capacityPeople([{ ...row(1, "Ana", "Engineer"), user: null }])).toEqual([]);
  });
});

describe("panelTeamAccess: the BOM Builder's limited live demo (BusinessIT#59)", () => {
  const demo = (roles: PanelRole[], isArcAdmin = false) =>
    panelTeamAccess({ roles, isArcAdmin, resolving: false, bomLive: false });
  const live = (roles: PanelRole[], isArcAdmin = false) =>
    panelTeamAccess({ roles, isArcAdmin, resolving: false, bomLive: true });

  it("during the demo, only a panel Super User opens, builds and manages it", () => {
    const su = demo(["Super User"]);
    expect([su.canOpenBom, su.canBuildBom, su.canManageBomParts]).toEqual([true, true, true]);
    for (const role of ["Engineer", "Manager", "Admin", "Tech", "Viewer"] as PanelRole[]) {
      const a = demo([role]);
      expect([a.canOpenBom, a.canBuildBom, a.canManageBomParts]).toEqual([false, false, false]);
      expect(a.bomHint).toMatch(/coming soon/);
    }
  });

  it("during the demo, an ARC admin who isn't a Super User is kept out too", () => {
    const a = demo([], true);
    expect([a.canOpenBom, a.canManageBomParts]).toEqual([false, false]);
  });

  it("once live, the panel team opens it, a Viewer can't save, and parts stay Super User / ARC admin", () => {
    expect(live(["Engineer"]).canOpenBom).toBe(true);
    expect(live(["Engineer"]).canBuildBom).toBe(true);
    expect(live(["Engineer"]).canManageBomParts).toBe(false);
    expect(live(["Viewer"]).canOpenBom).toBe(true);
    expect(live(["Viewer"]).canBuildBom).toBe(false);
    expect(live([], true).canManageBomParts).toBe(true);
    expect(live([]).canOpenBom).toBe(false);
  });

  it("is neither yes nor no while the lists load", () => {
    const a = panelTeamAccess({ roles: [], isArcAdmin: false, resolving: true, bomLive: false });
    expect(a.bomResolving).toBe(true);
    expect(a.bomHint).toMatch(/Checking/);
  });
});
