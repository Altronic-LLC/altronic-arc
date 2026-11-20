import { describe, expect, it } from "vitest";
import {
  bucketMonthlyYield,
  categoryBreakdown,
  monthlyQuantityYield,
  QC_DEFECT_CATEGORIES,
  quantityRecordsInMonth,
  trailingMonths,
  yearsSpanned,
  type QcDefectRow,
  type QuantityTestedRecord,
} from "./monthlyYield";

describe("trailingMonths", () => {
  it("returns the requested count, oldest first, ending at the given month", () => {
    const months = trailingMonths(3, new Date(Date.UTC(2026, 8, 17))); // Sep 2026
    expect(months.map((m) => m.getUTCMonth())).toEqual([6, 7, 8]); // Jul, Aug, Sep
    expect(months.every((m) => m.getUTCFullYear() === 2026)).toBe(true);
  });

  it("spans a year boundary correctly", () => {
    const months = trailingMonths(3, new Date(Date.UTC(2026, 0, 15))); // Jan 2026
    expect(months.map((m) => [m.getUTCFullYear(), m.getUTCMonth()])).toEqual([
      [2025, 10], // Nov 2025
      [2025, 11], // Dec 2025
      [2026, 0], // Jan 2026
    ]);
  });
});

describe("yearsSpanned", () => {
  it("returns one year when the window doesn't cross a boundary", () => {
    const months = trailingMonths(3, new Date(Date.UTC(2026, 8, 17)));
    expect(yearsSpanned(months)).toEqual([2026]);
  });

  it("returns both years when the window crosses a boundary", () => {
    const months = trailingMonths(3, new Date(Date.UTC(2026, 0, 15)));
    expect(yearsSpanned(months)).toEqual([2025, 2026]);
  });
});

describe("bucketMonthlyYield", () => {
  const months = trailingMonths(3, new Date(Date.UTC(2026, 8, 17))); // Jul, Aug, Sep 2026

  interface Row {
    when: Date | null;
    tested: number;
    failed: number;
  }
  const bucket = (rows: Row[]) =>
    bucketMonthlyYield(
      rows,
      months,
      (r) => r.when,
      (r) => r.tested,
      (r) => r.failed,
    );

  it("sums tested and failed per month via the caller's own accessors", () => {
    const result = bucket([
      { when: new Date(Date.UTC(2026, 7, 5)), tested: 1000, failed: 4 },
      { when: new Date(Date.UTC(2026, 7, 6)), tested: 500, failed: 3 },
    ]);
    const august = result.find((m) => m.label === "Aug")!;
    expect(august.unitsTested).toBe(1500);
    expect(august.unitsFailed).toBe(7);
    expect(august.fpyPercent).toBeCloseTo(99.53, 1);
  });

  it("reports fpyPercent as null for a month with nothing tested", () => {
    const result = bucket([]);
    expect(result.every((m) => m.fpyPercent === null)).toBe(true);
    expect(result.every((m) => m.unitsTested === 0 && m.unitsFailed === 0)).toBe(true);
  });

  it("ignores entries outside the requested months", () => {
    const result = bucket([{ when: new Date(Date.UTC(2025, 5, 1)), tested: 500, failed: 0 }]);
    expect(result.every((m) => m.unitsTested === 0)).toBe(true);
  });

  it("ignores entries with no date", () => {
    const result = bucket([{ when: null, tested: 500, failed: 0 }]);
    expect(result.every((m) => m.unitsTested === 0)).toBe(true);
  });

  it("returns months oldest-first with short labels", () => {
    const result = bucket([]);
    expect(result.map((m) => m.label)).toEqual(["Jul", "Aug", "Sep"]);
  });
});

