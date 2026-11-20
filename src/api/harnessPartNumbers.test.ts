import { beforeEach, describe, expect, it } from "vitest";
import * as api from "./harnessPartNumbers";
import {
  createHarnessPartNumber,
  listHarnessPartNumbers,
  resetHarnessPartMockStore,
  setHarnessPartNumberActive,
  updateHarnessPartNumber,
} from "./harnessPartNumbers";
import {
  createHarnessLogEntry,
  harnessEntryInScope,
  harnessScopeFilters,
  listHarnessLog,
  listHarnessRecentCodes,
  resetHarnessLogMockStore,
} from "./harnessProductionLog";

// USE_MOCK is true under Vitest — these exercise the in-memory stores.

beforeEach(() => {
  resetHarnessPartMockStore();
  resetHarnessLogMockStore();
});

describe("Harness Part Numbers (mock)", () => {
  it("has no delete — a part is retired, never removed", () => {
    expect(Object.keys(api).filter((k) => /delete|remove/i.test(k))).toEqual([]);
  });

  it("lists retired parts too, sorted numerically", async () => {
    const parts = await listHarnessPartNumbers();
    expect(parts.some((p) => !p.active)).toBe(true);
    expect(parts.map((p) => p.title)).toEqual([...parts.map((p) => p.title)].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    ));
  });

  it("adds a part number, upper-cased", async () => {
    const part = await createHarnessPartNumber({ title: "ec93099-1" });
    expect(part).toMatchObject({ title: "EC93099-1", active: true });
  });

  it("refuses a duplicate, case-insensitively, and points at a retired twin", async () => {
    await expect(createHarnessPartNumber({ title: "593027-15" })).rejects.toThrow(/already on the list/);
    await expect(createHarnessPartNumber({ title: "593030-18" })).rejects.toThrow(/retired — restore it/);
    await expect(createHarnessPartNumber({ title: "  " })).rejects.toThrow(/blank/);
  });

  it("renames without touching Active, and refuses a rename onto another part", async () => {
    const renamed = await updateHarnessPartNumber(8, { title: "593030-19" });
    expect(renamed).toMatchObject({ title: "593030-19", active: false });
    await expect(updateHarnessPartNumber(8, { title: "593027-15" })).rejects.toThrow(/already/);
  });

  it("retires and restores", async () => {
    expect((await setHarnessPartNumberActive(1, false)).active).toBe(false);
    expect((await setHarnessPartNumberActive(1, true)).active).toBe(true);
    await expect(setHarnessPartNumberActive(999, true)).rejects.toThrow(/not found/);
  });
});

describe("Harness Production Log (mock)", () => {
  const thisYear = new Date().getFullYear();

  it("reads one year at a time, and every year on request", async () => {
    const current = await listHarnessLog({ kind: "year", year: thisYear });
    const all = await listHarnessLog({ kind: "all" });
    expect(current.entries.every((e) => e.productionDate?.getUTCFullYear() === thisYear)).toBe(true);
    expect(all.entries.length).toBeGreaterThan(current.entries.length);
  });

  it("creates an entry with the derived title", async () => {
    const created = await createHarnessLogEntry(
      {
        productionDate: new Date(Date.UTC(thisYear, 0, 20, 12)),
        workOrder: "1002000000",
        partLookupId: 1,
        quantity: 5,
        reworkQuantity: 0,
        comments: "",
        builtBy: "pj",
        visualCheck: "",
      },
      "593027-15",
    );
    expect(created).toMatchObject({ title: "593027-15 / WO 1002000000", builtBy: "PJ" });
  });

  it("suggests builders from the last 12 months, across the year boundary", async () => {
    // From mid-January, last November's builders are still suggested even
    // though they aren't in this year's view.
    const codes = await listHarnessRecentCodes(new Date(Date.UTC(thisYear, 0, 15)));
    expect(codes.builtBy).toEqual(expect.arrayContaining(["373", "278"]));
    // From mid-December, last November is out of the window.
    const later = await listHarnessRecentCodes(new Date(Date.UTC(thisYear, 11, 15)));
    expect(later.builtBy).not.toContain("373");
  });

  it("puts undated rows in the current year only", () => {
    const undated = { productionDate: null } as Parameters<typeof harnessEntryInScope>[0];
    expect(harnessEntryInScope(undated, { kind: "year", year: thisYear })).toBe(true);
    expect(harnessEntryInScope(undated, { kind: "year", year: thisYear - 1 })).toBe(false);
  });

  it("offers a bare literal before a quoted one, and nothing for every year", () => {
    const [bare, quoted] = harnessScopeFilters({ kind: "year", year: 2024 });
    expect(bare).toBe("fields/ProductionDate ge 2024-01-01T00:00:00Z and fields/ProductionDate lt 2025-01-01T00:00:00Z");
    expect(quoted).toContain("'2024-01-01T00:00:00Z'");
    expect(harnessScopeFilters({ kind: "all" })).toEqual([]);
  });
});
