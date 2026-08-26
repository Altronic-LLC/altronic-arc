import { describe, it, expect } from "vitest";
import {
  OpenOrdersParseError,
  dateCellOnly,
  date,
  findHeaderRow,
  number,
  parseOpenOrdersGrid,
  text,
} from "./openOrdersParse";

// =============================================================================
// The parser, against the shape of the live extract (OOR 8-21-2026, sheet
// Data1, 27 columns, 2,031 rows).
//
// The awkward cases here are all real: comments that are dates, a customer
// name truncated at 30 characters, unpriced repair lines, two EUR rows among
// two thousand USD ones, and no shipped-quantity column at all.
// =============================================================================

/** The live extract's header row, in its real order. */
const HEADERS = [
  "Created On",
  "Ship Date",
  "Comments",
  "Customer",
  "Customer Name",
  "Sales Order",
  "Customer Reference",
  "Material",
  "AI Part Number",
  "Material Description",
  "Open quantity",
  "Net Price",
  "Open Order Value",
  "Sales Office",
  "Customer required date",
  "Ship-to Party",
  "Order Quantity",
  "Net Value",
  "Item (SD)",
  "Created By",
  "Delivery Status",
  "Currency",
  "Sales Document Type",
  "Repair order",
  "MRP Controller",
  "Delivery Block",
  "Reason for rejection",
];

interface RowOverrides {
  [header: string]: unknown;
}

/** One data row shaped like the live extract's, with overrides by header. */
function row(over: RowOverrides = {}): unknown[] {
  const base: RowOverrides = {
    "Created On": new Date(Date.UTC(2026, 6, 1)),
    "Ship Date": new Date(Date.UTC(2026, 8, 30)),
    Comments: null,
    Customer: "105126",
    "Customer Name": "Wabtec Transportation Systems,",
    "Sales Order": "20416165",
    "Customer Reference": "NCMR-2024-109044",
    Material: "1006-9794-00",
    "AI Part Number": "691768-1",
    "Material Description": "SERIES-X CONTROLLER, GET",
    "Open quantity": 2,
    "Net Price": 150,
    "Open Order Value": 300,
    "Sales Office": "0001",
    "Customer required date": new Date(Date.UTC(2026, 8, 30)),
    "Ship-to Party": "190493",
    "Order Quantity": 3,
    "Net Value": 450,
    "Item (SD)": "110",
    "Created By": "U4AL_RB",
    "Delivery Status": "A",
    Currency: "USD",
    "Sales Document Type": "ZTA",
    "Repair order": null,
    "MRP Controller": "DC",
    "Delivery Block": null,
    "Reason for rejection": null,
    ...over,
  };
  return HEADERS.map((h) => base[h] ?? null);
}

function grid(rows: unknown[][] = [row()], headers = HEADERS): unknown[][] {
  return [headers, ...rows];
}

