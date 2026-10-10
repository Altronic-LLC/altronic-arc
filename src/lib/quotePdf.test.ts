import { describe, expect, it } from "vitest";
import type { QuotePdfModel } from "@/types/quote";
import {
  buildQuotePdfDocument,
  formatQuoteDate,
  formatQuotePrice,
  generateQuotePdf,
  quotePdfFileName,
} from "./quotePdf";

// =============================================================================
// The customer quote PDF. These tests read the REAL text out of a real,
// uncompressed jsPDF document — possible only because the PDF is drawn as
// text rather than a screenshot, which is the point of the design.
// =============================================================================

/**
 * Pull the text out of an UNCOMPRESSED jsPDF output string.
 *
 * jsPDF writes every text run as a PDF literal string followed by `Tj`:
 * `(IQ-COO-0042-R2) Tj`. Inside the parentheses `\(`, `\)` and `\\` are
 * escaped, and bytes outside ASCII can be written as `\ddd` octal. Each run
 * becomes one line of the result.
 */
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
  // jsPDF writes WinAnsi bytes: 0x96 is the en dash, 0x97 the em dash.
  return runs.join("\n").replace(/\u0096/g, "–").replace(/\u0097/g, "—");
}

function pageCount(raw: string): number {
  return (raw.match(/\/Type \/Page\b/g) ?? []).length;
}

async function render(model: QuotePdfModel, logoBase64?: string | null) {
  const doc = await buildQuotePdfDocument(model, { compress: false, logoBase64 });
  const raw = doc.output();
  return { raw, text: pdfText(raw), pages: doc.getNumberOfPages() };
}

function model(overrides: Partial<QuotePdfModel> = {}): QuotePdfModel {
  return {
    quoteNumber: "IQ-COO-0042-R2",
    rev: 2,
    issueDate: "2026-10-09",
    expiryDate: "2026-11-08",
    customerName: "Cooper Compression Ltd",
    customerNumber: "0001042",
    contactName: "Jane Buyer",
    contactEmail: "jane.buyer@example.com",
    preparedBy: { name: "Ray White", email: "ray.white@altronic-llc.com" },
    assemblies: [
      {
        lineNo: 2,
        altronicPartNumber: "791950-16",
        sapPartNumber: "SAP-77",
        customerPartNumber: "",
        description: "CPU-95 ignition module, 16 cylinder",
        tiers: [{ rangeLabel: "1+", unitPrice: 2500 }],
        quotedQty: 1,
        quotedUnitPrice: 2500,
        lineTotal: 2500,
      },
      {
        lineNo: 1,
        altronicPartNumber: "601110",
        sapPartNumber: "",
        customerPartNumber: "CUST-9",
        description: "Harness assembly",
        tiers: [
          { rangeLabel: "1 - 9", unitPrice: 1234.56 },
          { rangeLabel: "10 - 24", unitPrice: 1111.1 },
          { rangeLabel: "25+", unitPrice: 987.65 },
        ],
        quotedQty: 12,
        quotedUnitPrice: 1111.1,
        lineTotal: 13333.2,
      },
    ],
    quoteTotal: 15833.2,
    budgetary: null,
    quoteNotes: "Lead time six weeks ARO.",
    ...overrides,
  };
}

