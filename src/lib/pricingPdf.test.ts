import { describe, expect, it } from "vitest";
import type { CustomerQuote, PricingRequest } from "@/types/pricing";
import { buildPricingPdf, customerQuotePdfModel, pricingPdfFileName, requestPdfModel } from "./pricingPdf";

// =============================================================================
// The Sales Pricing PDFs. The LEAK test is the point: a quote whose lines carry
// distinctive internal figures (list price, discount) must produce a model —
// and a real PDF — with neither in it. The PDF text is read out of an
// UNCOMPRESSED jsPDF document, the quotePdf.test.ts way.
// =============================================================================

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
  return runs.join("\n").replace(/\u0096/g, "–").replace(/\u0097/g, "—");
}

const LIST = 98765.43;
const DISCOUNT = 37.77;

function quote(over: Partial<CustomerQuote> = {}): CustomerQuote {
  return {
    id: 1,
    quoteNumber: "SQ-2026-0042-R1",
    quoteBase: "SQ-2026-0042",
    rev: 1,
    status: "Draft",
    validityDays: 30,
    customer: { soldTo: "100200", name: "Acme Compression", customerGroup: "Z9", contactName: "Pat", contactEmail: "pat@acme.com" },
    lines: [
      {
        id: "a",
        kind: "worksheet",
        partNumber: "791999-01",
        description: "Widget",
        quantity: 12,
        listPrice: LIST,
        customerDiscountPct: DISCOUNT,
        unitPrice: 61461.73,
        breaks: [{ minQty: 10, price: 58400.11 }],
      },
      {
        id: "b",
        kind: "sapPart",
        partNumber: "791950-08",
        description: "Module",
        quantity: 1,
        listPrice: LIST,
        customerDiscountPct: DISCOUNT,
        unitPrice: 1234.56,
        breaks: [],
      },
    ],
    linesCorrupt: false,
    notes: "Lead time 6 weeks.",
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdBy: null,
    createdAt: null,
    modifiedAt: null,
    ...over,
  };
}

