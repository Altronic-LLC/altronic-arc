import { describe, expect, it } from "vitest";
import type { CustomerQuoteLine, NewProductWorksheet, PricingRequest, SapPart } from "@/types/pricing";
import {
  EMPTY_CUSTOMER,
  formatQuoteNumber,
  freeLine,
  isLatestRevision,
  latestRevisions,
  lineFromRequest,
  lineFromSapPart,
  lineFromWorksheet,
  lineSubtotal,
  newLineId,
  nextQuoteBase,
  parseQuoteCustomer,
  parseQuoteLines,
  parseQuoteNumber,
  quoteProblems,
  quoteTotal,
  refreshWorksheetLine,
  revisionsOf,
  unitPriceAt,
  worksheetLineIsStale,
} from "./customerQuotes";

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
    comments: [],
    watchers: [],
    targetGM: 40,
    unitCost: 100,
    listPrice: 253,
    baseGM: 40.1,
    priceBreaks: [{ minQty: 10, discountPct: 5 }],
    altronicPartNumber: "791999-01",
    sapPartNumber: "",
    history: [],
    historyCorrupt: false,
    hasAttachments: false,
    createdBy: null,
    createdAt: null,
    modifiedAt: null,
    ...over,
  };
}

function line(over: Partial<CustomerQuoteLine> = {}): CustomerQuoteLine {
  return {
    id: "l1",
    kind: "free",
    partNumber: "A",
    description: "",
    quantity: 1,
    listPrice: null,
    customerDiscountPct: null,
    unitPrice: 100,
    breaks: [],
    ...over,
  };
}

function request(over: Partial<PricingRequest> = {}): PricingRequest {
  return {
    id: 9,
    requestNumber: "PR-2026-0009",
    status: "Priced",
    altronicPartNumber: "791950-08",
    sapPartNumber: "1000-0000-08",
    requestedDescription: "",
    description: "Module",
    mpg: "M1",
    requestedBy: null,
    notes: "",
    customerSoldTo: "",
    customerName: "",
    customerGroup: "",
    listPrice: 200,
    customerDiscountPct: 10,
    customerPrice: 180,
    leaveAsContactFactory: null,
    pricedBy: null,
    pricedAt: null,
    addedToSapBy: null,
    addedToSapAt: null,
    cancelReason: "",
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdBy: null,
    createdAt: null,
    modifiedAt: null,
    ...over,
  };
}

describe("quote numbering", () => {
  it("formats and parses SQ-YYYY-####-R#", () => {
    expect(formatQuoteNumber("SQ-2026-0042", 3)).toBe("SQ-2026-0042-R3");
    expect(parseQuoteNumber(" sq-2026-0042-r3 ")).toEqual({ base: "SQ-2026-0042", rev: 3 });
    expect(parseQuoteNumber("SQ-2026-0042")).toBeNull();
    expect(parseQuoteNumber("IQ-COO-0042-R1")).toBeNull();
  });

  it("next base is the HIGHEST that year + 1, never count + 1, from full numbers or bases", () => {
    expect(nextQuoteBase(2026, [])).toBe("SQ-2026-0001");
    expect(nextQuoteBase(2026, ["SQ-2026-0002-R1", "SQ-2026-0002-R2", "SQ-2026-0009"])).toBe("SQ-2026-0010");
  });

  it("restarts each year and ignores junk", () => {
    expect(nextQuoteBase(2027, ["SQ-2026-0050-R1", "junk"])).toBe("SQ-2027-0001");
  });
});

describe("revisions", () => {
  const quotes = [
    { quoteBase: "SQ-2026-0001", rev: 1 },
    { quoteBase: "SQ-2026-0001", rev: 3 },
    { quoteBase: "SQ-2026-0002", rev: 1 },
    { quoteBase: "SQ-2026-0001", rev: 2 },
  ];

  it("revisionsOf lists one base's revs, newest first", () => {
    expect(revisionsOf("SQ-2026-0001", quotes).map((q) => q.rev)).toEqual([3, 2, 1]);
  });

  it("latestRevisions keeps the highest rev of each base", () => {
    expect(latestRevisions(quotes)).toEqual([
      { quoteBase: "SQ-2026-0001", rev: 3 },
      { quoteBase: "SQ-2026-0002", rev: 1 },
    ]);
  });

  it("isLatestRevision is derived, not stored", () => {
    expect(isLatestRevision({ quoteBase: "SQ-2026-0001", rev: 3 }, quotes)).toBe(true);
    expect(isLatestRevision({ quoteBase: "SQ-2026-0001", rev: 2 }, quotes)).toBe(false);
    expect(isLatestRevision({ quoteBase: "SQ-2026-0002", rev: 1 }, quotes)).toBe(true);
  });
});

