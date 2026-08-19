import { describe, it, expect } from "vitest";
import {
  ECN_FIELDS,
  ECN_SECTIONS,
  ECN_SELECT,
  ECN_STOCK_DISPOSITIONS,
  ecnFieldsInSection,
  stockDispositions,
} from "./ecnFields";

// This table is the ONLY place the field_N → meaning mapping exists, so the
// tests here are about it staying honest rather than about behaviour.

describe("the descriptor table", () => {
  it("maps every column the app reads or writes", () => {
    const columns = ECN_FIELDS.map((f) => f.column);
    expect(columns).toEqual([
      "field_4",
      "field_5",
      "field_6",
      "field_7",
      "field_8",
      "field_9",
      "field_3",
      "field_10",
      "field_12",
    ]);
  });

  it("has no duplicate keys or columns", () => {
    expect(new Set(ECN_FIELDS.map((f) => f.key)).size).toBe(ECN_FIELDS.length);
    expect(new Set(ECN_FIELDS.map((f) => f.column)).size).toBe(ECN_FIELDS.length);
  });

  // field_1 and field_11 don't exist on the list. Selecting a column that
  // isn't there 400s the whole read.
  it("never reaches for the columns the list hasn't got", () => {
    const columns = ECN_FIELDS.map((f) => f.column);
    expect(columns).not.toContain("field_1");
    expect(columns).not.toContain("field_11");
  });

  it("puts every field in a section that's rendered", () => {
    for (const field of ECN_FIELDS) {
      expect(ECN_SECTIONS).toContain(field.section);
    }
    const covered = ECN_SECTIONS.flatMap((s) => ecnFieldsInSection(s));
    expect(covered).toHaveLength(ECN_FIELDS.length);
  });

  it("declares the two boolean columns as booleans", () => {
    const booleans = ECN_FIELDS.filter((f) => f.kind === "boolean").map((f) => f.column);
    expect(booleans).toEqual(["field_8", "field_9"]);
  });

  it("selects Communication and Attachments alongside the columns", () => {
    expect(ECN_SELECT).toContain("Communication");
    expect(ECN_SELECT).toContain("Attachments");
  });
});

describe("stockDispositions", () => {
  it("offers the three known dispositions even on an empty list", () => {
    expect(stockDispositions([])).toEqual([...ECN_STOCK_DISPOSITIONS]);
  });

  // It's a TEXT column, so an older row's wording won't always match — the
  // box accepts anything and offers what the data holds.
  it("adds anything else the data holds, most-used first", () => {
    const options = stockDispositions([
      "Scrapped",
      "Reworked",
      "Scrapped",
      "Engineering - Do NOT modify stock",
      "  ",
    ]);
    expect(options.slice(0, 3)).toEqual([...ECN_STOCK_DISPOSITIONS]);
    expect(options.slice(3)).toEqual(["Scrapped", "Reworked"]);
  });

  it("doesn't repeat a known disposition that's also in the data", () => {
    const options = stockDispositions(["Operations - Stock modified"]);
    expect(options.filter((o) => o === "Operations - Stock modified")).toHaveLength(1);
  });
});
