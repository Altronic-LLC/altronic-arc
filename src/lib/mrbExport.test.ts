import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { MrbEntry } from "@/types/task";
import {
  buildMrbPdf,
  buildMrbWorkbook,
  mrbCostTotal,
  mrbExportFileName,
  mrbPresetRange,
  mrbRangeProblem,
  mrbWindowLabel,
  selectMrbExport,
} from "./mrbExport";

// =============================================================================
// The MRB meeting export. What's worth pinning:
//   - archive rows never go in;
//   - an undecided entry from BEFORE the window still goes in by default (the
//     backlog is the meeting), and doesn't when that's unticked;
//   - a decided entry goes in only inside the window, bounds inclusive;
//   - the PDF and the workbook actually carry the rows (real text, read back).
// =============================================================================

function entry(over: Partial<MrbEntry> = {}): MrbEntry {
  return {
    id: 1,
    sapNumber: "1000-0001-00",
    mrbDate: new Date("2026-10-01T12:00:00Z"),
    oldPartNumber: "",
    quantity: 1,
    description: "",
    reason: "",
    whereCaused: "",
    disposition: "",
    vendorName: "",
    pricePerUnit: null,
    pricePerIssue: null,
    notes: "",
    comments: [],
    watchers: [],
    dataFormat: "Current",
    sourceYear: 2026,
    provenance: {},
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

const day = (key: string) => new Date(`${key}T12:00:00Z`);

const OPEN_IN = entry({ id: 1, sapNumber: "OPEN-IN", mrbDate: day("2026-10-05"), pricePerIssue: 100 });
const OPEN_OLD = entry({ id: 2, sapNumber: "OPEN-OLD", mrbDate: day("2026-06-01"), disposition: "To be Determined", pricePerIssue: 50.5 });
const OPEN_UNDATED = entry({ id: 3, sapNumber: "OPEN-UNDATED", mrbDate: null });
const DECIDED_IN = entry({ id: 4, sapNumber: "DECIDED-IN", mrbDate: day("2026-10-20"), disposition: "Scrap", pricePerIssue: 25 });
const DECIDED_EDGE = entry({ id: 5, sapNumber: "DECIDED-EDGE", mrbDate: day("2026-09-21"), disposition: "RMA" });
const DECIDED_OLD = entry({ id: 6, sapNumber: "DECIDED-OLD", mrbDate: day("2026-09-20"), disposition: "Rework" });
const ARCHIVE_OPEN = entry({ id: 7, sapNumber: "ARCHIVE", mrbDate: day("2026-10-05"), dataFormat: "Legacy" });

const ALL = [DECIDED_IN, OPEN_UNDATED, ARCHIVE_OPEN, OPEN_IN, DECIDED_OLD, OPEN_OLD, DECIDED_EDGE];
const WINDOW = { from: "2026-09-21", to: "2026-10-20" };
const AT = new Date(2026, 9, 20, 9, 30);

const ids = (list: MrbEntry[]) => list.map((e) => e.sapNumber);

describe("selectMrbExport", () => {
  it("includes every undecided live entry by default, oldest first, undated last", () => {
    const model = selectMrbExport(ALL, { ...WINDOW, includeAllOpen: true }, AT);
    expect(ids(model.needs)).toEqual(["OPEN-OLD", "OPEN-IN", "OPEN-UNDATED"]);
  });

  it("keeps undecided entries to the window when asked to", () => {
    const model = selectMrbExport(ALL, { ...WINDOW, includeAllOpen: false }, AT);
    expect(ids(model.needs)).toEqual(["OPEN-IN"]);
  });

  it("includes decided entries inside the window only, both bounds inclusive", () => {
    const model = selectMrbExport(ALL, { ...WINDOW, includeAllOpen: true }, AT);
    expect(ids(model.decided)).toEqual(["DECIDED-EDGE", "DECIDED-IN"]);
  });

  it("never includes an archive row", () => {
    const model = selectMrbExport(ALL, { from: "", to: "", includeAllOpen: true }, AT);
    expect(ids([...model.needs, ...model.decided])).not.toContain("ARCHIVE");
  });

  it("treats a blank bound as open-ended", () => {
    const model = selectMrbExport(ALL, { from: "", to: "2026-09-30", includeAllOpen: false }, AT);
    expect(ids(model.decided)).toEqual(["DECIDED-OLD", "DECIDED-EDGE"]);
  });
});

describe("mrbPresetRange", () => {
  const today = new Date(2026, 9, 20);
  it("ends today and counts today as one of the days", () => {
    expect(mrbPresetRange("7d", today)).toEqual({ from: "2026-10-14", to: "2026-10-20" });
    expect(mrbPresetRange("30d", today)).toEqual({ from: "2026-09-21", to: "2026-10-20" });
    expect(mrbPresetRange("month", today)).toEqual({ from: "2026-10-01", to: "2026-10-20" });
    expect(mrbPresetRange("year", today)).toEqual({ from: "2026-01-01", to: "2026-10-20" });
  });
});

describe("helpers", () => {
  it("refuses a From after the To", () => {
    expect(mrbRangeProblem("2026-10-21", "2026-10-20")).toMatch(/after/);
    expect(mrbRangeProblem("2026-10-20", "2026-10-20")).toBeNull();
    expect(mrbRangeProblem("", "2026-10-20")).toBeNull();
  });

  it("totals the cost, a blank price adding nothing", () => {
    expect(mrbCostTotal([OPEN_IN, OPEN_OLD, OPEN_UNDATED])).toBe(150.5);
  });

  it("names the file after the window", () => {
    expect(mrbExportFileName(WINDOW, "pdf")).toBe("MRB 2026-09-21 to 2026-10-20.pdf");
    expect(mrbExportFileName({ from: "", to: "" }, "xlsx")).toBe("MRB all dates.xlsx");
  });

  it("says open ends in words", () => {
    expect(mrbWindowLabel("", "")).toBe("All dates");
    expect(mrbWindowLabel("2026-09-21", "")).toMatch(/onward$/);
    expect(mrbWindowLabel("", "2026-10-20")).toMatch(/^Up to /);
  });
});

function pdfText(raw: string): string {
  const runs: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    runs.push(
      m[1].replace(/\\([0-7]{1,3}|.)/g, (_, esc: string) =>
        /^[0-7]+$/.test(esc) ? String.fromCharCode(parseInt(esc, 8)) : esc,
      ),
    );
  }
  return runs.join("\n").replace(/\u0096/g, "–");
}

describe("buildMrbPdf", () => {
  it("prints both sections with their rows and totals", async () => {
    const model = selectMrbExport(ALL, { ...WINDOW, includeAllOpen: true }, AT);
    const text = pdfText((await buildMrbPdf(model, { compress: false, logo: false })).output());
    expect(text).toContain("MATERIAL REVIEW BOARD");
    expect(text).toContain("NEEDS DISPOSITION (3)");
    expect(text).toContain("DECIDED (2)");
    for (const sap of ["OPEN-OLD", "OPEN-IN", "OPEN-UNDATED", "DECIDED-IN", "DECIDED-EDGE"]) {
      expect(text).toContain(sap);
    }
    expect(text).not.toContain("ARCHIVE");
    expect(text).not.toContain("DECIDED-OLD");
    expect(text).toContain("$175.50 total cost");
    expect(text).toContain("To be Determined");
  });

  it("says None for an empty section rather than drawing an empty table", async () => {
    const model = selectMrbExport([DECIDED_IN], { ...WINDOW, includeAllOpen: true }, AT);
    const text = pdfText((await buildMrbPdf(model, { compress: false, logo: false })).output());
    expect(text).toContain("NEEDS DISPOSITION (0)");
    expect(text).toContain("None.");
  });
});

describe("buildMrbWorkbook", () => {
  it("writes one row per entry, with real dates and numbers and a Status to filter on", async () => {
    const model = selectMrbExport(ALL, { ...WINDOW, includeAllOpen: true }, AT);
    const buffer = await buildMrbWorkbook(ExcelJS, model);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet("MRB")!;

    const header = sheet.getRow(4);
    expect(header.getCell(1).value).toBe("Status");
    expect(sheet.autoFilter).toBeTruthy();

    const rows = [5, 6, 7, 8, 9].map((n) => sheet.getRow(n));
    expect(rows.map((r) => r.getCell(3).value)).toEqual([
      "OPEN-OLD",
      "OPEN-IN",
      "OPEN-UNDATED",
      "DECIDED-EDGE",
      "DECIDED-IN",
    ]);
    expect(rows[0].getCell(1).value).toBe("To be Determined");
    expect(rows[1].getCell(1).value).toBe("Needs disposition");
    expect(rows[3].getCell(1).value).toBe("Decided");

    const date = rows[1].getCell(2).value as Date;
    expect(date).toBeInstanceOf(Date);
    expect(date.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(rows[1].getCell(9).value).toBe(100);

    const total = sheet.getRow(10);
    expect(total.getCell(1).value).toBe("Total");
    expect(total.getCell(9).value).toBe(175.5);
  });
});