describe("line pricing", () => {
  const breaks = line({
    unitPrice: 100,
    breaks: [
      { minQty: 50, price: 80 },
      { minQty: 10, price: 90 },
    ],
  });

  it("unitPriceAt takes the highest break the quantity reaches", () => {
    expect(unitPriceAt(breaks, 1)).toBe(100);
    expect(unitPriceAt(breaks, 9)).toBe(100);
    expect(unitPriceAt(breaks, 10)).toBe(90);
    expect(unitPriceAt(breaks, 49)).toBe(90);
    expect(unitPriceAt(breaks, 50)).toBe(80);
  });

  it("lineSubtotal and quoteTotal use the price at the quoted quantity, to the cent", () => {
    expect(lineSubtotal({ ...breaks, quantity: 10 })).toBe(900);
    expect(lineSubtotal(line({ unitPrice: 0.333, quantity: 3 }))).toBe(1);
    expect(quoteTotal([{ ...breaks, quantity: 10 }, line({ unitPrice: 12.5, quantity: 2 })])).toBe(925);
    expect(quoteTotal([])).toBe(0);
  });
});

describe("quoteProblems", () => {
  it("is empty for a quote ready to send", () => {
    expect(quoteProblems({ customer: { ...EMPTY_CUSTOMER, name: "Acme" }, lines: [line()] })).toEqual([]);
  });

  it("names a missing customer, no lines, a bad quantity and a missing price", () => {
    expect(quoteProblems({ customer: { ...EMPTY_CUSTOMER, name: "  " }, lines: [] })).toEqual([
      "The quote has no customer.",
      "The quote has no lines.",
    ]);
    expect(
      quoteProblems({
        customer: { ...EMPTY_CUSTOMER, name: "Acme" },
        lines: [
          line({ partNumber: "", description: "Freight", quantity: 0 }),
          line({ partNumber: "", description: "", quantity: 1.5, unitPrice: Number.NaN }),
        ],
      }),
    ).toEqual(["Freight needs a quantity of 1 or more.", "Line 2 needs a quantity of 1 or more.", "Line 2 has no price."]);
  });
});

describe("newLineId", () => {
  it("is unique within a burst", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newLineId()));
    expect(ids.size).toBe(50);
  });
});

describe("lineFromWorksheet", () => {
  it("pins the revision and applies the customer's discount to list AND breaks", () => {
    const l = lineFromWorksheet(ws(), 10, 4)!;
    expect(l).toMatchObject({
      kind: "worksheet",
      partNumber: "791999-01",
      description: "Widget",
      quantity: 4,
      listPrice: 253,
      customerDiscountPct: 10,
      unitPrice: 227.7, // 253 × 0.9
      breaks: [{ minQty: 10, price: 216 }], // whole-dollar 240 × 0.9
      worksheetId: 5,
      worksheetNumber: "NP-2026-0001",
      worksheetRev: 2,
    });
  });

  it("falls back to the worksheet number for a part number, and is null unpriced", () => {
    expect(lineFromWorksheet(ws({ altronicPartNumber: "" }), null)!.partNumber).toBe("NP-2026-0001");
    expect(lineFromWorksheet(ws({ listPrice: null }), 10)).toBeNull();
  });
});

describe("refreshWorksheetLine / worksheetLineIsStale", () => {
  it("re-prices from the worksheet's current revision, keeping the line's id, quantity and discount", () => {
    const old = { ...lineFromWorksheet(ws({ rev: 1, listPrice: 200 }), 10, 7)!, id: "keep" };
    const fresh = refreshWorksheetLine(old, ws({ rev: 3, listPrice: 300, priceBreaks: [] }));
    expect(fresh.id).toBe("keep");
    expect(fresh.quantity).toBe(7);
    expect(fresh.worksheetRev).toBe(3);
    expect(fresh.unitPrice).toBe(270);
    expect(fresh.customerDiscountPct).toBe(10);
  });

  it("leaves the line alone if the worksheet is no longer priced", () => {
    const old = lineFromWorksheet(ws(), 10)!;
    expect(refreshWorksheetLine(old, ws({ listPrice: null }))).toBe(old);
  });

  it("is stale only when the worksheet has moved to a later, priced revision", () => {
    const l = lineFromWorksheet(ws({ rev: 2 }), null)!;
    expect(worksheetLineIsStale(l, [ws({ rev: 2 })])).toBeNull();
    expect(worksheetLineIsStale(l, [ws({ rev: 3 })])?.rev).toBe(3);
    expect(worksheetLineIsStale(l, [ws({ rev: 3, listPrice: null })])).toBeNull();
    expect(worksheetLineIsStale(l, [ws({ id: 99, rev: 9 })])).toBeNull();
    expect(worksheetLineIsStale(line(), [ws({ rev: 9 })])).toBeNull();
  });
});

describe("lineFromSapPart", () => {
  const sap: SapPart = {
    altronicPartNumber: "791950-08",
    sapPartNumber: "1000-0000-08",
    description: "Module",
    mpg: "M1",
    listPrice: 150,
    cost: 50,
  };

  it("is list less the customer's discount, with no breaks", () => {
    expect(lineFromSapPart(sap, 20, 2)).toMatchObject({
      kind: "sapPart",
      partNumber: "791950-08",
      quantity: 2,
      listPrice: 150,
      unitPrice: 120,
      breaks: [],
      sapPartNumber: "1000-0000-08",
    });
  });

  it("is null with no list price", () => {
    expect(lineFromSapPart({ ...sap, listPrice: null }, 20)).toBeNull();
  });
});

