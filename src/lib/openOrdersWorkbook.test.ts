import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildCustomerWorkbook, buildMasterWorkbook } from "./openOrdersWorkbook";
import { RAW_LAYOUT } from "./openOrdersFields";
import { MOCK_OPEN_ORDER_ACCOUNTS, MOCK_OPEN_ORDER_LINES, MOCK_RUN_DATE } from "@/data/openOrdersMockData";
import { customerReport } from "./openOrders";
import type { OpenOrderCustomerAccount } from "@/types/task";

// =============================================================================
// The workbooks, built and then read back.
//
// Two requirements here are explicit instructions rather than taste, and both
// are the kind a later tidy-up would undo without noticing:
//
//  1. **The columns are the raw extract's, in the raw extract's order** (Ray,
//     2026-08-24: "do not rearrange columns"). People reconcile these sheets
//     against the export side by side.
//  2. **Every workbook is ONE sheet** — "all should be single sheet" — with the
//     one exception he named: a customer's sheet still splits repair orders
//     into a second table below the standard ones.
//
// Plus the branding: ALTRONIC is monochrome black/white with gold as an accent.
// Cooper Red appearing anywhere in here is the wrong brand.
// =============================================================================

const ctx = { runDate: MOCK_RUN_DATE, generatedBy: "Test" };

async function master(): Promise<ExcelJS.Workbook> {
  return buildMasterWorkbook(ExcelJS, MOCK_OPEN_ORDER_LINES, MOCK_OPEN_ORDER_ACCOUNTS, ctx);
}

/** The row the given sheet's table headers are on. */
function headerRowOf(ws: ExcelJS.Worksheet): number {
  for (let r = 1; r <= 20; r++) {
    if (String(ws.getRow(r).getCell(1).value ?? "") === RAW_LAYOUT[0].header) return r;
  }
  throw new Error("no header row found");
}

function headersOf(ws: ExcelJS.Worksheet, row: number): string[] {
  return RAW_LAYOUT.map((_, i) => String(ws.getRow(row).getCell(i + 1).value ?? ""));
}

/**
 * Every colour used anywhere on a sheet — fills, fonts AND borders.
 *
 * Borders matter: the gold accent on the master is a hairline under the header
 * band and a rule under the title, not a fill. A scan that only read fills and
 * fonts reported no gold at all and would have passed a sheet with Cooper Red
 * rules on it.
 */
function coloursOf(ws: ExcelJS.Worksheet): Set<string> {
  const found = new Set<string>();
  const add = (argb?: string) => {
    if (argb) found.add(argb.toUpperCase());
  };
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      add((cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb);
      add((cell.font as { color?: { argb?: string } } | undefined)?.color?.argb);
      const b = cell.border as
        | Record<string, { color?: { argb?: string } } | undefined>
        | undefined;
      for (const side of ["top", "bottom", "left", "right"]) add(b?.[side]?.color?.argb);
    });
  });
  return found;
}

describe("the master workbook", () => {
  it("is a single consolidated sheet", async () => {
    const wb = await master();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Open Orders"]);
  });

  // The instruction, pinned: same columns, same order as the extract.
  it("uses the raw extract's columns in the raw extract's order", async () => {
    const ws = (await master()).getWorksheet("Open Orders")!;
    const row = headerRowOf(ws);
    expect(headersOf(ws, row)).toEqual(RAW_LAYOUT.map((c) => c.header));
  });

  it("carries every line", async () => {
    const ws = (await master()).getWorksheet("Open Orders")!;
    const row = headerRowOf(ws);
    // header + rows + one totals row
    expect(ws.rowCount).toBe(row + MOCK_OPEN_ORDER_LINES.length + 1);
  });

  it("leads with the real wordmark image and the run date", async () => {
    const wb = await master();
    const ws = wb.getWorksheet("Open Orders")!;
    // The official PNG, embedded — not styled text pretending to be the mark.
    expect(wb.model.media?.some((m) => m.extension === "png")).toBe(true);
    expect(ws.getImages()).toHaveLength(1);
    expect(String(ws.getRow(4).getCell(1).value)).toContain("2026-08-24");
  });

  // The mark is 2001 x 245; a hand-picked width and height would eventually
  // drift from that and stretch it.
  it("places the wordmark at its own aspect ratio", async () => {
    const ws = (await master()).getWorksheet("Open Orders")!;
    const img = ws.getImages()[0] as unknown as { range: { ext: { width: number; height: number } } };
    const ratio = img.range.ext.width / img.range.ext.height;
    expect(ratio).toBeCloseTo(2001 / 245, 1);
  });

  it("freezes the header and offers a filter", async () => {
    const ws = (await master()).getWorksheet("Open Orders")!;
    const row = headerRowOf(ws);
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: row });
    expect(ws.autoFilter).toMatchObject({ from: { row, column: 1 } });
  });

  // The split is a customer-file feature; the master is one undivided table.
  it("is not split into standard and repair sections", async () => {
    const ws = (await master()).getWorksheet("Open Orders")!;
    let headings = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (/^REPAIR ORDERS \(/.test(String(row.getCell(1).value ?? ""))) headings += 1;
    });
    expect(headings).toBe(0);
  });

  it("totals only the columns where a sum means anything", async () => {
    const ws = (await master()).getWorksheet("Open Orders")!;
    const totals = ws.getRow(ws.rowCount);
    expect(String(totals.getCell(1).value)).toMatch(/^TOTAL/);
    // Sales Order is text — a total under it would be nonsense.
    const salesOrderCol = RAW_LAYOUT.findIndex((c) => c.header === "Sales Order") + 1;
    expect(totals.getCell(salesOrderCol).value).toBeFalsy();
    const openValueCol = RAW_LAYOUT.findIndex((c) => c.header === "Open Order Value") + 1;
    expect(typeof totals.getCell(openValueCol).value).toBe("number");
  });
});

