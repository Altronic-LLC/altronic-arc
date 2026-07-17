import { describe, it, expect } from "vitest";
import { panelRights } from "./panelRoles";

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
