import { describe, expect, it } from "vitest";
import type { NewProductRevision, NewProductWorksheet, SubAssemblyTotals } from "@/types/pricing";
import {
  lineFromWorksheet,
  lineFromWorksheetRow,
  pricedRowsOf,
  refreshWorksheetLine,
  worksheetIsQuotable,
  worksheetLineIsStale,
} from "./customerQuotes";

// =============================================================================
// A quote line for ONE separately priced sub-assembly (Ray, 2026-10-14). It is
// read from the worksheet's CURRENT revision snapshot — what was saved — and
// pinned to that revision like a whole-product line.
// =============================================================================

const BOARD: SubAssemblyTotals = {
  name: "Board",
  quantityPerProduct: 1,
  lineCount: 3,
  uploadedCost: 10,
  cost: 12,
  altronicPartNumber: "791990-24",
  sapPartNumber: "1003-0200-24",
  sellingPrice: { distributorDiscountPct: 34, unitCost: 12, listPrice: 30, baseGM: 39.4, priceBreaks: [{ minQty: 10, discountPct: 10 }] },
};
const COIL: SubAssemblyTotals = { name: "Coil", quantityPerProduct: 1, lineCount: 1, uploadedCost: 5, cost: 5 };

function snap(rev: number, subAssemblies: SubAssemblyTotals[]): NewProductRevision {
  return {
    rev,
    savedAt: "2026-10-14T12:00:00Z",
    savedBy: { displayName: "Brandon", email: "b@x.com" },
    note: "",
    subAssemblies,
    overheadPct: 0,
    uploadedUnitCost: null,
    unitCost: null,
    mpg: "",
    distributorDiscountPct: 34,
    discountSource: "Default",
    input: null,
    listPrice: null,
    baseGM: null,
    priceBreaks: [],
  };
}

function ws(over: Partial<NewProductWorksheet> = {}): NewProductWorksheet {
  return {
    id: 5,
    worksheetNumber: "NP-2026-0001",
    status: "Active",
    rev: 2,
    productName: "Widget",
    description: "",
    customerSoldTo: "",
    customerName: "",
    expectedAnnualVolume: null,
    requestId: null,
    overheadPct: 0,
    mpg: "",
    distributorDiscountPct: 34,
    discountSource: "Default",
    targetGM: null,
    unitCost: null,
    listPrice: null,
    baseGM: null,
    priceBreaks: [],
    altronicPartNumber: "",
    sapPartNumber: "",
    comparisonParts: [],
    history: [snap(1, [COIL]), snap(2, [BOARD, COIL])],
    historyCorrupt: false,
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdBy: null,
    createdAt: null,
    modifiedAt: null,
    ...over,
  };
}

describe("pricedRowsOf / worksheetIsQuotable", () => {
  it("lists only the CURRENT revision's separately priced rows", () => {
    expect(pricedRowsOf(ws()).map((r) => r.name)).toEqual(["Board"]);
    expect(pricedRowsOf(ws({ rev: 1 }))).toEqual([]);
  });

  it("a worksheet with no product price is still quotable when a row has its own", () => {
    expect(worksheetIsQuotable(ws())).toBe(true);
    expect(worksheetIsQuotable(ws({ rev: 1 }))).toBe(false);
    expect(worksheetIsQuotable(ws({ rev: 1, listPrice: 100 }))).toBe(true);
    // And the whole-product line still needs a product price.
    expect(lineFromWorksheet(ws(), 34)).toBeNull();
  });
});

describe("lineFromWorksheetRow", () => {
  it("prices the row at its list and breaks less the discount, pinned to the revision", () => {
    const line = lineFromWorksheetRow(ws(), "Board", 34, 4)!;
    expect(line).toMatchObject({
      kind: "worksheet",
      partNumber: "791990-24",
      sapPartNumber: "1003-0200-24",
      description: "Board",
      quantity: 4,
      listPrice: 30,
      customerDiscountPct: 34,
      unitPrice: 19.8,
      worksheetId: 5,
      worksheetRev: 2,
      worksheetRow: "Board",
    });
    // The 10+ break: $27 list (30 less 10%, to the dollar), less 34%.
    expect(line.breaks).toEqual([{ minQty: 10, price: 17.82 }]);
  });

  it("is null for a row that isn't priced on its own", () => {
    expect(lineFromWorksheetRow(ws(), "Coil", 34)).toBeNull();
  });
});

describe("Update to R# on a sub-assembly line", () => {
  const pinned = { ...lineFromWorksheetRow(ws(), "Board", 34, 4)!, id: "keep", customerPartNumber: "CUST-1" };

  it("is offered when a later revision still prices that row", () => {
    const r3 = ws({ rev: 3, history: [...ws().history, snap(3, [{ ...BOARD, sellingPrice: { ...BOARD.sellingPrice!, listPrice: 40 } }])] });
    expect(worksheetLineIsStale(pinned, [r3])).toBe(r3);
    const fresh = refreshWorksheetLine(pinned, r3);
    expect(fresh).toMatchObject({ id: "keep", customerPartNumber: "CUST-1", quantity: 4, listPrice: 40, worksheetRev: 3, worksheetRow: "Board" });
  });

  it("is NOT offered once the row is no longer priced on its own — and the line is left alone", () => {
    const r3 = ws({ rev: 3, history: [...ws().history, snap(3, [COIL])] });
    expect(worksheetLineIsStale(pinned, [r3])).toBeNull();
    expect(refreshWorksheetLine(pinned, r3)).toBe(pinned);
  });
});
