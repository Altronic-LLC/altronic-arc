import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import type { CustomerQuote, PricingRequest } from "@/types/pricing";
import { ALTRONIC_WORDMARK_ASPECT, ALTRONIC_WORDMARK_BLACK_PNG } from "@/assets/brand/altronicWordmark";
import { lineSubtotal, quoteTotal, unitPriceAt } from "./customerQuotes";
import { tierRanges } from "./pricingMath";

// =============================================================================
// Sales Pricing's customer PDFs — a CUSTOMER QUOTE, and a single request's
// PRICE CONFIRMATION. Real text drawn with jsPDF + AutoTable (both dynamically
// imported, so neither lands in the main bundle), the Insourcing Quotes style:
// monochrome, a gold hairline, the Altronic wordmark.
//
// **The renderer accepts ONLY a `PricingPdfModel`** — a type with no field
// that could carry cost, margin, list price or discount. The model builders
// below are the one place a quote or request becomes customer-facing, and
// they read named, customer-safe fields only. A test generates a PDF from a
// quote and fails on any internal figure appearing in its text.
// =============================================================================

export interface PricingPdfLine {
  partNumber: string;
  /** Printed under the part when there is one. */
  sapPartNumber: string;
  customerPartNumber: string;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  /** "1–9  $1,595.88" style rows when the line has quantity breaks. */
  breaks: { range: string; price: number }[];
}

export interface PricingPdfModel {
  title: "QUOTATION" | "PRICE CONFIRMATION";
  number: string;
  /** yyyy-mm-dd */
  issueDate: string;
  expiryDate: string | null;
  customer: { name: string; soldTo: string; contactName: string; contactEmail: string };
  preparedBy: { name: string; email: string } | null;
  lines: PricingPdfLine[];
  total: number;
  notes: string;
}

type AutoTableFn = (doc: jsPDF, options: UserOptions) => void;

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n: number) => USD.format(n);

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

/** A customer quote → the PDF model. Only customer prices travel. */
export function customerQuotePdfModel(
  quote: CustomerQuote,
  preparedBy: { name: string; email: string } | null,
  today: Date = new Date(),
): PricingPdfModel {
  const issueDate = isoDate(today);
  return {
    title: "QUOTATION",
    number: quote.quoteNumber,
    issueDate,
    expiryDate: addDays(issueDate, quote.validityDays),
    customer: {
      name: quote.customer.name,
      soldTo: quote.customer.soldTo,
      contactName: quote.customer.contactName,
      contactEmail: quote.customer.contactEmail,
    },
    preparedBy,
    lines: quote.lines.map((l) => {
      const ranges = tierRanges(l.breaks.map((b) => ({ minQty: b.minQty, discountPct: 0 })));
      const prices = [l.unitPrice, ...[...l.breaks].sort((a, b) => a.minQty - b.minQty).map((b) => b.price)];
      return {
        partNumber: l.partNumber,
        sapPartNumber: l.sapPartNumber ?? "",
        customerPartNumber: l.customerPartNumber ?? "",
        description: l.description,
        quantity: l.quantity,
        unitPrice: unitPriceAt(l, l.quantity),
        subtotal: lineSubtotal(l),
        breaks: l.breaks.length ? ranges.map((range, i) => ({ range, price: prices[i] })) : [],
      };
    }),
    total: quoteTotal(quote.lines),
    notes: quote.notes,
  };
}

/** A priced request → a one-line price confirmation for its customer. null while unpriced. */
export function requestPdfModel(
  request: PricingRequest,
  preparedBy: { name: string; email: string } | null,
  today: Date = new Date(),
): PricingPdfModel | null {
  const price = request.customerPrice ?? request.listPrice;
  if (price === null) return null;
  return {
    title: "PRICE CONFIRMATION",
    number: request.requestNumber,
    issueDate: isoDate(today),
    expiryDate: null,
    customer: { name: request.customerName, soldTo: request.customerSoldTo, contactName: "", contactEmail: "" },
    preparedBy,
    lines: [
      {
        partNumber: request.altronicPartNumber,
        sapPartNumber: request.sapPartNumber,
        customerPartNumber: "",
        description: request.description,
        quantity: 1,
        unitPrice: price,
        subtotal: price,
        breaks: [],
      },
    ],
    total: price,
    notes: "",
  };
}