describe("monthlyQuantityYield", () => {
  const months = trailingMonths(2, new Date(Date.UTC(2026, 7, 17))); // Jul, Aug 2026

  function record(overrides: Partial<QuantityTestedRecord> = {}): QuantityTestedRecord {
    return { dateTested: "", quantityTested: 0, quantityRejected: 0, ...overrides };
  }

  it("sums Quantity Tested and Quantity Rejected directly — no batch/defect split", () => {
    const result = monthlyQuantityYield(
      [
        record({ dateTested: "2026-08-05T12:00:00.000Z", quantityTested: 8, quantityRejected: 0 }),
        record({ dateTested: "2026-08-06T09:00:00.000Z", quantityTested: 12, quantityRejected: 2 }),
      ],
      months,
    );
    const august = result.find((m) => m.label === "Aug")!;
    expect(august.unitsTested).toBe(20);
    expect(august.unitsFailed).toBe(2);
    expect(august.fpyPercent).toBeCloseTo(90, 5);
  });

  it("treats an unparsable dateTested as no date, not a crash", () => {
    const result = monthlyQuantityYield(
      [record({ dateTested: "", quantityTested: 5, quantityRejected: 1 })],
      months,
    );
    expect(result.every((m) => m.unitsTested === 0)).toBe(true);
  });
});

describe("categoryBreakdown", () => {
  it("sums each category's count, largest first, dropping categories that never happened", () => {
    const rows = [{ solder: 3, wiring: 0 }, { solder: 2, wiring: 8 }];
    const result = categoryBreakdown(rows, [
      { label: "Solder", getCount: (r) => r.solder },
      { label: "Wiring", getCount: (r) => r.wiring },
      { label: "Never happens", getCount: () => 0 },
    ]);
    expect(result).toEqual([
      { label: "Wiring", count: 8 },
      { label: "Solder", count: 5 },
    ]);
  });

  it("returns an empty array when nothing failed", () => {
    const result = categoryBreakdown([{ solder: 0 }], [
      { label: "Solder", getCount: (r) => r.solder },
    ]);
    expect(result).toEqual([]);
  });
});

describe("quantityRecordsInMonth", () => {
  const august = new Date(Date.UTC(2026, 7, 1));

  it("keeps only records dated within the given month", () => {
    const records = [
      { dateTested: "2026-08-05T12:00:00.000Z" },
      { dateTested: "2026-07-31T23:59:00.000Z" },
      { dateTested: "2026-08-31T23:00:00.000Z" },
    ];
    expect(quantityRecordsInMonth(records, august)).toHaveLength(2);
  });

  it("drops records with an unparsable date", () => {
    expect(quantityRecordsInMonth([{ dateTested: "" }], august)).toHaveLength(0);
  });
});

describe("QC_DEFECT_CATEGORIES", () => {
  it("covers every field on QcDefectRow, and produces a real breakdown", () => {
    const row: QcDefectRow = {
      processSolderDefect: 1,
      aeSolderDefect: 0,
      aeWiringDeficiency: 0,
      aeWrongOrMissingComponent: 0,
      aeAssemblyDeficiency: 0,
      aeIdentificationDeficiency: 0,
      programmingFirmware: 0,
      coatingPottingDeficiency: 0,
      machinePartPlacementDeficiency: 0,
      physicalDamage: 0,
      ncmVendor: 0,
      ncmInternal: 0,
      toRP: 2,
      other: 0,
    };
    expect(QC_DEFECT_CATEGORIES).toHaveLength(14);
    expect(categoryBreakdown([row], QC_DEFECT_CATEGORIES)).toEqual([
      { label: "To RP", count: 2 },
      { label: "Process Solder Defect", count: 1 },
    ]);
  });

  it("treats a missing optional field (toRP/other) as zero, not a crash", () => {
    const row: QcDefectRow = {
      processSolderDefect: 0,
      aeSolderDefect: 0,
      aeWiringDeficiency: 0,
      aeWrongOrMissingComponent: 0,
      aeAssemblyDeficiency: 0,
      aeIdentificationDeficiency: 0,
      programmingFirmware: 0,
      coatingPottingDeficiency: 0,
      machinePartPlacementDeficiency: 0,
      physicalDamage: 0,
      ncmVendor: 0,
      ncmInternal: 0,
    };
    expect(categoryBreakdown([row], QC_DEFECT_CATEGORIES)).toEqual([]);
  });
});
