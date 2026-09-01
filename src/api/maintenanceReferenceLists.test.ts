import { beforeEach, describe, expect, it } from "vitest";
import * as module from "./maintenanceReferenceLists";
import {
  REFERENCE_LISTS,
  createMaintenanceReferenceValue,
  listMaintenanceReferenceLists,
  listMaintenanceReferenceValues,
  resetMaintenanceReferenceMockStores,
  setMaintenanceReferenceValueActive,
  toMaintenanceReferenceValue,
  updateMaintenanceReferenceValue,
} from "./maintenanceReferenceLists";
import type { GraphListItem } from "@/types/task";

// =============================================================================
// The two CMMS reference lists, in mock mode — plus the one guarantee that has
// to hold in BOTH modes: there is no delete.
//
// The real-mode request shapes are in maintenanceReferenceLists.real.test.ts,
// which forces `USE_MOCK: false`; a write shape is invisible from here, which
// is exactly how FAIT's person columns stayed broken for months.
// =============================================================================

beforeEach(() => {
  resetMaintenanceReferenceMockStores();
});

describe("no delete, in this module or anywhere downstream", () => {
  // A value hundreds of assets and work orders point at must not be deletable:
  // every pointer would dangle and each affected record would read as having no
  // department at all. `Active = false` retires it instead.
  it("exports nothing matching /delete|remove/", () => {
    const offenders = Object.keys(module).filter((name) => /delete|remove/i.test(name));
    expect(offenders).toEqual([]);
  });
});

describe("the list specs", () => {
  it("covers both kinds, each with its own list id", () => {
    expect(REFERENCE_LISTS.departments.listId).toBeTruthy();
    expect(REFERENCE_LISTS.locations.listId).toBeTruthy();
    expect(REFERENCE_LISTS.departments.listId).not.toBe(REFERENCE_LISTS.locations.listId);
  });
});

describe("toMaintenanceReferenceValue", () => {
  const item = (fields: Record<string, unknown>, id = "7"): GraphListItem =>
    ({ id, fields }) as unknown as GraphListItem;

  it("maps the three columns", () => {
    expect(toMaintenanceReferenceValue(item({ Title: "  MACH SHOP  ", Active: true, Note: "n" }))).toEqual(
      { lookupId: 7, title: "MACH SHOP", active: true, note: "n" },
    );
  });

  // The opposite would empty every picker in the CMMS the moment somebody
  // added a row outside ARC, or added the column to a list that hadn't got it.
  it("reads a MISSING Active as active", () => {
    expect(toMaintenanceReferenceValue(item({ Title: "QC" })).active).toBe(true);
    expect(toMaintenanceReferenceValue(item({ Title: "QC", Active: null })).active).toBe(true);
  });

  it("reads an explicit false as retired", () => {
    expect(toMaintenanceReferenceValue(item({ Title: "QC", Active: false })).active).toBe(false);
  });
});

describe("listMaintenanceReferenceValues", () => {
  it("returns the seeded departments and locations, sorted by title", () => {
    return Promise.all([
      listMaintenanceReferenceValues("departments"),
      listMaintenanceReferenceValues("locations"),
    ]).then(([departments, locations]) => {
      expect(departments.length).toBe(9);
      expect(locations.length).toBe(64);
      const titles = departments.map((d) => d.title);
      expect([...titles].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))).toEqual(
        titles,
      );
    });
  });

  // Every caller needs them for a different reason — the admin screen to
  // restore one, the mappers to resolve a record still pointing at one — and a
  // read that hid them would make each of those fetch the list a second way.
  it("includes RETIRED values", async () => {
    const locations = await listMaintenanceReferenceValues("locations");
    expect(locations.some((l) => !l.active)).toBe(true);
  });

  it("fetches both lists in one call for the mappers to join against", async () => {
    const both = await listMaintenanceReferenceLists();
    expect(both.departments.length).toBe(9);
    expect(both.locations.length).toBe(64);
  });
});

