import type ExcelJS from "exceljs";
import { parseOpenOrdersGrid, OpenOrdersParseError, type ParseResult } from "./openOrdersParse";

// =============================================================================
// The ExcelJS edge of parsing — read a workbook into a grid, hand it to the
// pure parser.
//
// This file is the ONLY place that knows an uploaded file is xlsx. It takes an
// injected ExcelJS so the ~950KB library is dynamically imported by the caller
// and never reaches the main bundle.
// =============================================================================

/** Which sheet to read, when a workbook has several. */
export interface ReadOptions {
  /** Read this sheet by name; otherwise the best candidate is chosen. */
  sheetName?: string;
}

export interface ReadResult extends ParseResult {
  sheetName: string;
  /** Every sheet in the file, so a caller can offer a different one. */
  availableSheets: string[];
}

/**
 * Read an uploaded open-orders workbook.
 *
 * The live export is a single sheet called `Data1`, but the file people
 * circulate is named "…with customer tabs", so a version with one tab per
 * customer plainly exists. Rather than guess, the sheet with the MOST
 * recognisable header row wins — a per-customer tab holds a subset of the
 * same columns, so picking the widest, longest one lands on the full data
 * sheet instead of whichever tab happened to be first.
 */
export async function readOpenOrdersWorkbook(
  excel: typeof ExcelJS,
  data: ArrayBuffer,
  options: ReadOptions = {},
): Promise<ReadResult> {
  const wb = new excel.Workbook();
  await wb.xlsx.load(data);
  const sheets = wb.worksheets;
  if (sheets.length === 0) throw new OpenOrdersParseError("That workbook has no sheets in it.");

  const availableSheets = sheets.map((s) => s.name);

  if (options.sheetName) {
    const wanted = sheets.find((s) => s.name === options.sheetName);
    if (!wanted) {
      throw new OpenOrdersParseError(
        `That workbook has no sheet called "${options.sheetName}". It has: ${availableSheets.join(", ")}.`,
      );
    }
    return { ...parseOpenOrdersGrid(gridOf(wanted)), sheetName: wanted.name, availableSheets };
  }

  // Try each sheet, biggest first, and take the first that parses. A workbook
  // of per-customer tabs then still produces a report from its data sheet
  // rather than failing on an unparseable summary tab.
  const ordered = [...sheets].sort((a, b) => b.rowCount * b.columnCount - a.rowCount * a.columnCount);
  let firstError: unknown;
  for (const sheet of ordered) {
    try {
      return { ...parseOpenOrdersGrid(gridOf(sheet)), sheetName: sheet.name, availableSheets };
    } catch (err) {
      firstError ??= err;
    }
  }
  throw firstError instanceof Error
    ? firstError
    : new OpenOrdersParseError("Couldn't read any sheet in that workbook.");
}

/** A worksheet as a plain grid of cell values, so the parser stays pure. */
export function gridOf(sheet: ExcelJS.Worksheet): unknown[][] {
  const grid: unknown[][] = [];
  const width = Math.max(1, sheet.columnCount);
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: unknown[] = [];
    for (let c = 1; c <= width; c++) cells.push(row.getCell(c).value);
    grid.push(cells);
  });
  return grid;
}