describe("Altronic branding", () => {
  it("puts white semibold headings on a black band", async () => {
    const ws = (await master()).getWorksheet("Open Orders")!;
    const cell = ws.getRow(headerRowOf(ws)).getCell(1);
    expect((cell.fill as { fgColor: { argb: string } }).fgColor.argb).toBe("FF000000");
    expect(cell.font?.color?.argb).toBe("FFFFFFFF");
    expect(cell.font?.name).toBe("Segoe UI Semibold");
  });

  // Cooper Red was the palette here before the brand guidelines arrived. It is
  // the other company's brand and must not come back.
  it("uses no Cooper colours anywhere", async () => {
    const used = coloursOf((await master()).getWorksheet("Open Orders")!);
    for (const cooper of ["FFCB2C30", "FFF8C237", "FF009A44", "FF1C60AC", "FF707372"]) {
      expect(used.has(cooper)).toBe(false);
    }
  });

  it("uses the gold accent, and only from the Altronic palette", async () => {
    const used = coloursOf((await master()).getWorksheet("Open Orders")!);
    // Gold survives as the hairline under the header band — the accent, used
    // once, rather than as a row state.
    expect(used.has("FFCBA052")).toBe(true);
    const allowed = new Set([
      "FF000000", // black
      "FFFFFFFF", // white
      "FFE2E2E2", // light grey — row banding and totals
      "FFA5A5A5", // medium grey
      "FF595959", // dark grey
      "FFCBA052", // gold
    ]);
    expect([...used].filter((c) => !allowed.has(c))).toEqual([]);
  });

  // Shading is structure, not meaning. It used to wash a row gold when the line
  // was past due, which made the table look patchy and gave the banding two
  // jobs at once.
  it("bands every other row and nothing else", async () => {
    const ws = (await master()).getWorksheet("Open Orders")!;
    const header = headerRowOf(ws);
    const fills: string[] = [];
    for (let r = header + 1; r < ws.rowCount; r++) {
      const fill = ws.getRow(r).getCell(1).fill as { fgColor?: { argb?: string } } | undefined;
      fills.push(fill?.fgColor?.argb?.toUpperCase() ?? "none");
    }
    // Strictly alternating: unbanded, banded, unbanded, …
    fills.forEach((f, i) => {
      expect(f).toBe(i % 2 === 1 ? "FFE2E2E2" : "none");
    });
  });
});

describe("a customer workbook", () => {
  const account: OpenOrderCustomerAccount = MOCK_OPEN_ORDER_ACCOUNTS[0];
  const report = customerReport(account, MOCK_OPEN_ORDER_LINES, MOCK_RUN_DATE);

  async function build(): Promise<ExcelJS.Workbook> {
    return buildCustomerWorkbook(ExcelJS, report, account, ctx);
  }

  it("is a single sheet, like the master", async () => {
    expect((await build()).worksheets.map((w) => w.name)).toEqual(["Open Orders"]);
  });

  // The figures the Summary tab used to carry, kept as one line rather than a
  // whole tab.
  it("carries the customer's headline figures under the title", async () => {
    const ws = (await build()).getWorksheet("Open Orders")!;
    let found = "";
    ws.eachRow({ includeEmpty: false }, (row) => {
      const v = String(row.getCell(1).value ?? "");
      if (/open lines across/.test(v)) found = v;
    });
    expect(found).toMatch(/open lines across/);
    expect(found).toMatch(/past due/);
  });

  // Same instruction as the master.
  it("uses the raw columns in the raw order", async () => {
    const ws = (await build()).getWorksheet("Open Orders")!;
    expect(headersOf(ws, headerRowOf(ws))).toEqual(RAW_LAYOUT.map((c) => c.header));
  });

  // Standard orders first, repairs in their own table below — asked for
  // explicitly and separately from everything else.
  it("puts the repair orders in a second table below the first", async () => {
    const ws = (await build()).getWorksheet("Open Orders")!;
    const headings: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const first = String(row.getCell(1).value ?? "");
      if (/^OPEN ORDERS \(|^REPAIR ORDERS \(/.test(first)) headings.push(first);
    });
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatch(/^OPEN ORDERS \(/);
    expect(headings[1]).toMatch(/^REPAIR ORDERS \(/);
  });

  it("names the customer and their account, not another customer", async () => {
    const ws = (await build()).getWorksheet("Open Orders")!;
    expect(String(ws.getRow(3).getCell(1).value)).toContain(account.customerName);
    expect(String(ws.getRow(3).getCell(1).value)).toContain(account.accountNumber);
  });

  it("shows the customer's own lines only", async () => {
    const ws = (await build()).getWorksheet("Open Orders")!;
    const nameCol = RAW_LAYOUT.findIndex((c) => c.header === "Customer Name") + 1;
    const names = new Set<string>();
    ws.eachRow({ includeEmpty: false }, (row) => {
      const v = row.getCell(nameCol).value;
      if (typeof v === "string" && v && v !== "Customer Name") names.add(v);
    });
    expect([...names]).toEqual(["PERMIAN MIDSTREAM PARTNERS LP"]);
  });

  it("says the repairs are unpriced rather than showing a column of zeros", async () => {
    const ws = (await build()).getWorksheet("Open Orders")!;
    let said = false;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (/not priced in this report/i.test(String(row.getCell(1).value ?? ""))) said = true;
    });
    expect(said).toBe(true);
  });
});