describe("createMaintenanceReferenceValue", () => {
  // The whole reason these are lookup lists: this is a list-item POST, which
  // ARC's Sites.Selected grant already allows. Adding a CHOICE value would
  // have needed site-manage rights nobody in the shop has.
  it("adds a value that is immediately listed", async () => {
    const created = await createMaintenanceReferenceValue("departments", { title: "  TOOL ROOM " });
    expect(created.title).toBe("TOOL ROOM");
    expect(created.active).toBe(true);
    const departments = await listMaintenanceReferenceValues("departments");
    expect(departments.map((d) => d.title)).toContain("TOOL ROOM");
    expect(departments.length).toBe(10);
  });

  it("refuses a blank name rather than adding an unnameable row", async () => {
    await expect(createMaintenanceReferenceValue("locations", { title: "   " })).rejects.toThrow(
      /needs a name/i,
    );
  });

  it("does not touch the other list", async () => {
    await createMaintenanceReferenceValue("departments", { title: "TOOL ROOM" });
    expect((await listMaintenanceReferenceValues("locations")).length).toBe(64);
  });
});

describe("updateMaintenanceReferenceValue", () => {
  // A lookup rename carries every record pointing at it — the advantage over a
  // choice column, where fixing a typo meant editing the column definition AND
  // every row holding the old spelling.
  it("renames in place, keeping the lookupId every record points at", async () => {
    const [first] = await listMaintenanceReferenceValues("departments");
    const renamed = await updateMaintenanceReferenceValue("departments", first.lookupId, {
      title: "COIL SHOP",
    });
    expect(renamed).toMatchObject({ lookupId: first.lookupId, title: "COIL SHOP" });
  });

  it("leaves Active alone when the caller doesn't mention it", async () => {
    const retired = (await listMaintenanceReferenceValues("locations")).find((l) => !l.active)!;
    const renamed = await updateMaintenanceReferenceValue("locations", retired.lookupId, {
      title: "HARNESS DEPARTMENT (old)",
    });
    expect(renamed.active).toBe(false);
  });

  it("refuses a blank name, and an id that isn't there", async () => {
    const [first] = await listMaintenanceReferenceValues("departments");
    await expect(
      updateMaintenanceReferenceValue("departments", first.lookupId, { title: " " }),
    ).rejects.toThrow(/needs a name/i);
    await expect(
      updateMaintenanceReferenceValue("departments", 9999, { title: "X" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("setMaintenanceReferenceValueActive — what 'delete' means here", () => {
  it("retires a value without removing it from the list", async () => {
    const [first] = await listMaintenanceReferenceValues("departments");
    const retired = await setMaintenanceReferenceValueActive("departments", first.lookupId, false);
    expect(retired.active).toBe(false);
    const departments = await listMaintenanceReferenceValues("departments");
    // Still nine rows: nothing was deleted, so nothing pointing at it dangles.
    expect(departments.length).toBe(9);
    expect(departments.find((d) => d.lookupId === first.lookupId)?.active).toBe(false);
  });

  it("brings one back", async () => {
    const retired = (await listMaintenanceReferenceValues("locations")).find((l) => !l.active)!;
    const restored = await setMaintenanceReferenceValueActive("locations", retired.lookupId, true);
    expect(restored).toMatchObject({ lookupId: retired.lookupId, active: true });
  });

  it("does not touch the title or the note", async () => {
    const [first] = await listMaintenanceReferenceValues("departments");
    const retired = await setMaintenanceReferenceValueActive("departments", first.lookupId, false);
    expect(retired.title).toBe(first.title);
    expect(retired.note).toBe(first.note);
  });

  it("throws for an id that isn't there", async () => {
    await expect(
      setMaintenanceReferenceValueActive("departments", 9999, false),
    ).rejects.toThrow(/not found/i);
  });
});
