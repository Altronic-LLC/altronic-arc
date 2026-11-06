import { describe, expect, it } from "vitest";
import {
  NO_PLANT_MAP_RIGHTS,
  editLayoutGate,
  managePlantMapRolesGate,
  parsePlantMapRoles,
  plantMapRightsFrom,
  publishLayoutGate,
  serializePlantMapRoles,
  type PlantMapAccess,
} from "./plantMapRoles";

const access = (rights: PlantMapAccess["rights"]): PlantMapAccess => ({ rights, resolving: false, failed: false });

describe("parsePlantMapRoles / serializePlantMapRoles", () => {
  it("reads a CSV, an array or a single value, any case, unknown tags dropped", () => {
    expect(parsePlantMapRoles("Admin, editor")).toEqual(["editor", "admin"]);
    expect(parsePlantMapRoles(["EDITOR", "Viewer", "owner"])).toEqual(["viewer", "editor"]);
    expect(parsePlantMapRoles("admin")).toEqual(["admin"]);
    expect(parsePlantMapRoles(undefined)).toEqual([]);
  });

  it("writes lowercase CSV in canonical order", () => {
    expect(serializePlantMapRoles(["admin", "editor", "viewer"])).toBe("viewer,editor,admin");
  });
});

describe("plantMapRightsFrom", () => {
  it("gives an admin everything, editor included", () => {
    expect(plantMapRightsFrom(["admin"], { isArcAdmin: false })).toEqual({
      canOpen: true,
      canEdit: true,
      canPublish: true,
      canManageRoles: true,
    });
  });

  it("lets an editor edit but not publish or manage roles", () => {
    expect(plantMapRightsFrom(["editor"], { isArcAdmin: false })).toEqual({
      canOpen: true,
      canEdit: true,
      canPublish: false,
      canManageRoles: false,
    });
  });

  it("gives a viewer a way in and nothing else", () => {
    expect(plantMapRightsFrom(["viewer"], { isArcAdmin: false })).toEqual({ ...NO_PLANT_MAP_RIGHTS, canOpen: true });
  });

  it("gives an ARC admin ONLY the roles list — not even a way in to the map", () => {
    expect(plantMapRightsFrom([], { isArcAdmin: true })).toEqual({
      canOpen: false,
      canEdit: false,
      canPublish: false,
      canManageRoles: true,
    });
  });

  it("gives somebody not on the list nothing at all", () => {
    expect(plantMapRightsFrom([], { isArcAdmin: false })).toEqual(NO_PLANT_MAP_RIGHTS);
  });
});

describe("the gates", () => {
  it("say 'checking' while resolving, never a refusal", () => {
    const gate = editLayoutGate({ rights: NO_PLANT_MAP_RIGHTS, resolving: true, failed: false });
    expect(gate).toEqual({ allowed: false, resolving: true, hint: "Checking your access…" });
  });

  it("refuse when the roles list couldn't be read", () => {
    const gate = editLayoutGate({ rights: plantMapRightsFrom(["admin"], { isArcAdmin: false }), resolving: false, failed: true });
    expect(gate.allowed).toBe(false);
    expect(gate.hint).toMatch(/Couldn't check/);
  });

  it("each ask their own right", () => {
    const editor = access(plantMapRightsFrom(["editor"], { isArcAdmin: false }));
    expect(editLayoutGate(editor).allowed).toBe(true);
    expect(publishLayoutGate(editor).allowed).toBe(false);
    expect(managePlantMapRolesGate(editor)).toMatchObject({ allowed: false, hint: expect.stringMatching(/Plant Map admin or an ARC admin/) });
  });
});