/** `${number}.pdf`, with the characters SharePoint refuses replaced. */
export function pricingPdfFileName(model: Pick<PricingPdfModel, "number">): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = model.number.replace(/["*:<>?/\\|\u0000-\u001f]/g, "-").replace(/^[\s.]+|[\s.]+$/g, "");
  return `${cleaned || "quote"}.pdf`;
}

const MARGIN = 54;
const PAGE_W = 612;

export async function buildPricingPdf(model: PricingPdfModel, opts: { compress?: boolean; logo?: boolean } = {}): Promise<jsPDF> {
  const [{ jsPDF: JsPdf }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = (autoTableModule.autoTable ?? autoTableModule.default) as AutoTableFn;
  const doc = new JsPdf({ orientation: "portrait", unit: "pt", format: "letter", compress: opts.compress ?? true });
  renderPricingPdf(doc, autoTable, model, opts.logo ?? true);
  return doc;
}

export async function generatePricingPdf(model: PricingPdfModel): Promise<Blob> {
  return (await buildPricingPdf(model)).output("blob");
}

export function renderPricingPdf(doc: jsPDF, autoTable: AutoTableFn, model: PricingPdfModel, logo = true): void {
  doc.setProperties({ title: `${model.title === "QUOTATION" ? "Quotation" : "Price confirmation"} ${model.number}`, creator: "Altronic ARC" });
  const right = PAGE_W - MARGIN;
  let y = 50;

  if (logo) {
    try {
      doc.addImage(`data:image/png;base64,${ALTRONIC_WORDMARK_BLACK_PNG}`, "PNG", MARGIN, y, 150, 150 / ALTRONIC_WORDMARK_ASPECT);
    } catch {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("ALTRONIC", MARGIN, y + 16);
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text(model.title, right, y + 16, { align: "right" });
  doc.setFontSize(11);
  doc.text(model.number, right, y + 34, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(64, 64, 64);
  doc.text(`Issued ${model.issueDate}`, right, y + 47, { align: "right" });
  if (model.expiryDate) doc.text(`Valid until ${model.expiryDate}`, right, y + 59, { align: "right" });

  y += 76;
  doc.setDrawColor(0xcb, 0xa0, 0x52);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, y, right, y);
  y += 22;

  // Prepared for / Prepared by, side by side.
  const col2 = MARGIN + (right - MARGIN) / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(115, 115, 115);
  doc.text("PREPARED FOR", MARGIN, y);
  if (model.preparedBy) doc.text("PREPARED BY", col2, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  const forLines = [
    model.customer.name,
    model.customer.soldTo && `Account ${model.customer.soldTo}`,
    model.customer.contactName,
    model.customer.contactEmail,
  ].filter(Boolean) as string[];
  forLines.forEach((t, i) => doc.text(t, MARGIN, y + 14 + i * 13));
  if (model.preparedBy) {
    [model.preparedBy.name, model.preparedBy.email].filter(Boolean).forEach((t, i) => doc.text(t, col2, y + 14 + i * 13));
  }
  y += 14 + Math.max(forLines.length, 2) * 13 + 14;

  const body = model.lines.map((l) => [
    [
      l.partNumber,
      l.description,
      [l.sapPartNumber && `SAP part no. ${l.sapPartNumber}`, l.customerPartNumber && `Your part no. ${l.customerPartNumber}`]
        .filter(Boolean)
        .join(" · "),
    ]
      .filter(Boolean)
      .join("\n"),
    l.breaks.length ? l.breaks.map((b) => `${b.range} pcs   ${money(b.price)}`).join("\n") : money(l.unitPrice),
    String(l.quantity),
    money(l.subtotal),
  ]);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Item", "Price each", "Qty", "Subtotal"]],
    body,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: [0, 0, 0], lineColor: [200, 200, 200] },
    headStyles: { fontStyle: "bold", fillColor: [240, 240, 240] },
    columnStyles: { 0: { cellWidth: 230 }, 2: { halign: "right" }, 3: { halign: "right" } },
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        doc.setDrawColor(200, 200, 200);
        doc.line(MARGIN, data.cell.y + data.cell.height, right, data.cell.y + data.cell.height);
      }
    },
  });
  const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40;
  y = after + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Total  ${money(model.total)}`, right, y, { align: "right" });

  if (model.notes.trim()) {
    y += 26;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text("NOTES", MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(doc.splitTextToSize(model.notes.trim(), right - MARGIN), MARGIN, y + 13);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text(`${model.number} · Page ${p} of ${pages}`, right, 792 - 30, { align: "right" });
  }
}
