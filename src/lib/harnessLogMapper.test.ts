import { describe, expect, it } from "vitest";
import {
  buildHarnessLogTitle,
  byFrequency,
  buildHarnessPartFields,
  compareHarnessLogEntries,
  compareHarnessParts,
  normaliseHarnessInput,
  toHarnessLogEntry,
  toHarnessPartNumber,
} from "./harnessLogMapper";
import type { GraphListItem, HarnessLogEntry, HarnessPartNumber } from "@/types/task";

const item = (id: string, fields: Record<string, unknown>): GraphListItem =>
  ({
    id,
    fields,
    createdDateTime: "2026-01-02T15:00:00Z",
    lastModifiedDateTime: "2026-01-03T15:00:00Z",
  }) as unknown as GraphListItem;

describe("buildHarnessLogTitle", () => {
  it("joins part and work order, falling back to whichever is there", () => {
    expect(buildHarnessLogTitle("593027-15", "1000209528")).toBe("593027-15 / WO 1000209528");
    expect(buildHarnessLogTitle("593027-15", " ")).toBe("593027-15");
    expect(buildHarnessLogTitle(null, "1000209528")).toBe("WO 1000209528");
    expect(buildHarnessLogTitle(undefined, undefined)).toBe("(untitled entry)");
  });
});

describe("toHarnessPartNumber", () => {
  it("reads every column", () => {
    expect(toHarnessPartNumber(item("7", { Title: " 593027-15 ", Description: "d", Active: false, Note: "n" }))).toEqual({
      lookupId: 7,
      title: "593027-15",
      description: "d",
      active: false,
      note: "n",
    });
  });

  it("reads a missing Active as active, and a string Active by its text", () => {
    expect(toHarnessPartNumber(item("1", { Title: "x" })).active).toBe(true);
    expect(toHarnessPartNumber(item("1", { Title: "x", Active: "No" })).active).toBe(false);
    expect(toHarnessPartNumber(item("1", { Title: "x", Active: "Yes" })).active).toBe(true);
  });
});

describe("buildHarnessPartFields", () => {
  it("upper-cases the part number and always sends Active", () => {
    expect(buildHarnessPartFields({ title: " ec93005-5 " })).toEqual({
      Title: "EC93005-5",
      Description: "",
      Active: true,
      Note: "",
    });
  });
});

describe("toHarnessLogEntry", () => {
  const titles = new Map([[4, "593027-15"]]);

  it("resolves the bare PartNumberLookupId against the part list", () => {
    const e = toHarnessLogEntry(
      item("12", {
        Title: "593027-15 / WO 1",
        ProductionDate: "2025-03-04T12:00:00Z",
        WorkOrder: "1",
        PartNumberLookupId: "4",
        Quantity: 25,
        ReworkQuantity: "2",
        Comments: "c",
        BuiltBy: "342",
        VisualCheck: "208",
        DataQualityNotes: "n",
      }),
      titles,
    );
    expect(e).toMatchObject({
      id: 12,
      part: { lookupId: 4, title: "593027-15" },
      quantity: 25,
      reworkQuantity: 2,
      builtBy: "342",
      visualCheck: "208",
      dataQualityNotes: "n",
    });
    expect(e.productionDate?.toISOString()).toBe("2025-03-04T12:00:00.000Z");
  });

  it("reads a date SharePoint stored at local midnight as the day it shows", () => {
    const e = toHarnessLogEntry(item("1", { ProductionDate: "2025-03-04T05:00:00Z" }), titles);
    expect(e.productionDate?.toISOString().slice(0, 10)).toBe("2025-03-04");
  });

  it("keeps a dangling part visible, and derives a missing Title", () => {
    const e = toHarnessLogEntry(item("1", { PartNumberLookupId: 99, WorkOrder: "5" }), titles);
    expect(e.part).toEqual({ lookupId: 99, title: "(missing #99)" });
    expect(e.title).toBe("(missing #99) / WO 5");
  });

  it("reads no part as null", () => {
    expect(toHarnessLogEntry(item("1", {}), titles).part).toBeNull();
  });
});

describe("ordering", () => {
  const e = (id: number, date: string | null) => ({ id, productionDate: date ? new Date(date) : null }) as HarnessLogEntry;

  it("puts the newest first, then by id, undated last", () => {
    const sorted = [e(1, "2025-01-01"), e(2, null), e(3, "2025-02-01"), e(4, "2025-02-01"), e(5, null)].sort(
      compareHarnessLogEntries,
    );
    expect(sorted.map((x) => x.id)).toEqual([4, 3, 1, 5, 2]);
  });

  it("sorts part numbers numerically", () => {
    const p = (title: string) => ({ title }) as HarnessPartNumber;
    expect([p("593027-12"), p("593027-9")].sort(compareHarnessParts).map((x) => x.title)).toEqual([
      "593027-9",
      "593027-12",
    ]);
  });
});

describe("normaliseHarnessInput", () => {
  it("trims text and upper-cases the two codes", () => {
    expect(
      normaliseHarnessInput({
        productionDate: null,
        workOrder: " 1 ",
        partLookupId: 1,
        quantity: 1,
        reworkQuantity: 0,
        comments: " c ",
        builtBy: " pj ",
        visualCheck: " lf ",
      }),
    ).toMatchObject({ workOrder: "1", comments: "c", builtBy: "PJ", visualCheck: "LF" });
  });
});

describe("byFrequency", () => {
  it("lists distinct values most-used first, ignoring blanks and spacing", () => {
    expect(byFrequency(["208", "342", "342", "", " 208 ", "342", "PJ"])).toEqual(["342", "208", "PJ"]);
  });
});
