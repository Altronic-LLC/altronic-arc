import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// =============================================================================
// The Maintenance Roles list in REAL mode, at the request level.
//
// Two things here are invisible from mock mode and would only fail live:
//
//  1. **The list is on the PMO site**, with the work orders, the PM schedules
//     and the asset register it gates — NOT on Engineering with the EIR Roles
//     list it is otherwise a copy of. Pointing it at the wrong site collection
//     404s, and no mock test would ever notice.
//  2. **An unconfigured list reads as EMPTY, and refuses to write** — that is
//     the "gating is off" state, so listing must not throw and a write must
//     say what to set rather than silently no-op.
//  3. **The `Role` column (SINGULAR) is a SINGLE-VALUE choice** — Tech | Admin,
//     and single-vs-multi is unknown. The write negotiates: it tries a shape,
//     and on the hard 400 SharePoint answers with, tries the next. These cases
//     drive each shape by rejecting the others, so whichever the live list
//     turns out to be is already covered.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const listId = vi.hoisted(() => ({ value: "maint-roles-list-id" as string | undefined }));

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
    get SP_MAINTENANCE_ROLES_LIST_ID() {
      return listId.value;
    },
  };
});

import {
  addMaintenanceRole,
  listMaintenanceRoles,
  removeMaintenanceRole,
  resetObservedRolesShape,
  updateMaintenanceRole,
} from "./maintenanceRoles";
import { SITES } from "./config";

/** The `Role` value sent by each attempt, in order. */
function rolesAttempts(): unknown[] {
  return (graphFetch as Mock).mock.calls.map((c) => {
    const body = JSON.parse((c[1] as { body: string }).body);
    return "fields" in body ? body.fields.Role : body.Role;
  });
}

/**
 * Make graphFetch behave like a column that accepts only `accept`, rejecting
 * every other shape with the hard 400 SharePoint really answers with.
 */
function columnAccepting(accept: (roles: unknown) => boolean) {
  graphFetch.mockImplementation((_path: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    const roles = "fields" in body ? body.fields.Role : body.Role;
    if (roles !== undefined && !accept(roles)) {
      return Promise.reject(new Error("Graph 400 invalidRequest"));
    }
    return Promise.resolve({ id: "7", fields: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listId.value = "maint-roles-list-id";
  graphFetchAll.mockResolvedValue([]);
  graphFetch.mockResolvedValue({ id: "7", fields: {} });
  // Each case starts knowing nothing about the column, as a fresh session does.
  resetObservedRolesShape();
});

describe("listMaintenanceRoles (real)", () => {
  it("reads from the PMO site, not Engineering", async () => {
    await listMaintenanceRoles();
    const path = (graphFetchAll as Mock).mock.calls[0]![0] as string;
    expect(path).toContain(`/sites/${SITES.pmo}/`);
    expect(path).toContain("/lists/maint-roles-list-id/items");
    expect(path).not.toContain(SITES.engineering);
  });

  it("maps Title to the email and parses the Roles value", async () => {
    graphFetchAll.mockResolvedValue([
      {
        id: "4",
        fields: {
          Title: " David.Bulkley@altronic-llc.com ",
          DisplayName: "David Bulkley",
          Role: "TECH, admin",
          Note: "Second shift",
        },
      },
    ]);
    expect(await listMaintenanceRoles()).toEqual([
      {
        id: 4,
        email: "David.Bulkley@altronic-llc.com",
        displayName: "David Bulkley",
        roles: ["tech", "admin"],
        note: "Second shift",
      },
    ]);
  });

  // The multi-choice shape, which is what a CHOICE column would return.
  it("reads an ARRAY of choice values, whatever their casing", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "4", fields: { Title: "d@x.com", Role: ["Tech", "Admin"] } },
    ]);
    expect((await listMaintenanceRoles())[0]!.roles).toEqual(["tech", "admin"]);
  });

  // ...and the single-choice shape.
  it("reads a BARE choice value", async () => {
    graphFetchAll.mockResolvedValue([{ id: "4", fields: { Title: "d@x.com", Role: "Admin" } }]);
    expect((await listMaintenanceRoles())[0]!.roles).toEqual(["admin"]);
  });

  // What was read tells the writer which shape to lead with, so the usual
  // write is one request rather than three.
  it("learns the column's shape from a read, and writes that shape first", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "4", fields: { Title: "d@x.com", Role: ["Tech"] } },
    ]);
    await listMaintenanceRoles();
    await updateMaintenanceRole({ id: 4, roles: ["tech"] });
    expect(rolesAttempts()).toEqual([["tech"]]);
  });

  it("tolerates a row with no name, note or tags", async () => {
    graphFetchAll.mockResolvedValue([{ id: "5", fields: { Title: "x@y.com" } }]);
    expect(await listMaintenanceRoles()).toEqual([
      { id: 5, email: "x@y.com", displayName: "", roles: [], note: "" },
    ]);
  });

  // An unconfigured list is the "gating off" state, not a fault: it must not
  // throw, and it must not fire a request at a list id of `undefined`.
  it("returns nothing, and asks Graph for nothing, when the list isn't configured", async () => {
    listId.value = undefined;
    expect(await listMaintenanceRoles()).toEqual([]);
    expect(graphFetchAll).not.toHaveBeenCalled();
  });
});

