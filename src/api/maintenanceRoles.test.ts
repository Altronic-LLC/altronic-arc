import { describe, it, expect, beforeEach } from "vitest";
import {
  addMaintenanceRole,
  detectRolesShape,
  listMaintenanceRoles,
  parseRoles,
  removeMaintenanceRole,
  resetMaintenanceRolesMockStore,
  rolesFieldValue,
  serializeRoles,
  updateMaintenanceRole,
} from "./maintenanceRoles";

// USE_MOCK defaults to true under Vitest (no VITE_USE_MOCK env), so the CRUD
// cases here exercise the in-memory mock branch. The real branch has its own
// file — maintenanceRoles.real.test.ts — because the thing worth pinning there
// (which SITE the list is on) is invisible from mock mode.

beforeEach(() => {
  resetMaintenanceRolesMockStore();
});

// =============================================================================
// `Roles` is a CHOICE column, and whether it is single- or multi-value is not
// confirmed. Graph hands those back three different ways, so there is a case
// per shape: whichever the live list turns out to be is already covered.
// =============================================================================
describe("parseRoles accepts every shape the column could return", () => {
  it("a CSV string — a text column", () => {
    expect(parseRoles("tech,admin")).toEqual(["tech", "admin"]);
    expect(parseRoles("admin,tech")).toEqual(["tech", "admin"]);
  });

  it("a string ARRAY — a multi-value choice column", () => {
    expect(parseRoles(["Tech", "Admin"])).toEqual(["tech", "admin"]);
    expect(parseRoles(["Admin"])).toEqual(["admin"]);
  });

  it("a bare string — a single-value choice column", () => {
    expect(parseRoles("Admin")).toEqual(["admin"]);
    expect(parseRoles("Tech")).toEqual(["tech"]);
  });

  it("nothing at all", () => {
    expect(parseRoles("")).toEqual([]);
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
    expect(parseRoles([])).toEqual([]);
  });

  // The choice values' CASING is unknown too, and it doesn't matter.
  it("any casing, in any shape", () => {
    expect(parseRoles("ADMIN")).toEqual(["admin"]);
    expect(parseRoles(["  TeCh  "])).toEqual(["tech"]);
    expect(parseRoles("Tech, ADMIN")).toEqual(["tech", "admin"]);
  });

  it("an array whose entries are themselves comma-joined", () => {
    expect(parseRoles(["tech,admin"])).toEqual(["tech", "admin"]);
  });

  it("junk of the wrong type, without throwing", () => {
    expect(parseRoles(42)).toEqual([]);
    expect(parseRoles({})).toEqual([]);
    expect(parseRoles([1, null, "tech"])).toEqual(["tech"]);
  });
});

describe("parseRoles", () => {
  it("keeps known tags and drops unknown / blank tokens", () => {
    expect(parseRoles("tech,admin")).toEqual(["tech", "admin"]);
    expect(parseRoles("TECH , , technician")).toEqual(["tech"]);
    expect(parseRoles("")).toEqual([]);
  });

  // A typo in a hand-typed SharePoint column must grant nothing rather than
  // break the screen — and the admin table is where it gets noticed.
  it("drops an unrecognised tag entirely rather than keeping it", () => {
    expect(parseRoles("supervisor")).toEqual([]);
    expect(parseRoles("engineer,supply chain")).toEqual([]);
  });

  it("de-duplicates and returns canonical order regardless of input order", () => {
    expect(parseRoles("admin,tech,tech,admin")).toEqual(["tech", "admin"]);
  });

  it("tolerates the separators people actually type", () => {
    expect(parseRoles(" tech , admin ")).toEqual(["tech", "admin"]);
    expect(parseRoles("tech,")).toEqual(["tech"]);
  });
});

describe("serializeRoles", () => {
  it("joins in canonical order and ignores duplicates", () => {
    expect(serializeRoles(["admin", "tech"])).toBe("tech,admin");
    expect(serializeRoles(["tech", "tech"])).toBe("tech");
    expect(serializeRoles([])).toBe("");
  });

  it("round-trips with parseRoles", () => {
    expect(parseRoles(serializeRoles(["admin"]))).toEqual(["admin"]);
    expect(parseRoles(serializeRoles(["tech", "admin"]))).toEqual(["tech", "admin"]);
  });
});

describe("rolesFieldValue", () => {
  it("sends a PLAIN array for a multi-choice column — no @odata.type", () => {
    expect(rolesFieldValue(["admin", "tech"], "array")).toEqual(["tech", "admin"]);
    expect(rolesFieldValue([], "array")).toEqual([]);
  });

  it("sends the CSV for a text column", () => {
    expect(rolesFieldValue(["admin", "tech"], "csv")).toBe("tech,admin");
    expect(rolesFieldValue([], "csv")).toBe("");
  });

  // A single-choice column can only hold one value, and the higher tag loses
  // nothing: `admin` implies `tech`.
  it("sends ONE value for a single-choice column, the higher tag winning", () => {
    expect(rolesFieldValue(["tech", "admin"], "single")).toBe("admin");
    expect(rolesFieldValue(["admin"], "single")).toBe("admin");
    expect(rolesFieldValue(["tech"], "single")).toBe("tech");
    expect(rolesFieldValue([], "single")).toBe("");
  });
});

