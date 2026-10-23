import { describe, it, expect } from "vitest";
import { QC_CPU95_PART_NUMBER_SUGGESTIONS, QC_CPU95_PART_NUMBERS, qcCpu95Altmode } from "./qcCpu95Mapper";

describe("qcCpu95Altmode", () => {
  it("matches every part number from the legacy Power Apps Switch()", () => {
    expect(qcCpu95Altmode("791950-08")).toBe(1);
    expect(qcCpu95Altmode("791950-16")).toBe(2);
    expect(qcCpu95Altmode("791950-20")).toBe(3);
    expect(qcCpu95Altmode("791962-20")).toBe(3);
    expect(qcCpu95Altmode("791950-18")).toBe(4);
    expect(qcCpu95Altmode("791952-18")).toBe(5);
    expect(qcCpu95Altmode("791962-18")).toBe(6);
  });

  it("falls back to 0 for anything else, including blank", () => {
    expect(qcCpu95Altmode("")).toBe(0);
    expect(qcCpu95Altmode("some-unknown-part")).toBe(0);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(qcCpu95Altmode("  791950-16  ")).toBe(2);
  });

  // Confirmed against real data (Tim, 2026-09-17): some older rows spell the
  // -08 variant without the leading zero.
  it("treats a bare single-digit suffix as equivalent to its zero-padded spelling", () => {
    expect(qcCpu95Altmode("791950-8")).toBe(1);
    expect(qcCpu95Altmode("791950-08")).toBe(1);
  });

  it("does not zero-pad a suffix that's already two digits", () => {
    expect(qcCpu95Altmode("791950-16")).toBe(2);
  });
});

describe("QC_CPU95_PART_NUMBERS", () => {
  it("is exactly the 7 part numbers with a known Altmode, in table order", () => {
    expect(QC_CPU95_PART_NUMBERS).toEqual([
      "791950-08",
      "791950-16",
      "791950-20",
      "791962-20",
      "791950-18",
      "791952-18",
      "791962-18",
    ]);
  });
});

describe("QC_CPU95_PART_NUMBER_SUGGESTIONS", () => {
  it("includes every canonical part number", () => {
    for (const pn of QC_CPU95_PART_NUMBERS) {
      expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).toContain(pn);
    }
  });

  // "791950-08" is the only canonical spelling with a zero-padded
  // single-digit suffix, so it's the only one with an unpadded alias.
  it("adds '791950-8' as its own suggestion alongside '791950-08'", () => {
    expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).toContain("791950-8");
    expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).toContain("791950-08");
  });

  it("offers the part numbers with checks of their own: 791956-16, the 95C and both EVS", () => {
    for (const pn of ["791956-16", "791955-16", "791963-16A", "791963-16E"]) {
      expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).toContain(pn);
    }
  });

  it("adds no alias for a part number that's already two digits", () => {
    expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).not.toContain("791950-6");
    expect(QC_CPU95_PART_NUMBER_SUGGESTIONS.filter((pn) => pn === "791950-16")).toHaveLength(1);
  });
});