describe("writes (real)", () => {
  it("POSTs Title = email and the other fields, to the PMO site", async () => {
    await addMaintenanceRole({
      email: "new.tech@altronic-llc.com",
      displayName: "New Tech",
      roles: ["admin", "tech"],
      note: "hired Monday",
    });
    const [path, init] = (graphFetch as Mock).mock.calls[0]!;
    expect(path).toContain(`/sites/${SITES.pmo}/lists/maint-roles-list-id/items`);
    expect(init.method).toBe("POST");
    const { fields } = JSON.parse(init.body as string);
    expect(fields.Title).toBe("new.tech@altronic-llc.com");
    expect(fields.DisplayName).toBe("New Tech");
    expect(fields.Note).toBe("hired Monday");
  });

  it("leaves a blank name / note out of the POST rather than writing empty strings", async () => {
    await addMaintenanceRole({
      email: "bare@altronic-llc.com",
      displayName: "",
      roles: [],
      note: "",
    });
    const body = JSON.parse((graphFetch as Mock).mock.calls[0]![1].body as string);
    expect(Object.keys(body.fields).sort()).toEqual(["Role", "Title"]);
    expect(body.fields.Title).toBe("bare@altronic-llc.com");
  });

  it("PATCHes only the keys it was given", async () => {
    await updateMaintenanceRole({ id: 4, roles: ["tech"], displayName: undefined });
    const [path, init] = (graphFetch as Mock).mock.calls[0]!;
    expect(path).toBe(`/sites/${SITES.pmo}/lists/maint-roles-list-id/items/4/fields`);
    expect(init.method).toBe("PATCH");
    expect(Object.keys(JSON.parse(init.body as string))).toEqual(["Role"]);
  });

  // A write that carries no roles at all must not run the shape negotiation —
  // there is nothing to negotiate, and a retry loop over an unrelated failure
  // would send the same rejected request three times.
  it("sends a roles-less update once, whatever the column is", async () => {
    columnAccepting(() => false);
    await expect(updateMaintenanceRole({ id: 4, note: "moved shift" })).resolves.toBeUndefined();
    expect(graphFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((graphFetch as Mock).mock.calls[0]![1].body as string)).toEqual({
      Note: "moved shift",
    });
  });
});

// =============================================================================
// The `Roles` column's shape. Unconfirmed, so the write negotiates rather than
// depending on it — one case per shape the column could turn out to be.
// =============================================================================
describe("the Roles column's shape", () => {
  it("writes a PLAIN array to a multi-value choice column", async () => {
    columnAccepting((roles) => Array.isArray(roles));
    await updateMaintenanceRole({ id: 4, roles: ["tech", "admin"] });
    expect(rolesAttempts().at(-1)).toEqual(["tech", "admin"]);
  });

  it("falls back to the CSV for a text column", async () => {
    columnAccepting((roles) => typeof roles === "string" && roles.includes(","));
    await updateMaintenanceRole({ id: 4, roles: ["tech", "admin"] });
    expect(rolesAttempts().at(-1)).toBe("tech,admin");
  });

  // A single-value column can only hold one, and the higher tag loses nothing:
  // `admin` implies `tech` (see lib/maintenanceRoles.ts).
  it("falls back to ONE bare value for a single-value choice column", async () => {
    columnAccepting((roles) => roles === "admin" || roles === "tech" || roles === "");
    await updateMaintenanceRole({ id: 4, roles: ["tech", "admin"] });
    expect(rolesAttempts().at(-1)).toBe("admin");
  });

  it("does the same on a CREATE, and a rejected attempt creates nothing", async () => {
    columnAccepting((roles) => roles === "admin");
    const created = await addMaintenanceRole({
      email: "a@b.com",
      displayName: "",
      roles: ["tech", "admin"],
      note: "",
    });
    expect(rolesAttempts().at(-1)).toBe("admin");
    expect(created.id).toBe(7);
  });

  // Once a shape is proven, the session leads with it — so the ordinary write
  // is one request, not three.
  it("remembers the shape that worked, for the next write", async () => {
    columnAccepting((roles) => typeof roles === "string" && !roles.includes(","));
    await updateMaintenanceRole({ id: 4, roles: ["admin"] });
    vi.clearAllMocks();
    columnAccepting((roles) => typeof roles === "string" && !roles.includes(","));
    await updateMaintenanceRole({ id: 5, roles: ["admin"] });
    expect(rolesAttempts()).toEqual(["admin"]);
  });

  // A 400 for an unrelated reason still surfaces, rather than being swallowed
  // once the shapes run out.
  it("throws the last failure when no shape is accepted", async () => {
    columnAccepting(() => false);
    await expect(updateMaintenanceRole({ id: 4, roles: ["tech"] })).rejects.toThrow(/400/);
  });

  it("DELETEs the item", async () => {
    await removeMaintenanceRole(4);
    const [path, init] = (graphFetch as Mock).mock.calls[0]!;
    expect(path).toBe(`/sites/${SITES.pmo}/lists/maint-roles-list-id/items/4`);
    expect(init.method).toBe("DELETE");
  });

  // A write against a list that doesn't exist must name the variable to set,
  // not fail somewhere deep in Graph with a path containing "undefined".
  it("refuses every write when the list isn't configured, naming the env var", async () => {
    listId.value = undefined;
    await expect(
      addMaintenanceRole({ email: "a@b.com", displayName: "", roles: [], note: "" }),
    ).rejects.toThrow(/VITE_SP_MAINTENANCE_ROLES_LIST_ID/);
    await expect(updateMaintenanceRole({ id: 1, roles: [] })).rejects.toThrow(
      /VITE_SP_MAINTENANCE_ROLES_LIST_ID/,
    );
    await expect(removeMaintenanceRole(1)).rejects.toThrow(
      /VITE_SP_MAINTENANCE_ROLES_LIST_ID/,
    );
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