describe("detectRolesShape", () => {
  it("reads an array as conclusive proof of a multi-value column", () => {
    expect(detectRolesShape(["Tech"])).toBe("array");
    expect(detectRolesShape([])).toBe("array");
  });

  // No choice column would hold one value spelled "tech,admin".
  it("reads a comma in a string as proof of a text column", () => {
    expect(detectRolesShape("tech,admin")).toBe("csv");
  });

  // Single choice, or a text column holding one tag — it settles nothing.
  it("treats a bare string as ambiguous", () => {
    expect(detectRolesShape("admin")).toBeNull();
    expect(detectRolesShape("")).toBeNull();
  });

  it("settles nothing for a missing value", () => {
    expect(detectRolesShape(null)).toBeNull();
    expect(detectRolesShape(undefined)).toBeNull();
  });
});

describe("maintenanceRoles mock CRUD", () => {
  it("lists the seeded entries, demo user holding both tags", async () => {
    const entries = await listMaintenanceRoles();
    const demo = entries.find((e) => e.email === "demo.user@altronic-llc.com");
    expect(demo).toBeDefined();
    expect(demo!.roles).toEqual(["tech", "admin"]);
  });

  it("seeds a tech-only and an admin-only row, so the single-tag cases are demoable", async () => {
    const entries = await listMaintenanceRoles();
    expect(entries.some((e) => e.roles.length === 1 && e.roles[0] === "tech")).toBe(true);
    expect(entries.some((e) => e.roles.length === 1 && e.roles[0] === "admin")).toBe(true);
  });

  it("hands out copies, so a caller can't mutate the store through its result", async () => {
    const first = await listMaintenanceRoles();
    first[0]!.roles.push("admin");
    first[0]!.email = "hacked@example.com";
    const second = await listMaintenanceRoles();
    expect(second[0]!.email).toBe("demo.user@altronic-llc.com");
    expect(second[0]!.roles).toEqual(["tech", "admin"]);
  });

  it("adds a new entry", async () => {
    const before = await listMaintenanceRoles();
    const created = await addMaintenanceRole({
      email: "new.tech@altronic-llc.com",
      displayName: "New Tech",
      roles: ["tech"],
      note: "added in test",
    });
    expect(created.id).toBeGreaterThan(0);
    const after = await listMaintenanceRoles();
    expect(after.length).toBe(before.length + 1);
    expect(after.find((e) => e.id === created.id)?.roles).toEqual(["tech"]);
  });

  // The two modes have to agree about what a row means, or a demo and a live
  // site behave differently for the same data.
  it("validates on the way in, in mock mode too", async () => {
    const created = await addMaintenanceRole({
      email: "odd@altronic-llc.com",
      displayName: "Odd",
      // @ts-expect-error — deliberately the shape a bad SharePoint row has.
      roles: ["tech", "supervisor"],
      note: "",
    });
    expect(created.roles).toEqual(["tech"]);
  });

  it("updates roles, name and note, leaving the rest alone", async () => {
    await updateMaintenanceRole({ id: 2, roles: ["tech", "admin"] });
    let entries = await listMaintenanceRoles();
    expect(entries.find((e) => e.id === 2)?.roles).toEqual(["tech", "admin"]);
    expect(entries.find((e) => e.id === 2)?.displayName).toBe("David Bulkley");

    await updateMaintenanceRole({ id: 2, displayName: "Dave Bulkley", note: "moved shift" });
    entries = await listMaintenanceRoles();
    const row = entries.find((e) => e.id === 2)!;
    expect(row.displayName).toBe("Dave Bulkley");
    expect(row.note).toBe("moved shift");
    // Untouched by a name/note edit.
    expect(row.roles).toEqual(["tech", "admin"]);
  });

  it("can strip every tag from a row without removing it", async () => {
    await updateMaintenanceRole({ id: 2, roles: [] });
    const entries = await listMaintenanceRoles();
    expect(entries.find((e) => e.id === 2)?.roles).toEqual([]);
  });

  it("ignores an update for an id that isn't there", async () => {
    const before = await listMaintenanceRoles();
    await expect(updateMaintenanceRole({ id: 9999, roles: ["admin"] })).resolves.toBeUndefined();
    expect(await listMaintenanceRoles()).toEqual(before);
  });

  it("removes an entry", async () => {
    const before = await listMaintenanceRoles();
    await removeMaintenanceRole(3);
    const after = await listMaintenanceRoles();
    expect(after.length).toBe(before.length - 1);
    expect(after.some((e) => e.id === 3)).toBe(false);
  });

  it("ignores a remove for an id that isn't there", async () => {
    const before = await listMaintenanceRoles();
    await removeMaintenanceRole(9999);
    expect(await listMaintenanceRoles()).toEqual(before);
  });

  it("resets the store between tests", async () => {
    await removeMaintenanceRole(1);
    expect((await listMaintenanceRoles()).some((e) => e.id === 1)).toBe(false);
    resetMaintenanceRolesMockStore();
    expect((await listMaintenanceRoles()).some((e) => e.id === 1)).toBe(true);
  });
});