describe("lineFromRequest", () => {
  it("carries the customer price it was given", () => {
    expect(lineFromRequest(request(), 3)).toMatchObject({
      kind: "request",
      quantity: 3,
      listPrice: 200,
      customerDiscountPct: 10,
      unitPrice: 180,
      requestId: 9,
      requestNumber: "PR-2026-0009",
      sapPartNumber: "1000-0000-08",
    });
  });

  it("falls back to list with no customer price, and is null unpriced", () => {
    expect(lineFromRequest(request({ customerPrice: null }))!.unitPrice).toBe(200);
    expect(lineFromRequest(request({ sapPartNumber: "" }))!.sapPartNumber).toBeUndefined();
    expect(lineFromRequest(request({ listPrice: null }))).toBeNull();
  });
});

describe("freeLine", () => {
  it("trims, rounds to the cent and carries no internal figures", () => {
    expect(freeLine({ partNumber: " NRE ", description: " Tooling ", quantity: 1, unitPrice: 99.999 })).toMatchObject({
      kind: "free",
      partNumber: "NRE",
      description: "Tooling",
      unitPrice: 100,
      listPrice: null,
      customerDiscountPct: null,
      breaks: [],
    });
  });
});

describe("SAP and customer part numbers on a line", () => {
  it("lineFromWorksheet copies the worksheet's SAP part number, and leaves it off when blank", () => {
    expect(lineFromWorksheet(ws({ sapPartNumber: "1003-0114-24" }), 10)!.sapPartNumber).toBe("1003-0114-24");
    expect(lineFromWorksheet(ws({ sapPartNumber: "" }), 10)!.sapPartNumber).toBeUndefined();
  });

  it("refreshWorksheetLine keeps the quote's customer part number, and takes the worksheet's new SAP #", () => {
    const old = { ...lineFromWorksheet(ws({ rev: 1, listPrice: 200 }), 10, 7)!, customerPartNumber: "CUST-77" };
    const fresh = refreshWorksheetLine(old, ws({ rev: 3, listPrice: 300, priceBreaks: [], sapPartNumber: "1003-0114-24" }));
    expect(fresh.customerPartNumber).toBe("CUST-77");
    expect(fresh.sapPartNumber).toBe("1003-0114-24");
    expect(fresh.worksheetRev).toBe(3);
  });

  it("freeLine takes an SAP part number, trimmed, and drops a blank one", () => {
    const base = { partNumber: "NRE", description: "Tooling", quantity: 1, unitPrice: 10 };
    expect(freeLine({ ...base, sapPartNumber: " 2001-0310-25 " }).sapPartNumber).toBe("2001-0310-25");
    expect(freeLine({ ...base, sapPartNumber: "   " }).sapPartNumber).toBeUndefined();
    expect(freeLine(base).sapPartNumber).toBeUndefined();
  });
});

describe("parseQuoteCustomer", () => {
  it("reads the JSON, blanking anything that isn't a string", () => {
    expect(parseQuoteCustomer(JSON.stringify({ soldTo: "100", name: "Acme", contactName: 3 }))).toEqual({
      ...EMPTY_CUSTOMER,
      soldTo: "100",
      name: "Acme",
    });
  });

  it("is empty for blank, junk or non-strings — and never shares the constant", () => {
    const out = parseQuoteCustomer("{bad");
    expect(out).toEqual(EMPTY_CUSTOMER);
    expect(out).not.toBe(EMPTY_CUSTOMER);
    expect(parseQuoteCustomer(null)).toEqual(EMPTY_CUSTOMER);
    expect(parseQuoteCustomer("")).toEqual(EMPTY_CUSTOMER);
  });
});

describe("parseQuoteLines", () => {
  it("reads blank as empty, junk as CORRUPT", () => {
    expect(parseQuoteLines("")).toEqual({ lines: [], corrupt: false });
    expect(parseQuoteLines(null)).toEqual({ lines: [], corrupt: false });
    expect(parseQuoteLines("{bad")).toEqual({ lines: [], corrupt: true });
    expect(parseQuoteLines('{"a":1}')).toEqual({ lines: [], corrupt: true });
    expect(parseQuoteLines(5)).toEqual({ lines: [], corrupt: true });
  });

  it("drops lines with no id and repairs quantity and breaks", () => {
    const raw = JSON.stringify([line({ id: "a", quantity: 0 }), { kind: "free" }, { ...line({ id: "b" }), breaks: "x" }]);
    const out = parseQuoteLines(raw);
    expect(out.corrupt).toBe(false);
    expect(out.lines.map((l) => l.id)).toEqual(["a", "b"]);
    expect(out.lines[0].quantity).toBe(1);
    expect(out.lines[1].breaks).toEqual([]);
  });
});
