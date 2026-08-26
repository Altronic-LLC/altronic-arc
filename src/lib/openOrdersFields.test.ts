import { describe, it, expect } from "vitest";
import { layoutFromColumns, RAW_LAYOUT, type RawColumnOrder } from "./openOrdersFields";

// =============================================================================
// layoutFromColumns — the report's column SET and ORDER come from THIS WEEK'S
// file, not a fixed list (Ray, 2026-08-26: "use the raw uploaded files columns
// and names as they can change week on week... sometimes it may contain more
// or less columns and their headers can change. The layout always should
// match the raw file").
// =============================================================================

describe("layoutFromColumns", () => {
  it("uses the file's own header text, not a canonical label", () => {
    const columns: RawColumnOrder[] = [
      { header: "Promise Date", field: "promiseDate", index: 0 },
    ];
    const layout = layoutFromColumns(columns);
    expect(layout[0].header).toBe("Promise Date");
    expect(layout[0].field).toBe("promiseDate");
  });

  it("keeps the file's own column order, not RAW_LAYOUT's", () => {
    // Reversed relative to the canonical extract.
    const columns: RawColumnOrder[] = [
      { header: "Sales Order", field: "salesOrder", index: 1 },
      { header: "Customer", field: "soldTo", index: 0 },
    ];
    const layout = layoutFromColumns(columns);
    expect(layout.map((c) => c.header)).toEqual(["Sales Order", "Customer"]);
  });

  it("gives a known field its tuned presentation", () => {
    const columns: RawColumnOrder[] = [{ header: "Open Order Value", field: "openValue", index: 0 }];
    const layout = layoutFromColumns(columns);
    expect(layout[0]).toMatchObject({ format: "money", align: "right" });
    expect(layout[0].width).toBeGreaterThan(0);
  });

  it("includes an unrecognised column verbatim, with a generic presentation", () => {
    const columns: RawColumnOrder[] = [{ header: "Profit Centre", field: null, index: 7 }];
    const layout = layoutFromColumns(columns);
    expect(layout[0]).toMatchObject({ header: "Profit Centre", field: null, index: 7 });
    expect(layout[0].format).toBeUndefined();
    expect(layout[0].width).toBeGreaterThanOrEqual(10);
  });

  it("guesses a wider width for a longer unrecognised header", () => {
    const short = layoutFromColumns([{ header: "Zone", field: null, index: 0 }])[0];
    const long = layoutFromColumns([
      { header: "Profit Centre Description", field: null, index: 0 },
    ])[0];
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("reproduces RAW_LAYOUT when fed the canonical extract's own columns in order", () => {
    // Feeding it the exact columns RAW_LAYOUT already describes should come
    // back byte-for-byte the same — the canonical constant is just what this
    // function would have produced from that one file anyway.
    const columns: RawColumnOrder[] = RAW_LAYOUT.map((c, index) => ({
      header: c.header,
      field: c.field,
      index,
    }));
    expect(layoutFromColumns(columns)).toEqual(RAW_LAYOUT);
  });
});
