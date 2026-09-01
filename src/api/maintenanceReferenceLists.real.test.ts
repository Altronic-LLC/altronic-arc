import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The two CMMS reference lists in REAL mode — the request shapes.
//
// CLAUDE.md is explicit that this class of thing is INVISIBLE from mock mode.
// Two shapes matter here and neither is visible from a rendered page:
//
//  1. **`Active` is ALWAYS sent on a create.** A null Active reads as blank in
//     SharePoint's own views, and a value that is neither on nor off is one
//     nobody can tell the state of — the same rule a PM schedule's Active
//     follows.
//  2. **Retiring writes `Active` ALONE.** Re-sending the title would silently
//     revert a rename somebody else made a moment earlier.
//
// The bare-integer lookup WRITES that point AT these lists live in
// maintenanceTasks.people.test.ts and scheduledMaintenance.people.test.ts.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

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
    // Force the REAL branch — the mock branch is what hides all of this.
    USE_MOCK: false,
    SP_MAINTENANCE_DEPARTMENTS_LIST_ID: "dept-list",
    SP_MAINTENANCE_LOCATIONS_LIST_ID: "loc-list",
  };
});

import {
  createMaintenanceReferenceValue,
  listMaintenanceReferenceValues,
  setMaintenanceReferenceValueActive,
  updateMaintenanceReferenceValue,
} from "./maintenanceReferenceLists";

function row(id: string, fields: Record<string, unknown>) {
  return { id, fields };
}

/** The body of the one PATCH that was sent. */
function patchedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
  );
  if (!call) throw new Error("no PATCH was sent");
  return JSON.parse(String((call[1] as RequestInit).body));
}

/** The `fields` of the one POST that was sent. */
function postedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
  if (!call) throw new Error("no POST was sent");
  return JSON.parse(String((call[1] as RequestInit).body)).fields;
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetchAll.mockResolvedValue([row("4", { Title: "MACH SHOP", Active: true, Note: "" })]);
});

describe("reads", () => {
  it("selects the three columns off the right list", async () => {
    await listMaintenanceReferenceValues("locations");
    const path = String(graphFetchAll.mock.calls[0][0]);
    expect(path).toContain("/lists/loc-list/items");
    expect(path).toContain("$select=Title,Active,Note");
  });

  it("reads departments off the OTHER list", async () => {
    await listMaintenanceReferenceValues("departments");
    expect(String(graphFetchAll.mock.calls[0][0])).toContain("/lists/dept-list/items");
  });
});

describe("createMaintenanceReferenceValue", () => {
  it("POSTs Title, Note and an EXPLICIT Active", async () => {
    graphFetch.mockResolvedValue(row("11", { Title: "TOOL ROOM", Active: true, Note: "" }));
    const created = await createMaintenanceReferenceValue("departments", { title: "TOOL ROOM" });
    // Active is never omitted — see the note at the top of this file.
    expect(postedFields()).toEqual({ Title: "TOOL ROOM", Active: true, Note: "" });
    expect(created).toEqual({ lookupId: 11, title: "TOOL ROOM", active: true, note: "" });
  });

  it("POSTs to the list the kind names", async () => {
    graphFetch.mockResolvedValue(row("11", { Title: "BAY 4", Active: true, Note: "" }));
    await createMaintenanceReferenceValue("locations", { title: "BAY 4" });
    expect(String(graphFetch.mock.calls[0][0])).toContain("/lists/loc-list/items");
  });
});

describe("updateMaintenanceReferenceValue", () => {
  it("PATCHes the row's fields and reads the list back", async () => {
    graphFetch.mockResolvedValue({});
    graphFetchAll.mockResolvedValue([row("4", { Title: "MACHINE SHOP", Active: true, Note: "" })]);
    const updated = await updateMaintenanceReferenceValue("departments", 4, {
      title: "MACHINE SHOP",
    });
    expect(String(graphFetch.mock.calls[0][0])).toContain("/lists/dept-list/items/4/fields");
    expect(patchedFields()).toEqual({ Title: "MACHINE SHOP", Active: true, Note: "" });
    expect(updated.title).toBe("MACHINE SHOP");
  });
});

describe("setMaintenanceReferenceValueActive", () => {
  // The rule: retiring must not touch the title or the note. Re-sending a
  // title is how a rename somebody else made a moment ago gets reverted with
  // no error anywhere.
  it("PATCHes Active ALONE", async () => {
    graphFetch.mockResolvedValue({});
    graphFetchAll.mockResolvedValue([row("4", { Title: "MACH SHOP", Active: false, Note: "" })]);
    await setMaintenanceReferenceValueActive("departments", 4, false);
    expect(patchedFields()).toEqual({ Active: false });
    expect(patchedFields()).not.toHaveProperty("Title");
    expect(patchedFields()).not.toHaveProperty("Note");
  });

  it("never issues a DELETE — retiring is the only way off a picker", async () => {
    graphFetch.mockResolvedValue({});
    graphFetchAll.mockResolvedValue([row("4", { Title: "MACH SHOP", Active: false, Note: "" })]);
    await setMaintenanceReferenceValueActive("departments", 4, false);
    const methods = graphFetch.mock.calls.map(
      ([, init]) => (init as RequestInit | undefined)?.method,
    );
    expect(methods).not.toContain("DELETE");
  });
});
