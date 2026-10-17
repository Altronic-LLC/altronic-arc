import { describe, it, expect, beforeEach } from "vitest";
import {
  createOpenOrdersRole,
  deleteOpenOrdersRole,
  listOpenOrdersRoles,
  parseOpenOrdersRoles,
  resetMockOpenOrdersRoles,
  serialiseOpenOrdersRoles,
  updateOpenOrdersRole,
} from "./openOrdersRoles";

// USE_MOCK is true under Vitest, so CRUD here exercises the in-memory branch.
// Same shape and rules as the EIR Roles list (see eirRoles.test.ts).

beforeEach(() => resetMockOpenOrdersRoles());

describe("parseOpenOrdersRoles", () => {
  it("keeps the known tag whatever its case or spacing", () => {
    expect(parseOpenOrdersRoles(" Report Manager ")).toEqual(["report manager"]);
  });

  // A typo in SharePoint should cost that one person the role, not break the
  // screen for everybody.
  it("drops unknown and blank tokens instead of failing", () => {
    expect(parseOpenOrdersRoles("report manager, admin, , reportmanager")).toEqual(["report manager"]);
    expect(parseOpenOrdersRoles("")).toEqual([]);
  });

  it("de-duplicates", () => {
    expect(parseOpenOrdersRoles("report manager,REPORT MANAGER")).toEqual(["report manager"]);
  });
});

describe("serialiseOpenOrdersRoles", () => {
  it("round-trips through parse and drops duplicates", () => {
    const csv = serialiseOpenOrdersRoles(["report manager", "report manager"]);
    expect(csv).toBe("report manager");
    expect(parseOpenOrdersRoles(csv)).toEqual(["report manager"]);
    expect(serialiseOpenOrdersRoles([])).toBe("");
  });
});

describe("mock CRUD", () => {
  it("seeds the demo user as a report manager so the tool is usable in the demo", async () => {
    const demo = (await listOpenOrdersRoles()).find((e) => e.email === "demo.user@altronic-llc.com");
    expect(demo?.roles).toEqual(["report manager"]);
  });

  it("hands out copies, so a caller can't edit the store by accident", async () => {
    const first = await listOpenOrdersRoles();
    first[0].roles.push("report manager");
    first[0].note = "changed";
    const again = await listOpenOrdersRoles();
    expect(again[0].note).not.toBe("changed");
    expect(again[0].roles).toHaveLength(first[0].roles.length - 1);
  });

  it("creates with the next id, updates in place and deletes", async () => {
    const before = await listOpenOrdersRoles();
    const created = await createOpenOrdersRole({
      email: "new.person@altronic-llc.com",
      displayName: "New Person",
      roles: [],
      note: "",
    });
    expect(created.id).toBe(Math.max(...before.map((e) => e.id)) + 1);

    const updated = await updateOpenOrdersRole(created.id, { ...created, roles: ["report manager"] });
    expect(updated.roles).toEqual(["report manager"]);
    expect((await listOpenOrdersRoles()).find((e) => e.id === created.id)?.roles).toEqual(["report manager"]);

    await deleteOpenOrdersRole(created.id);
    expect((await listOpenOrdersRoles()).some((e) => e.id === created.id)).toBe(false);
  });

  it("says which entry is missing when an update targets nothing", async () => {
    await expect(
      updateOpenOrdersRole(9999, { email: "x@y.com", displayName: "", roles: [], note: "" }),
    ).rejects.toThrow("No role entry with id 9999.");
  });

  it("treats deleting a missing entry as done", async () => {
    await expect(deleteOpenOrdersRole(9999)).resolves.toBeUndefined();
  });
});