describe("formatQuoteDate", () => {
  it("formats yyyy-mm-dd without time-zone drift", () => {
    expect(formatQuoteDate("2026-10-09")).toBe("October 9, 2026");
    expect(formatQuoteDate("2027-01-01")).toBe("January 1, 2027");
  });
  it("prints anything unparseable as given", () => {
    expect(formatQuoteDate("soon")).toBe("soon");
    expect(formatQuoteDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("formatQuotePrice", () => {
  it("is en-US USD", () => {
    expect(formatQuotePrice(1234.56)).toBe("$1,234.56");
    expect(formatQuotePrice(5)).toBe("$5.00");
  });
});

describe("quotePdfFileName", () => {
  it("is the quote number plus .pdf", () => {
    expect(quotePdfFileName({ quoteNumber: "IQ-COO-0042-R1" })).toBe("IQ-COO-0042-R1.pdf");
  });
  it("replaces characters SharePoint refuses", () => {
    expect(quotePdfFileName({ quoteNumber: 'IQ/A:B*C?"<>|\\' })).toBe("IQ-A-B-C------.pdf");
  });
  it("trims leading/trailing dots and spaces, and never returns an empty name", () => {
    expect(quotePdfFileName({ quoteNumber: " .IQ-1. " })).toBe("IQ-1.pdf");
    expect(quotePdfFileName({ quoteNumber: "  " })).toBe("quote.pdf");
  });
});

describe("the quote PDF", () => {
  it("prints the quote number, dates, customer, part numbers and every tier price", async () => {
    const { text } = await render(model());
    expect(text).toContain("QUOTATION");
    expect(text).toContain("IQ-COO-0042-R2");
    expect(text).toContain("Revision 2");
    expect(text).toContain("Issued October 9, 2026");
    expect(text).toContain("Valid until November 8, 2026");
    expect(text).toContain("Cooper Compression Ltd");
    expect(text).toContain("Customer no. 0001042");
    expect(text).toContain("Jane Buyer");
    expect(text).toContain("jane.buyer@example.com");
    expect(text).toContain("791950-16");
    expect(text).toContain("601110");
    expect(text).toContain("CPU-95 ignition module, 16 cylinder");
    expect(text).toContain("Harness assembly");
    for (const label of ["1 - 9 pcs", "10 - 24 pcs", "25+ pcs"]) expect(text).toContain(label);
    for (const price of ["$1,234.56", "$1,111.10", "$987.65", "$2,500.00"]) {
      expect(text).toContain(price);
    }
  });

  it("prints ONE 'QUOTED ITEMS' table with Part # | Description | Price | Qty | Subtotal, and the Total", async () => {
    const { text } = await render(model());
    const lines = text.split("\n");
    expect(lines.filter((l) => l === "QUOTED ITEMS")).toHaveLength(1);
    for (const h of ["PART #", "DESCRIPTION", "PRICE", "QTY", "SUBTOTAL"]) {
      expect(lines.filter((l) => l === h), h).toHaveLength(1);
    }
    // Quantities and subtotals, as their own runs.
    expect(lines).toContain("12");
    expect(lines).toContain("1");
    expect(lines).toContain("$13,333.20");
    expect(lines.filter((l) => l === "$2,500.00").length).toBeGreaterThanOrEqual(2); // price + subtotal
    // The old per-line layout is gone.
    expect(text).not.toContain("VOLUME PRICING");
    expect(text).not.toContain("Unit price");
    // A single-tier line shows only its price — no range label.
    expect(text).not.toContain("1+ pcs");
    expect(text).toContain("Total");
    expect(text).toContain("$15,833.20");
    // The Total comes after every line and before the notes.
    expect(text.indexOf("$15,833.20")).toBeGreaterThan(text.indexOf("$2,500.00"));
    expect(text.indexOf("$15,833.20")).toBeLessThan(text.indexOf("Lead time six weeks ARO."));
  });

  it("prints SAP / Cust. numbers under the part number only when they are set", async () => {
    const { text, raw } = await render(model());
    const lines = text.split("\n");
    expect(lines).toContain("SAP SAP-77");
    expect(lines).toContain("Cust. CUST-9");
    // Line 1 has no SAP number, line 2 no customer number — no empty labels.
    expect(lines.filter((l) => l.startsWith("SAP "))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("Cust. "))).toHaveLength(1);
    // The part number, its description, the first price and the qty share a baseline.
    const y = (s: string) => {
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = new RegExp(`[\\d.]+ ([\\d.]+) Td\\n\\(${esc}\\) Tj`).exec(raw);
      if (!m) throw new Error(`no text run for ${s}`);
      return Number(m[1]);
    };
    expect(y("Harness assembly")).toBeCloseTo(y("601110"), 1);
    expect(y("1 - 9 pcs")).toBeCloseTo(y("601110"), 1);
    expect(y("12")).toBeCloseTo(y("601110"), 1);
    // The SAP line sits BELOW its part number (PDF y grows upward).
    expect(y("SAP SAP-77")).toBeLessThan(y("791950-16"));
    // Part numbers are set in bold Courier.
    expect(raw).toMatch(/\/BaseFont \/Courier-Bold/);
  });

  it("prints PREPARED BY — the person who generated it — beside PREPARED FOR", async () => {
    const { text } = await render(model());
    expect(text).toContain("PREPARED FOR");
    expect(text).toContain("PREPARED BY");
    expect(text).toContain("Ray White");
    expect(text).toContain("ray.white@altronic-llc.com");
    expect(text.indexOf("Ray White")).toBeLessThan(text.indexOf("ray.white@altronic-llc.com"));
  });

  it("omits PREPARED BY when there is nobody to name", async () => {
    const { text } = await render(model({ preparedBy: null }));
    expect(text).toContain("PREPARED FOR");
    expect(text).not.toContain("PREPARED BY");
  });

  it("the items table is FULL width with the subtotal at the right margin, and a tier's range label never touches its price", async () => {
    const doc = await buildQuotePdfDocument(model(), { compress: false, logoBase64: null });
    const raw = doc.output();
    // jsPDF writes `x y Td (text) Tj`; a right-aligned run's x is its LEFT edge.
    const at = (s: string) => {
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = new RegExp(`([\\d.]+) [\\d.]+ Td\\n\\(${esc}\\) Tj`).exec(raw);
      if (!m) throw new Error(`no text run for ${s}`);
      return Number(m[1]);
    };
    const RIGHT_MARGIN = 612 - 54;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    for (const price of ["$13,333.20"]) {
      const end = at(price) + doc.getTextWidth(price);
      // Ends within the cell padding of the right margin — not half way across.
      expect(end).toBeGreaterThan(RIGHT_MARGIN - 8);
      expect(end).toBeLessThanOrEqual(RIGHT_MARGIN);
    }
    // Each tier: the range label (7.5pt, normal) ends before its price (9pt bold) begins.
    const tiers: [string, string][] = [
      ["1 - 9 pcs", "$1,234.56"],
      ["10 - 24 pcs", "$1,111.10"],
      ["25+ pcs", "$987.65"],
    ];
    const priceXs: number[] = [];
    for (const [label, price] of tiers) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      const labelEnd = at(label) + doc.getTextWidth(label);
      expect(at(price), `${label} / ${price}`).toBeGreaterThanOrEqual(labelEnd);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      priceXs.push(at(price) + doc.getTextWidth(price));
    }
    // …and the tier prices share one right edge.
    for (const end of priceXs) expect(end).toBeCloseTo(priceXs[0], 1);
    // Open tables: no vertical rules or boxed cells — the only stroked lines are
    // the header hairlines and the Total's rule, all horizontal.
    const strokes = [...raw.matchAll(/([\d.]+) ([\d.]+) m\n([\d.]+) ([\d.]+) l\nS/g)];
    expect(strokes.length).toBeGreaterThan(0);
    for (const s of strokes) expect(s[2]).toBe(s[4]);
    expect(raw).not.toMatch(/ re\n(S|B)\n/);
    // The table's last cell reaches the right margin.
    const table = (doc as unknown as { lastAutoTable: { finalY: number; columns: { width: number }[] } })
      .lastAutoTable;
    const width = table.columns.reduce((s, c) => s + c.width, 0);
    expect(width).toBeCloseTo(612 - 54 * 2, 0);
    // The Total is right-aligned at the right margin too.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    expect(at("$15,833.20") + doc.getTextWidth("$15,833.20")).toBeCloseTo(RIGHT_MARGIN, 0);
  });

  it("a row never splits across pages — its part number, tiers and subtotal stay together", async () => {
    const assemblies = Array.from({ length: 14 }, (_, i) => ({
      lineNo: i + 1,
      altronicPartNumber: `PN-${100 + i}`,
      sapPartNumber: `1003-0114-${String(10 + i)}`,
      customerPartNumber: "",
      description: "A description that wraps. ".repeat(6),
      tiers: [
        { rangeLabel: "1 - 9", unitPrice: 100 + i },
        { rangeLabel: "10+", unitPrice: 50 + i },
      ],
      quotedQty: 3,
      quotedUnitPrice: 100 + i,
      lineTotal: 1000 + i,
    }));
    const doc = await buildQuotePdfDocument(model({ assemblies }), { compress: false, logoBase64: null });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const raw = doc.output();
    const pages = raw.split(/\/Type \/Page\b/).slice(1);
    const pageOf = (run: string) => pages.findIndex((p) => p.includes(`(${run}) Tj`));
    for (const a of assemblies) {
      const pn = pageOf(a.altronicPartNumber);
      expect(pn, a.altronicPartNumber).toBeGreaterThanOrEqual(0);
      expect(pageOf(`SAP ${a.sapPartNumber}`), a.altronicPartNumber).toBe(pn);
      expect(pageOf(formatQuotePrice(100 + (a.lineNo - 1))), a.altronicPartNumber).toBe(pn);
      expect(pageOf(formatQuotePrice(50 + (a.lineNo - 1))), a.altronicPartNumber).toBe(pn);
      expect(pageOf(formatQuotePrice(1000 + (a.lineNo - 1))), a.altronicPartNumber).toBe(pn);
    }
  });

  it("prints assemblies in lineNo order, not array order", async () => {
    const { text } = await render(model());
    expect(text.indexOf("601110")).toBeLessThan(text.indexOf("791950-16"));
  });

  it("omits blank customer and part-number lines", async () => {
    const { text } = await render(
      model({
        customerNumber: "",
        contactName: " ",
        contactEmail: "",
        assemblies: [
          {
            lineNo: 1,
            altronicPartNumber: "601110",
            sapPartNumber: "",
            customerPartNumber: "",
            description: "",
            tiers: [{ rangeLabel: "1+", unitPrice: 10 }],
            quotedQty: 1,
            quotedUnitPrice: 10,
            lineTotal: 10,
          },
        ],
      }),
    );
    expect(text).not.toContain("Customer no.");
    expect(text).not.toContain("Attn:");
    expect(text).not.toMatch(/^SAP /m);
    expect(text).not.toMatch(/^Cust\. /m);
    // The part number still prints, and a single 1+ tier shows only its price.
    expect(text.split("\n")).toContain("601110");
    expect(text).not.toContain("1+ pcs");
    expect(text).toContain("$10.00");
  });

  it("prints the budgetary notice only when the quote is budgetary", async () => {
    const budgetary = await render(
      model({ budgetary: { title: "Budgetary Quotation", text: "Pricing is an estimate only." } }),
    );
    expect(budgetary.text).toContain("BUDGETARY QUOTATION");
    expect(budgetary.text).toContain("Pricing is an estimate only.");

    const firm = await render(model());
    expect(firm.text).not.toMatch(/budgetary/i);
  });

  it("prints the notes under a Notes heading, and no heading without notes", async () => {
    const withNotes = await render(model());
    expect(withNotes.text).toContain("Notes");
    expect(withNotes.text).toContain("Lead time six weeks ARO.");

    const without = await render(model({ quoteNotes: "   " }));
    expect(without.text).not.toContain("Notes");
  });

  it("puts a page footer on every page", async () => {
    const { text, pages } = await render(model());
    expect(pages).toBe(1);
    expect(text).toContain("Page 1 of 1");
  });

  it("paginates a long quote, with Page n of N on each page", async () => {
    const assemblies = Array.from({ length: 12 }, (_, i) => ({
      lineNo: i + 1,
      altronicPartNumber: `PN-${100 + i}`,
      sapPartNumber: `SAP-${i}`,
      customerPartNumber: `C-${i}`,
      description: "A long description of a final assembly. ".repeat(4),
      tiers: [
        { rangeLabel: "1 - 9", unitPrice: 100 + i },
        { rangeLabel: "10 - 24", unitPrice: 90 + i },
        { rangeLabel: "25+", unitPrice: 80 + i },
      ],
      quotedQty: 1,
      quotedUnitPrice: 100 + i,
      lineTotal: 100 + i,
    }));
    const { text, pages, raw } = await render(model({ assemblies }));
    expect(pages).toBeGreaterThan(1);
    expect(pageCount(raw)).toBe(pages);
    for (let p = 1; p <= pages; p++) expect(text).toContain(`Page ${p} of ${pages}`);
    for (const a of assemblies) expect(text).toContain(a.altronicPartNumber);
    // The table header repeats at the top of every page the table runs onto.
    const tablePages = raw.split(/\/Type \/Page\b/).slice(1).filter((p) => /\(PN-\d+\) Tj/.test(p));
    expect(tablePages.length).toBeGreaterThan(1);
    for (const p of tablePages) {
      for (const h of ["PART #", "DESCRIPTION", "PRICE", "QTY", "SUBTOTAL"]) expect(p).toContain(`(${h}) Tj`);
    }
    // …but the "QUOTED ITEMS" caption prints once.
    expect(text.split("\n").filter((l) => l === "QUOTED ITEMS")).toHaveLength(1);
    // The quote number is in every page's footer.
    expect(text.split("\n").filter((l) => l === "IQ-COO-0042-R2").length).toBeGreaterThanOrEqual(pages);
  });

  it("reads only QuotePdfModel fields — a smuggled cost never prints", async () => {
    const smuggled = {
      ...model(),
      cost: 999.99,
      targetGM: 37.5,
      assemblies: model().assemblies.map((a) => ({ ...a, cost: 999.99, margin: 37.5 })),
    } as unknown as QuotePdfModel;
    const { text } = await render(smuggled);
    expect(text).not.toContain("999.99");
    expect(text).not.toContain("37.5");
    expect(text).not.toMatch(/\b(cost|margin|markup)\b/i);
  });

  it("still renders when the logo can't be embedded", async () => {
    const { text } = await render(model(), "this-is-not-a-png");
    expect(text).toContain("ALTRONIC");
    expect(text).toContain("IQ-COO-0042-R2");
    expect(text).toContain("$1,234.56");
  });

  it("embeds the Altronic wordmark as an image", async () => {
    const { raw } = await render(model());
    expect(raw).toMatch(/\/Subtype \/Image/);
  });

  it("generateQuotePdf returns a PDF blob", async () => {
    const blob = await generateQuotePdf(model());
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });
});
