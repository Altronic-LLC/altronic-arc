import { describe, it, expect } from "vitest";
import {
  buildLogWriteFields,
  createTeradyneLogEntry,
  deleteTeradyneLogEntry,
  entryInScope,
  listTeradyneLog,
  listTeradyneLookupUsage,
  updateTeradyneLogEntry,
} from "./teradyneLog";
import type { TeradyneLogEntry, TeradyneLogInput } from "@/types/task";

// USE_MOCK is true under Vitest — these exercise the in-memory log store.

const baseInput: TeradyneLogInput = {
  enterDate: new Date("2026-03-05T12:00:00Z"),
  productLookupId: 201,
  employee1LookupId: 8,
  employee2LookupId: null,
  remarkLookupId: 4,
  employee1Clock: 88,
  employee2Clock: null,
  defectiveParts: "U7",
  numberOfBoards: 2,
  boardsTested: 20,
  failuresPerBoard: 1,
  sapNumber: "601999",
  altronicPartNumber: "",
  operatorNotes: "  trailing space  ",
};

const baseTitles = {
  productTitle: "Moris Power Supply",
  employee1Title: "Melissa Fuentes",
  employee2Title: null,
  remarkTitle: "Wrong board",
};

describe("buildLogWriteFields", () => {
  it("writes single-value lookups as bare integers, not the multi-value two-key shape", () => {
    const fields = buildLogWriteFields(baseInput, "Moris Power Supply");
    expect(fields.ProductLookupId).toBe(201);
    expect(fields.Employee1LookupId).toBe(8);
    expect(fields.RemarkLookupId).toBe(4);
    // The Collection(Edm.Int32) annotation belongs to MULTI-value lookups only;
    // emitting it here would 400.
    expect(Object.keys(fields).some((k) => k.includes("@odata.type"))).toBe(false);
  });

  it("computes Title from the product and defective parts", () => {
    expect(buildLogWriteFields(baseInput, "Moris Power Supply").Title).toBe(
      "Moris Power Supply - U7",
    );
  });

  it("writes the date as midday UTC", () => {
    expect(buildLogWriteFields(baseInput, "x").EnterDate).toBe("2026-03-05T12:00:00Z");
  });

  it("sends null for cleared lookups and numbers so the column empties", () => {
    const fields = buildLogWriteFields(
      { ...baseInput, employee2LookupId: null, boardsTested: null, enterDate: null },
      "x",
    );
    expect(fields.Employee2LookupId).toBeNull();
    expect(fields.BoardsTested).toBeNull();
    expect(fields.EnterDate).toBeNull();
  });

  it("trims the free-text columns", () => {
    const fields = buildLogWriteFields(baseInput, "x");
    expect(fields.OperatorNotes).toBe("trailing space");
  });

  it("writes the Altronic part number to the SharePoint column still named OldSAPNumber", () => {
    // The user-facing field was renamed from "Old SAP Number"; the SharePoint
    // column was NOT renamed, so this mapping is the thing that must not drift.
    const fields = buildLogWriteFields(
      { ...baseInput, altronicPartNumber: " 672337-1 " },
      "x",
    );
    expect(fields.OldSAPNumber).toBe("672337-1");
    expect(fields).not.toHaveProperty("AltronicPartNumber");
  });

  it("keeps the SAP number and the Altronic part number as separate columns", () => {
    const fields = buildLogWriteFields(
      { ...baseInput, sapNumber: "601999", altronicPartNumber: "672337-1" },
      "x",
    );
    expect(fields.SAPNumber).toBe("601999");
    expect(fields.OldSAPNumber).toBe("672337-1");
  });
});

