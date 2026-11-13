import { describe, it, expect } from "vitest";
import layout from "../../scripts/data/qc-series-x-columns.json";
import get1Layout from "../../scripts/data/qc-get1-columns.json";
import { QC_CHECK_CHOICES, qcFormStatus, qcVisibleFields, type QcFormRecord } from "./qcFormEngine";
import { QC_SERIES_X_BOARDS, QC_SERIES_X_CHECKS, QC_SERIES_X_FIELDS } from "./qcSeriesXFields";
import { QC_SERIES_X_FORM } from "./qcSeriesXForm";
import { QC_GET1_CHECKS } from "./qcGet1Fields";
import { MOCK_QC_SERIES_X_RECORDS } from "@/data/qcSeriesXMockData";

// =============================================================================
// QCFRM-035's descriptors against the column JSON that builds its list, and
// what the 2024–2025 scans showed (2026-10-28).
// =============================================================================

describe("the layout the Series X list is built from", () => {
  const byName = new Map(layout.columns.map((c) => [c.name, c]));

  it("names every column ARC reads and writes", () => {
    for (const f of QC_SERIES_X_FIELDS) expect(byName.has(f.column), f.column).toBe(true);
  });

  it("has no column ARC doesn't map — a fresh list, no migration columns", () => {
    const mapped = new Set(QC_SERIES_X_FIELDS.map((f) => f.column));
    expect(layout.columns.map((c) => c.name).filter((n) => !mapped.has(n))).toEqual([]);
  });

  it("agrees on each column's type", () => {
    const expected: Record<string, string[]> = {
      text: ["text", "title"],
      check: ["check"],
      date: ["date"],
      multiline: ["note"],
    };
    for (const f of QC_SERIES_X_FIELDS) {
      expect(expected[f.kind], `${f.key} (${f.kind})`).toContain(byName.get(f.column)!.type);
    }
  });

  it("offers the same three answers on a check", () => {
    expect([...QC_CHECK_CHOICES]).toEqual(layout.checkChoices);
  });

  it("names its check columns as GET-1's list does", () => {
    const get1 = new Map(get1Layout.columns.map((c) => [c.name, c]));
    for (const [, column] of QC_SERIES_X_CHECKS) {
      expect(byName.get(column), column).toEqual(get1.get(column));
    }
  });
});

describe("Series X's fields", () => {
  it("has the fifteen GE controller checks, the same as GET-1's", () => {
    expect(QC_SERIES_X_CHECKS).toHaveLength(15);
    expect(QC_SERIES_X_CHECKS).toEqual(QC_GET1_CHECKS);
  });

  it("has its own eleven boards — 672 007-1, 672 005-1 and 681 138-1, no VD board", () => {
    const labels = QC_SERIES_X_BOARDS.map(([board]) => board);
    expect(QC_SERIES_X_BOARDS).toHaveLength(11);
    expect(labels).toEqual(expect.arrayContaining(["672 007-1", "672 005-1", "681 138-1"]));
    expect(labels).not.toContain("672 256-1");
    expect(labels).not.toContain("681 101-1");
    expect(labels).not.toContain("681 103-1");
  });

  it("records the 681 105 board as 105-3, as operators correct it", () => {
    const labels = QC_SERIES_X_BOARDS.map(([board]) => board);
    expect(labels).toContain("681 105-3");
    expect(labels).not.toContain("681 105-2");
  });

  it("has no check for the Part Number line's tick box", () => {
    const checks = QC_SERIES_X_FIELDS.filter((f) => f.kind === "check").map((f) => f.label);
    expect(checks.some((label) => /part number/i.test(label))).toBe(false);
  });

  it("shows every field for every unit — no variants", () => {
    const keys = qcVisibleFields(QC_SERIES_X_FORM, { partNumber: "17FM850A2" }).map((f) => f.key);
    expect(keys).toHaveLength(QC_SERIES_X_FIELDS.length);
  });
});

describe("Series X's status", () => {
  const statusOf = (id: number) =>
    qcFormStatus(QC_SERIES_X_FORM, MOCK_QC_SERIES_X_RECORDS.find((r) => r.id === id) as QcFormRecord);

  it("is Complete once the QC inspector and date are in, a missing board or not", () => {
    expect(statusOf(1)).toBe("complete");
    expect(statusOf(2)).toBe("complete");
  });

  it("is In Process part-way through, and In Queue with only the scanned pair", () => {
    expect(statusOf(3)).toBe("new");
    expect(statusOf(4)).toBe("queued");
  });
});