function request(over: Partial<PricingRequest> = {}): PricingRequest {
  return {
    id: 9,
    requestNumber: "PR-2026-0009",
    status: "Priced",
    altronicPartNumber: "791950-08",
    sapPartNumber: "",
    requestedDescription: "",
    description: "Module",
    mpg: "",
    requestedBy: null,
    notes: "",
    customerSoldTo: "100",
    customerName: "Acme",
    customerGroup: "",
    listPrice: LIST,
    customerDiscountPct: DISCOUNT,
    customerPrice: 4321.09,
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

const TODAY = new Date(2026, 9, 13);
const FORBIDDEN = ["98765.43", "98,765.43", "37.77"];

describe("customerQuotePdfModel", () => {
  it("carries NO list price or discount — only customer prices", () => {
    const model = customerQuotePdfModel(quote(), { name: "Ray White", email: "ray@x.com" }, TODAY);
    const json = JSON.stringify(model);
    for (const bad of FORBIDDEN) expect(json).not.toContain(bad);
    expect(json).not.toMatch(/listPrice|customerDiscountPct|discount/i);
  });

  it("prices each line at its quoted quantity, with break ranges and an expiry", () => {
    const model = customerQuotePdfModel(quote(), null, TODAY);
    expect(model.title).toBe("QUOTATION");
    expect(model.issueDate).toBe("2026-10-13");
    expect(model.expiryDate).toBe("2026-11-12");
    expect(model.lines[0].unitPrice).toBe(58400.11);
    expect(model.lines[0].subtotal).toBe(700801.32);
    expect(model.lines[0].breaks).toEqual([
      { range: "1–9", price: 61461.73 },
      { range: "10+", price: 58400.11 },
    ]);
    expect(model.lines[1].breaks).toEqual([]);
    expect(model.total).toBe(702035.88);
  });
});

describe("requestPdfModel", () => {
  it("is null while unpriced", () => {
    expect(requestPdfModel(request({ listPrice: null, customerPrice: null }), null, TODAY)).toBeNull();
  });

  it("uses the customer price, and never the list or discount", () => {
    const model = requestPdfModel(request(), null, TODAY)!;
    expect(model.title).toBe("PRICE CONFIRMATION");
    expect(model.total).toBe(4321.09);
    expect(model.expiryDate).toBeNull();
    const json = JSON.stringify(model);
    for (const bad of FORBIDDEN) expect(json).not.toContain(bad);
  });

  it("falls back to list price when there's no customer price", () => {
    expect(requestPdfModel(request({ customerPrice: null }), null, TODAY)!.total).toBe(LIST);
  });
});

describe("pricingPdfFileName", () => {
  it("replaces characters SharePoint refuses", () => {
    expect(pricingPdfFileName({ number: "SQ-2026-0042-R1" })).toBe("SQ-2026-0042-R1.pdf");
    expect(pricingPdfFileName({ number: 'a/b:c*"' })).toBe("a-b-c--.pdf");
    expect(pricingPdfFileName({ number: "  " })).toBe("quote.pdf");
  });
});

describe("buildPricingPdf — the leak test on real PDF text", () => {
  it("prints the customer prices and NONE of the internal figures", async () => {
    const model = customerQuotePdfModel(quote(), { name: "Ray White", email: "ray@x.com" }, TODAY);
    const doc = await buildPricingPdf(model, { compress: false, logo: false });
    const text = pdfText(doc.output());
    expect(text).toContain("QUOTATION");
    expect(text).toContain("SQ-2026-0042-R1");
    expect(text).toContain("$1,234.56");
    expect(text).toContain("$58,400.11");
    expect(text).toContain("Acme Compression");
    for (const bad of FORBIDDEN) expect(text).not.toContain(bad);
    expect(text.toLowerCase()).not.toMatch(/discount|margin|\bcost\b|list price/);
  });

  it("renders a price confirmation", async () => {
    const doc = await buildPricingPdf(requestPdfModel(request(), null, TODAY)!, { compress: false, logo: false });
    const text = pdfText(doc.output());
    expect(text).toContain("PRICE CONFIRMATION");
    expect(text).toContain("$4,321.09");
    for (const bad of FORBIDDEN) expect(text).not.toContain(bad);
  });
});

describe("SAP and customer part numbers on the quote PDF", () => {
  function withNumbers(): CustomerQuote {
    const q = quote();
    return {
      ...q,
      lines: [
        { ...q.lines[0], sapPartNumber: "1003-0114-24", customerPartNumber: "ACME-PN-9" },
        { ...q.lines[1], sapPartNumber: undefined, customerPartNumber: undefined },
      ],
    };
  }

  it("the model carries each line's SAP and customer part number, blank when unset", () => {
    const model = customerQuotePdfModel(withNumbers(), null, TODAY);
    expect(model.lines[0].sapPartNumber).toBe("1003-0114-24");
    expect(model.lines[0].customerPartNumber).toBe("ACME-PN-9");
    expect(model.lines[1].sapPartNumber).toBe("");
    expect(model.lines[1].customerPartNumber).toBe("");
  });

  it("prints them on the PDF when set", async () => {
    const doc = await buildPricingPdf(customerQuotePdfModel(withNumbers(), null, TODAY), { compress: false, logo: false });
    const text = pdfText(doc.output());
    expect(text).toContain("SAP part no. 1003-0114-24");
    expect(text).toContain("Your part no. ACME-PN-9");
  });

  it("prints neither label when no line has them", async () => {
    const doc = await buildPricingPdf(customerQuotePdfModel(quote(), null, TODAY), { compress: false, logo: false });
    const text = pdfText(doc.output());
    expect(text).not.toContain("SAP part no.");
    expect(text).not.toContain("Your part no.");
  });
});