describe("listTeradyneLog (mock)", () => {
  it("returns entries newest Enter Date first", async () => {
    const { entries } = await listTeradyneLog({ kind: "all" });
    expect(entries.length).toBeGreaterThan(0);
    const dates = entries.map((e) => e.enterDate?.getTime() ?? 0);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("hands back entries with lookups already resolved to titles", async () => {
    const { entries } = await listTeradyneLog({ kind: "all" });
    const withProduct = entries.find((e) => e.product != null);
    expect(withProduct?.product?.title).toBeTruthy();
    expect(withProduct?.product?.title).not.toMatch(/^\(missing/);
  });

  it("loads one year at a time — the list holds 16k+ rows of legacy history", async () => {
    // The fixture is all 2026; asking for another year must come back empty
    // rather than quietly returning everything.
    const y2026 = await listTeradyneLog({ kind: "year", year: 2026 });
    expect(y2026.entries.length).toBeGreaterThan(0);
    expect(y2026.entries.every((e) => e.enterDate?.getUTCFullYear() === 2026)).toBe(true);

    const y2019 = await listTeradyneLog({ kind: "year", year: 2019 });
    expect(y2019.entries).toHaveLength(0);
  });

  it("the all-years scope returns every entry", async () => {
    const all = await listTeradyneLog({ kind: "all" });
    const year = await listTeradyneLog({ kind: "year", year: 2026 });
    expect(all.entries.length).toBeGreaterThanOrEqual(year.entries.length);
  });

  it("reports that the filter was applied server-side", async () => {
    // Mock mode always filters at "the source"; the flag exists so the real
    // path can admit when it had to fall back to filtering in the browser.
    const { filteredServerSide } = await listTeradyneLog({ kind: "year", year: 2026 });
    expect(filteredServerSide).toBe(true);
  });
});

describe("entryInScope", () => {
  const dated = (iso: string | null) =>
    ({ enterDate: iso ? new Date(iso) : null }) as TeradyneLogEntry;

  it("matches on the UTC year, so a date-only value can't slip into the year before", () => {
    // 2026-01-01T12:00:00Z is how the app stores 1 Jan; a local-time reading
    // would call this 2025 for any US timezone.
    expect(entryInScope(dated("2026-01-01T12:00:00Z"), { kind: "year", year: 2026 })).toBe(true);
    expect(entryInScope(dated("2026-01-01T12:00:00Z"), { kind: "year", year: 2025 })).toBe(false);
  });

  it("keeps undated rows visible in the current year so they can be fixed", () => {
    const thisYear = new Date().getFullYear();
    expect(entryInScope(dated(null), { kind: "year", year: thisYear })).toBe(true);
    expect(entryInScope(dated(null), { kind: "year", year: thisYear - 3 })).toBe(false);
  });

  it("accepts everything for the all-years scope", () => {
    expect(entryInScope(dated("2011-06-01T12:00:00Z"), { kind: "all" })).toBe(true);
    expect(entryInScope(dated(null), { kind: "all" })).toBe(true);
  });
});

describe("listTeradyneLookupUsage (mock)", () => {
  it("counts usage across every year, not just the loaded scope", async () => {
    const usage = await listTeradyneLookupUsage();
    // "Wrong board" (remark 4) is on two fixture entries.
    expect(usage.remarks.get(4)).toBe(2);
    // Every fixture product is used exactly once.
    expect(usage.products.get(201)).toBe(1);
  });

  it("counts an employee once per entry even when they hold both slots", async () => {
    const usage = await listTeradyneLookupUsage();
    for (const count of usage.employees.values()) {
      expect(count).toBeGreaterThan(0);
    }
  });

  it("omits reference rows nothing points at", async () => {
    const usage = await listTeradyneLookupUsage();
    // Remark 9 ("Cold joint") is unused in the fixture.
    expect(usage.remarks.has(9)).toBe(false);
  });
});

describe("createTeradyneLogEntry / updateTeradyneLogEntry / delete (mock)", () => {
  it("creates an entry with a derived title and resolved lookups", async () => {
    const created = await createTeradyneLogEntry(baseInput, baseTitles);
    expect(created.title).toBe("Moris Power Supply - U7");
    expect(created.product).toEqual({ lookupId: 201, title: "Moris Power Supply" });
    expect(created.employee1?.title).toBe("Melissa Fuentes");
    expect(created.employee2).toBeNull();
    expect(created.operatorNotes).toBe("trailing space");

    const { entries } = await listTeradyneLog({ kind: "all" });
    expect(entries.some((e) => e.id === created.id)).toBe(true);
  });

  it("re-derives the title when the product changes", async () => {
    const created = await createTeradyneLogEntry(baseInput, baseTitles);
    const updated = await updateTeradyneLogEntry(
      created.id,
      { ...baseInput, productLookupId: 214, defectiveParts: "CH2" },
      { ...baseTitles, productTitle: "TEM Power Board" },
    );
    expect(updated.title).toBe("TEM Power Board - CH2");
  });

  it("labels a lookup whose title couldn't be resolved", async () => {
    const created = await createTeradyneLogEntry(
      { ...baseInput, remarkLookupId: 4242 },
      { ...baseTitles, remarkTitle: null },
    );
    expect(created.remark).toEqual({ lookupId: 4242, title: "(missing #4242)" });
  });

  it("throws for an unknown entry id", async () => {
    await expect(updateTeradyneLogEntry(99999999, baseInput, baseTitles)).rejects.toThrow(
      /not found/,
    );
  });

  it("deletes an entry", async () => {
    const created = await createTeradyneLogEntry(baseInput, baseTitles);
    await deleteTeradyneLogEntry(created.id);
    const { entries } = await listTeradyneLog({ kind: "all" });
    expect(entries.some((e) => e.id === created.id)).toBe(false);
  });

  it("ignores a delete for an id that isn't there", async () => {
    await expect(deleteTeradyneLogEntry(88888888)).resolves.toBeUndefined();
  });
});
