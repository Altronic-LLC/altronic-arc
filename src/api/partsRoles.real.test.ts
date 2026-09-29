import { beforeEach, describe, expect, it, vi } from "vitest";

// Parts Roles in REAL mode: the request shapes, and what an unset list id does.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => ({ listId: "roles-list" as string | undefined }));

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, engineering: "engineering-site" },
    get SP_PARTS_ROLES_LIST_ID() {
      return config.listId;
    },
  };
});

import { addPartsRole, listPartsRoles, removePartsRole, updatePartsRole } from "./partsRoles";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  config.listId = "roles-list";
});

describe("Parts Roles (real mode)", () => {
  it("reads Title as the email and parses the Roles CSV", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "4", fields: { Title: "sheila.horn@altronic-llc.com", PersonName: "Sheila Horn", Roles: "sap admin", Note: "" } },
    ]);
    const entries = await listPartsRoles();
    expect(graphFetchAll.mock.calls[0][0]).toBe(
      "/sites/engineering-site/lists/roles-list/items?$expand=fields($select=Title,PersonName,Roles,Note)&$top=200",
    );
    expect(entries).toEqual([
      { id: 4, email: "sheila.horn@altronic-llc.com", displayName: "Sheila Horn", roles: ["sap admin"], note: "" },
    ]);
  });

  it("writes a lowercased email and a canonical CSV", async () => {
    graphFetch.mockResolvedValue({ id: "9", fields: { Title: "a@altronic-llc.com", Roles: "editor, hco editor" } });
    await addPartsRole({ email: " A@Altronic-LLC.com ", displayName: "A", roles: ["hco editor", "editor"], note: "" });
    const [path, init] = graphFetch.mock.calls[0];
    expect(path).toBe("/sites/engineering-site/lists/roles-list/items");
    // PersonName, never DisplayName — Graph silently drops a field by that name.
    expect(JSON.parse(init.body)).toEqual({
      fields: { Title: "a@altronic-llc.com", Roles: "editor, hco editor", PersonName: "A" },
    });
  });

  it("patches only what it's given, and deletes by id", async () => {
    await updatePartsRole({ id: 4, roles: ["sap admin", "editor"] });
    expect(graphFetch.mock.calls[0][0]).toBe("/sites/engineering-site/lists/roles-list/items/4/fields");
    expect(JSON.parse(graphFetch.mock.calls[0][1].body)).toEqual({ Roles: "editor, sap admin" });
    await removePartsRole(4);
    expect(graphFetch.mock.calls[1]).toEqual(["/sites/engineering-site/lists/roles-list/items/4", { method: "DELETE" }]);
  });

  it("with no list configured, reads nobody and refuses every write", async () => {
    config.listId = undefined;
    expect(await listPartsRoles()).toEqual([]);
    await expect(addPartsRole({ email: "a@b.c", displayName: "", roles: ["editor"], note: "" })).rejects.toThrow(
      /isn't configured/,
    );
    await expect(updatePartsRole({ id: 1, roles: [] })).rejects.toThrow(/isn't configured/);
    await expect(removePartsRole(1)).rejects.toThrow(/isn't configured/);
    expect(graphFetch).not.toHaveBeenCalled();
    expect(graphFetchAll).not.toHaveBeenCalled();
  });
});