describe("findHeaderRow", () => {
  it("finds the header on row 1, where the live extract has it", () => {
    expect(findHeaderRow(grid())).toBe(0);
  });

  // People add a title or a run date above an export and re-save it. Insisting
  // on row 1 fails a file that is otherwise perfectly good.
  it("finds a header pushed down by a title and a blank row", () => {
    const g = [["Open Orders Report"], [], ["as at 21/08/2026"], ...grid()];
    expect(findHeaderRow(g)).toBe(3);
  });

  // One stray cell reading "Customer" shouldn't win.
  it("needs three recognisable headings, not one", () => {
    const g = [["Customer"], ...grid()];
    expect(findHeaderRow(g)).toBe(1);
  });

  it("says so plainly when the file isn't an open orders extract", () => {
    expect(() => findHeaderRow([["Name", "Address"], ["a", "b"]])).toThrow(OpenOrdersParseError);
    expect(() => findHeaderRow([["Name"]])).toThrow(/doesn't look like an open orders extract/);
  });
});

describe("required columns", () => {
  it("names the missing column rather than failing vaguely", () => {
    const headers = HEADERS.filter((h) => h !== "Open quantity");
    const rows = [row()].map((r) => r.slice(0, headers.length));
    expect(() => parseOpenOrdersGrid([headers, ...rows])).toThrow(/Open quantity/);
  });

  it("refuses a file with headings but no rows under them", () => {
    expect(() => parseOpenOrdersGrid([HEADERS])).toThrow(/no order lines/);
  });
});

describe("header matching", () => {
  it("ignores case, spaces and punctuation", () => {
    const headers = HEADERS.map((h) =>
      h === "Open quantity" ? "OPEN  QUANTITY" : h === "Customer" ? "customer" : h,
    );
    const { lines } = parseOpenOrdersGrid([headers, row()]);
    expect(lines[0].openQty).toBe(2);
    expect(lines[0].soldTo).toBe("105126");
  });

  it("accepts a renamed column through its alias", () => {
    const headers = HEADERS.map((h) => (h === "Ship Date" ? "Confirmed Delivery Date" : h));
    const { lines } = parseOpenOrdersGrid([headers, row()]);
    expect(lines[0].promiseDate).toEqual(new Date(Date.UTC(2026, 8, 30, 12)));
  });

  // A duplicated column is usually a copy somebody left behind.
  it("takes the left-most of a repeated column", () => {
    const headers = [...HEADERS, "Open quantity"];
    const { lines } = parseOpenOrdersGrid([headers, [...row(), 999]]);
    expect(lines[0].openQty).toBe(2);
  });

  it("reports a column it doesn't read, so a new SAP field gets noticed", () => {
    const { warnings, unmappedHeaders } = parseOpenOrdersGrid([
      [...HEADERS, "Profit Centre"],
      [...row(), "X"],
    ]);
    expect(unmappedHeaders).toEqual(["Profit Centre"]);
    expect(warnings.find((w) => w.kind === "unmapped-column")?.message).toContain("Profit Centre");
  });

  // Net Value is in the extract and deliberately unused; it shouldn't be
  // reported every single week as a surprise.
  it("doesn't report the columns it deliberately ignores", () => {
    expect(parseOpenOrdersGrid(grid()).unmappedHeaders).toEqual([]);
  });
});

// =============================================================================
// `columns` — the file's own header row, in its own order. This is the one
// thing a report's layout is built from (layoutFromColumns), so SAP adding,
// dropping, renaming, or reordering a column has to show up here exactly.
// =============================================================================
describe("columns", () => {
  it("lists every column in the file's own order, known and unknown alike", () => {
    const { columns } = parseOpenOrdersGrid([[...HEADERS, "Profit Centre"], [...row(), "X"]]);
    expect(columns.map((c) => c.header)).toEqual([...HEADERS, "Profit Centre"]);
    expect(columns.at(-1)).toEqual({ header: "Profit Centre", field: null, index: HEADERS.length });
  });

  it("reflects a reordered file, not the canonical order", () => {
    const reordered = ["Sales Order", "Customer", ...HEADERS.filter((h) => !["Sales Order", "Customer"].includes(h))];
    const { columns } = parseOpenOrdersGrid([reordered, row()]);
    expect(columns[0]).toMatchObject({ header: "Sales Order", field: "salesOrder" });
    expect(columns[1]).toMatchObject({ header: "Customer", field: "soldTo" });
  });

  it("carries the file's own header text for a renamed known column", () => {
    const headers = HEADERS.map((h) => (h === "Ship Date" ? "Confirmed Delivery Date" : h));
    const { columns } = parseOpenOrdersGrid([headers, row()]);
    const shipCol = columns.find((c) => c.field === "promiseDate");
    expect(shipCol?.header).toBe("Confirmed Delivery Date");
  });

  it("drops a column entirely when the file doesn't have it", () => {
    const headers = HEADERS.filter((h) => h !== "MRP Controller");
    const { columns, lines } = parseOpenOrdersGrid([headers, row()]);
    expect(columns.some((c) => c.field === "mrpController")).toBe(false);
    expect(lines[0].mrpController).toBe("");
  });

  it("drops a duplicated known column's repeat from the layout too", () => {
    const headers = [...HEADERS, "Open quantity"];
    const { columns } = parseOpenOrdersGrid([headers, [...row(), 999]]);
    expect(columns.filter((c) => c.field === "openQty")).toHaveLength(1);
  });
});

describe("raw — values for columns ARC doesn't map", () => {
  it("carries an unmapped column's value on the line, keyed by its file index", () => {
    const { lines } = parseOpenOrdersGrid([
      [...HEADERS, "Profit Centre"],
      [...row(), "PC-04"],
    ]);
    expect(lines[0].raw?.[HEADERS.length]).toBe("PC-04");
  });

  it("carries nothing when every column in the file is recognised", () => {
    const { lines } = parseOpenOrdersGrid(grid());
    expect(lines[0].raw).toBeUndefined();
  });

  it("carries more than one unmapped column, each at its own index", () => {
    const headers = [...HEADERS, "Profit Centre", "Plant"];
    const { lines } = parseOpenOrdersGrid([headers, [...row(), "PC-04", "1000"]]);
    expect(lines[0].raw).toEqual({
      [HEADERS.length]: "PC-04",
      [HEADERS.length + 1]: "1000",
    });
  });
});

describe("rows", () => {
  it("maps the live extract's columns onto the domain fields", () => {
    const [line] = parseOpenOrdersGrid(grid()).lines;
    expect(line).toMatchObject({
      soldTo: "105126",
      customerName: "Wabtec Transportation Systems,",
      salesOrder: "20416165",
      lineNo: "110",
      material: "1006-9794-00",
      altronicPartNumber: "691768-1",
      orderType: "ZTA",
      openQty: 2,
      orderQty: 3,
      unitPrice: 150,
      openValue: 300,
      currency: "USD",
      customerPo: "NCMR-2024-109044",
      shipTo: "190493",
      status: "A",
      mrpController: "DC",
      createdBy: "U4AL_RB",
    });
  });

  // There is no shipped column in the extract; 55 rows are part-shipped.
  it("derives shipped quantity from order minus open", () => {
    expect(parseOpenOrdersGrid(grid()).lines[0].shippedQty).toBe(1);
  });

  it("never reports a negative shipment when the data is odd", () => {
    const { lines } = parseOpenOrdersGrid(grid([row({ "Open quantity": 9, "Order Quantity": 2 })]));
    expect(lines[0].shippedQty).toBe(0);
  });

  it("trusts the extract's own open value, which ties out on every row", () => {
    const { lines } = parseOpenOrdersGrid(grid([row({ "Open Order Value": 1234.56 })]));
    expect(lines[0].openValue).toBe(1234.56);
  });

  // Reporting a blank as zero would understate the total silently.
  it("computes the value when the column is blank", () => {
    const { lines } = parseOpenOrdersGrid(
      grid([row({ "Open Order Value": null, "Open quantity": 3, "Net Price": 12.5 })]),
    );
    expect(lines[0].openValue).toBe(37.5);
  });

  it("defaults a missing currency to USD rather than an empty string", () => {
    const { lines } = parseOpenOrdersGrid(grid([row({ Currency: null })]));
    expect(lines[0].currency).toBe("USD");
  });

  // A totals row left on the sheet is not an order.
  it("skips a row with no customer and no order, and says how many", () => {
    const junk: unknown[] = HEADERS.map(() => null);
    junk[HEADERS.indexOf("Open Order Value")] = 999999;
    const { lines, warnings } = parseOpenOrdersGrid(grid([row(), junk]));
    expect(lines).toHaveLength(1);
    expect(warnings.find((w) => w.kind === "skipped-row")?.count).toBe(1);
  });

  it("doesn't count a fully empty row as skipped", () => {
    const { warnings } = parseOpenOrdersGrid(grid([row(), HEADERS.map(() => null)]));
    expect(warnings.find((w) => w.kind === "skipped-row")).toBeUndefined();
  });
});

describe("repairs, as the live extract marks them", () => {
  it("reads the literal 'repair' document type and its repair order number", () => {
    const { lines } = parseOpenOrdersGrid(
      grid([row({ "Sales Document Type": "repair", "Repair order": "4306713" })]),
    );
    expect(lines[0].orderType).toBe("repair");
    expect(lines[0].repairOrder).toBe("4306713");
  });
});

describe("comments — a date or prose, never both", () => {
  // 147 of the 166 comments in the live extract are dates: somebody types a
  // revised expected ship date into the column.
  it("keeps a date comment as a real date", () => {
    const { lines } = parseOpenOrdersGrid(grid([row({ Comments: new Date(Date.UTC(2026, 8, 30)) })]));
    expect(lines[0].commentDate).toEqual(new Date(Date.UTC(2026, 8, 30, 12)));
    expect(lines[0].comments).toBe("");
  });

  it("keeps prose as prose", () => {
    const note = "Shipping in September. Exact date is pending when the tooling is received";
    const { lines } = parseOpenOrdersGrid(grid([row({ Comments: note })]));
    expect(lines[0].comments).toBe(note);
    expect(lines[0].commentDate).toBeNull();
  });

  // The one that matters: loose date parsing over this would invent a date.
  it("does NOT turn a comment mentioning dates into a date", () => {
    const { lines } = parseOpenOrdersGrid(grid([row({ Comments: "ship 3 by  08-28 \n\n20 to ship  09- 14" })]));
    expect(lines[0].commentDate).toBeNull();
    expect(lines[0].comments).toContain("20 to ship");
  });
});

describe("warnings the user has to know about", () => {
  it("flags mixed currencies, because their sum is not money", () => {
    const { warnings } = parseOpenOrdersGrid(grid([row(), row({ Currency: "EUR" })]));
    const w = warnings.find((x) => x.kind === "mixed-currency");
    expect(w?.message).toContain("EUR and USD");
    expect(w?.message).toContain("no exchange rate");
  });

  it("says nothing about currency when there's only one", () => {
    expect(parseOpenOrdersGrid(grid()).warnings.find((w) => w.kind === "mixed-currency")).toBeUndefined();
  });

  // All 442 repair lines in the live extract are unpriced, so "repairs = $0"
  // needs explaining rather than looking like a broken export.
  it("counts the unpriced lines", () => {
    const { warnings } = parseOpenOrdersGrid(
      grid([row(), row({ "Net Price": 0, "Open Order Value": 0 })]),
    );
    expect(warnings.find((w) => w.kind === "unpriced-lines")?.count).toBe(1);
  });

  it("counts lines with no ship date", () => {
    const { warnings } = parseOpenOrdersGrid(grid([row({ "Ship Date": null })]));
    const w = warnings.find((x) => x.kind === "no-promise-date");
    expect(w?.count).toBe(1);
    expect(w?.message).toContain("rather than counting as past due");
  });

  it("counts lines with nothing actually outstanding", () => {
    const { warnings } = parseOpenOrdersGrid(grid([row({ "Open quantity": 0 })]));
    expect(warnings.find((w) => w.kind === "zero-open-qty")?.count).toBe(1);
  });
});

describe("text()", () => {
  it("trims a string", () => {
    expect(text("  a  ")).toBe("a");
  });

  it("is empty for nothing", () => {
    expect(text(null)).toBe("");
    expect(text(undefined)).toBe("");
  });

  it("keeps a number as its digits", () => {
    expect(text(105126)).toBe("105126");
  });

  // ExcelJS hands back an object for a formatted or formula cell; stringifying
  // it puts "[object Object]" in a report.
  it("unwraps rich text", () => {
    expect(text({ richText: [{ text: "Series-X " }, { text: "Controller" }] })).toBe(
      "Series-X Controller",
    );
  });

  it("unwraps a formula result", () => {
    expect(text({ formula: "A1", result: "ZTA" })).toBe("ZTA");
  });

  it("renders a date as an ISO day", () => {
    expect(text(new Date(Date.UTC(2026, 8, 30)))).toBe("2026-09-30");
  });

  it("gives up on an object it doesn't recognise, rather than [object Object]", () => {
    expect(text({ nope: 1 })).toBe("");
  });
});

describe("number()", () => {
  it("passes a number through", () => {
    expect(number(1234.56)).toBe(1234.56);
  });

  it("strips thousands separators and currency marks", () => {
    expect(number("$1,234.56")).toBe(1234.56);
    expect(number("€85,036")).toBe(85036);
  });

  it("reads an accounting negative", () => {
    expect(number("(1,234.00)")).toBe(-1234);
  });

  it("unwraps a formula result", () => {
    expect(number({ formula: "A1*B1", result: 300 })).toBe(300);
  });

  it("is zero for blanks and nonsense, so a total can't be poisoned", () => {
    expect(number(null)).toBe(0);
    expect(number("n/a")).toBe(0);
    expect(number(Number.NaN)).toBe(0);
    expect(number(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("date()", () => {
  // Midday, for the reason every other date in ARC uses it: midnight UTC
  // renders as the previous day across the US.
  it("normalises to midday UTC", () => {
    expect(date(new Date("2026-09-30T23:45:00Z"))).toEqual(new Date(Date.UTC(2026, 8, 30, 12)));
  });

  it("reads an ISO string", () => {
    expect(date("2026-09-30")).toEqual(new Date(Date.UTC(2026, 8, 30, 12)));
  });

  it("reads a US-style date", () => {
    expect(date("9/30/2026")).toEqual(new Date(Date.UTC(2026, 8, 30, 12)));
  });

  // A sheet through a CSV round-trip loses its date formatting.
  it("reads an Excel serial number", () => {
    expect(date(46295)).toEqual(new Date(Date.UTC(2026, 8, 30, 12)));
  });

  it("is null for a blank or unreadable value", () => {
    expect(date(null)).toBeNull();
    expect(date("")).toBeNull();
    expect(date("not a date")).toBeNull();
    expect(date(0)).toBeNull();
  });
});

describe("dateCellOnly()", () => {
  it("takes a real date", () => {
    expect(dateCellOnly(new Date(Date.UTC(2026, 8, 30)))).toEqual(new Date(Date.UTC(2026, 8, 30, 12)));
  });

  it("takes an Excel serial", () => {
    expect(dateCellOnly(46295)).toEqual(new Date(Date.UTC(2026, 8, 30, 12)));
  });

  // The whole point: it must NOT parse loose strings the way date() does.
  it("refuses prose, however date-like", () => {
    expect(dateCellOnly("2026-09-30")).toBeNull();
    expect(dateCellOnly("ship 3 by 08-28")).toBeNull();
    expect(dateCellOnly("Shipping in September")).toBeNull();
  });

  it("is null for a blank", () => {
    expect(dateCellOnly(null)).toBeNull();
  });
});
