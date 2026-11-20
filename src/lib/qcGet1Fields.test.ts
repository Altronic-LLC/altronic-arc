import { describe, it, expect } from "vitest";
import layout from "../../scripts/data/qc-get1-columns.json";
import { QC_CHECK_CHOICES, qcFormStatus, qcVisibleFields, type QcFormRecord } from "./qcFormEngine";
import { QC_GET1_BOARDS, QC_GET1_CHECKS, QC_GET1_FIELDS } from "./qcGet1Fields";
import { QC_GET1_FORM } from "./qcGet1Form";
import { MOCK_QC_GET1_RECORDS } from "@/data/qcGet1MockData";

// =============================================================================
// GET-1's descriptors against the column JSON that builds its list, and the
// calls Tim made from the 2025 scans (2026-10-26).
// =============================================================================

describe("the layout the GET-1 list is built from", () => {
  const byName = new Map(layout.columns.map((c) => [c.name, c]));

  it("names every column ARC reads and writes", () => {
    for (const f of QC_GET1_FIELDS) expect(byName.has(f.column), f.column).toBe(true);
  });

  it("has no column ARC doesn't map — a fresh list, no migration columns", () => {
    const mapped = new Set(QC_GET1_FIELDS.map((f) => f.column));
    expect(layout.columns.map((c) => c.name).filter((n) => !mapped.has(n))).toEqual([]);
  });

  it("agrees on each column's type", () => {
    const expected: Record<string, string[]> = {
      text: ["text", "title"],
      number: ["number"],
      check: ["check"],
      flag: ["flag"],
      date: ["date"],
      datetime: ["dateTime"],
      multiline: ["note"],
    };
    for (const f of QC_GET1_FIELDS) {
      expect(expected[f.kind], `${f.key} (${f.kind})`).toContain(byName.get(f.column)!.type);
    }
  });

  it("offers the same three answers on a check", () => {
    expect([...QC_CHECK_CHOICES]).toEqual(layout.checkChoices);
  });
});

describe("GET-1's fields", () => {
  it("has the paper's fifteen checks, in its order", () => {
    expect(QC_GET1_CHECKS).toHaveLength(15);
    expect(QC_GET1_CHECKS[0][2]).toBe("100% Inspection of Pins (Using Tool)");
    expect(QC_GET1_CHECKS[14][2]).toBe("Verify Ship Firmware Revision on PC");
  });

  it("has no check for the Part Number line's tick box", () => {
    const checks = QC_GET1_FIELDS.filter((f) => f.kind === "check").map((f) => f.label);
    expect(checks.some((label) => /part number/i.test(label))).toBe(false);
  });

  it("records the 681 105 board as 105-3, the board operators write in", () => {
    const labels = QC_GET1_BOARDS.map(([board]) => board);
    expect(labels).toContain("681 105-3");
    expect(labels).not.toContain("681 105-2");
    expect(QC_GET1_BOARDS).toHaveLength(12);
  });

  it("shows every field for every unit — the GE sheet has no variants", () => {
    const keys = qcVisibleFields(QC_GET1_FORM, { partNumber: "17FM760D2" }).map((f) => f.key);
    expect(keys).toHaveLength(QC_GET1_FIELDS.length);
  });
});

describe("GET-1's status", () => {
  const statusOf = (id: number) =>
    qcFormStatus(QC_GET1_FORM, MOCK_QC_GET1_RECORDS.find((r) => r.id === id) as QcFormRecord);

  it("is Complete once the QC inspector and date are in", () => {
    expect(statusOf(1)).toBe("complete");
  });

  it("is In Process part-way through, and In Queue with only the scanned pair", () => {
    expect(statusOf(3)).toBe("new");
    expect(statusOf(4)).toBe("queued");
  });
});
