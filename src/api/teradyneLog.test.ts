import { describe, it, expect } from "vitest";
import {
  buildLogWriteFields,
  createTeradyneLogEntry,
  deleteTeradyneLogEntry,
  listTeradyneLog,
  updateTeradyneLogEntry,
} from "./teradyneLog";
import type { TeradyneLogInput } from "@/types/task";

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
  oldSapNumber: "",
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
});

describe("listTeradyneLog (mock)", () => {
  it("returns entries newest Enter Date first", async () => {
    const entries = await listTeradyneLog();
    expect(entries.length).toBeGreaterThan(0);
    const dates = entries.map((e) => e.enterDate?.getTime() ?? 0);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("hands back entries with lookups already resolved to titles", async () => {
    const entries = await listTeradyneLog();
    const withProduct = entries.find((e) => e.product != null);
    expect(withProduct?.product?.title).toBeTruthy();
    expect(withProduct?.product?.title).not.toMatch(/^\(missing/);
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

    const all = await listTeradyneLog();
    expect(all.some((e) => e.id === created.id)).toBe(true);
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
    const all = await listTeradyneLog();
    expect(all.some((e) => e.id === created.id)).toBe(false);
  });

  it("ignores a delete for an id that isn't there", async () => {
    await expect(deleteTeradyneLogEntry(88888888)).resolves.toBeUndefined();
  });
});
