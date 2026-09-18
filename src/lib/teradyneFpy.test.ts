import { describe, expect, it } from "vitest";
import { isBatchTotalRow, latestMonthRemarkBreakdown, monthlyFpy } from "./teradyneFpy";
import { trailingMonths, type MonthlyFpy } from "@/lib/monthlyYield";
import type { TeradyneLogEntry } from "@/types/task";

function row(overrides: Partial<TeradyneLogEntry> = {}): TeradyneLogEntry {
  return {
    id: 1,
    title: "",
    enterDate: null,
    product: null,
    employee1: null,
    employee2: null,
    remark: null,
    employee1Clock: null,
    employee2Clock: null,
    defectiveParts: "",
    numberOfBoards: null,
    boardsTested: null,
    failuresPerBoard: null,
    sapNumber: "",
    altronicPartNumber: "",
    operatorNotes: "",
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...overrides,
  };
}

describe("isBatchTotalRow", () => {
  it("is true when boardsTested is a real, non-zero number", () => {
    expect(isBatchTotalRow(row({ boardsTested: 500 }))).toBe(true);
  });

  it("is false when boardsTested is null — that row is a defect entry", () => {
    expect(isBatchTotalRow(row({ boardsTested: null, numberOfBoards: 3 }))).toBe(false);
  });

  it("is false when boardsTested is zero", () => {
    expect(isBatchTotalRow(row({ boardsTested: 0 }))).toBe(false);
  });
});

describe("monthlyFpy", () => {
  const months = trailingMonths(3, new Date(Date.UTC(2026, 8, 17))); // Jul, Aug, Sep 2026

  it("sums Boards Tested only from batch-total rows, once per batch", () => {
    const entries: TeradyneLogEntry[] = [
      // One batch run in August: a total row plus two defect rows against it.
      row({ enterDate: new Date(Date.UTC(2026, 7, 5)), boardsTested: 1000 }),
      row({
        enterDate: new Date(Date.UTC(2026, 7, 5)),
        boardsTested: null,
        numberOfBoards: 4,
        defectiveParts: "Cold solder",
      }),
      row({
        enterDate: new Date(Date.UTC(2026, 7, 6)),
        boardsTested: null,
        numberOfBoards: 3,
        defectiveParts: "Bent pin",
      }),
    ];
    const result = monthlyFpy(entries, months);
    const august = result.find((m) => m.label === "Aug") as MonthlyFpy;
    expect(august.unitsTested).toBe(1000);
    expect(august.unitsFailed).toBe(7);
    expect(august.fpyPercent).toBeCloseTo(99.3, 1);
  });

  it("reports fpyPercent as null for a month with no batch-total rows at all", () => {
    const result = monthlyFpy([], months);
    expect(result.every((m) => m.fpyPercent === null)).toBe(true);
    expect(result.every((m) => m.unitsTested === 0 && m.unitsFailed === 0)).toBe(true);
  });

  it("ignores entries outside the requested months", () => {
    const entries: TeradyneLogEntry[] = [
      row({ enterDate: new Date(Date.UTC(2025, 5, 1)), boardsTested: 500 }),
    ];
    const result = monthlyFpy(entries, months);
    expect(result.every((m) => m.unitsTested === 0)).toBe(true);
  });

  it("ignores entries with no enterDate", () => {
    const entries: TeradyneLogEntry[] = [row({ enterDate: null, boardsTested: 500 })];
    const result = monthlyFpy(entries, months);
    expect(result.every((m) => m.unitsTested === 0)).toBe(true);
  });

  it("returns months oldest-first with short labels", () => {
    const result = monthlyFpy([], months);
    expect(result.map((m) => m.label)).toEqual(["Jul", "Aug", "Sep"]);
  });
});

describe("latestMonthRemarkBreakdown", () => {
  const august = new Date(Date.UTC(2026, 7, 1));
  const remark = (title: string) => ({ lookupId: 1, title });

  it("sums numberOfBoards per remark, for defect rows only, largest first", () => {
    const entries: TeradyneLogEntry[] = [
      row({ enterDate: new Date(Date.UTC(2026, 7, 5)), boardsTested: 1000 }), // batch total — excluded
      row({
        enterDate: new Date(Date.UTC(2026, 7, 5)),
        numberOfBoards: 4,
        remark: remark("Cold solder"),
      }),
      row({
        enterDate: new Date(Date.UTC(2026, 7, 6)),
        numberOfBoards: 3,
        remark: remark("Bent pin"),
      }),
      row({
        // A second "Cold solder" defect row in the same month adds to the
        // same bucket rather than creating a duplicate entry.
        enterDate: new Date(Date.UTC(2026, 7, 20)),
        numberOfBoards: 6,
        remark: remark("Cold solder"),
      }),
    ];
    expect(latestMonthRemarkBreakdown(entries, august)).toEqual([
      { label: "Cold solder", count: 10 },
      { label: "Bent pin", count: 3 },
    ]);
  });

  it("groups a defect row with no remark under Unspecified, rather than dropping it", () => {
    const entries: TeradyneLogEntry[] = [
      row({ enterDate: new Date(Date.UTC(2026, 7, 5)), numberOfBoards: 2, remark: null }),
    ];
    expect(latestMonthRemarkBreakdown(entries, august)).toEqual([
      { label: "Unspecified", count: 2 },
    ]);
  });

  it("ignores rows outside the requested month", () => {
    const entries: TeradyneLogEntry[] = [
      row({ enterDate: new Date(Date.UTC(2026, 8, 5)), numberOfBoards: 2, remark: remark("X") }),
    ];
    expect(latestMonthRemarkBreakdown(entries, august)).toEqual([]);
  });

  it("returns an empty array for a month with no defects logged", () => {
    expect(latestMonthRemarkBreakdown([], august)).toEqual([]);
  });
});
