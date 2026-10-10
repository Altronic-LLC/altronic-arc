import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_BUDGETARY_TEXT,
  DEFAULT_BUDGETARY_TITLE,
  type Quote,
  type QuoteAssembly,
  type QuoteCustomer,
  type QuoteItem,
} from "@/types/quote";
import { priceQuoteAssembly } from "./quotePricing";
import { buildQuotePdfModel, quoteExpiryDate } from "./quotePdfModel";

function quote(over: Partial<Quote> = {}): Quote {
  return {
    id: 1,
    quoteNumber: "IQ-ACM-0042-R2",
    quoteBase: "IQ-ACM-0042",
    rev: 2,
    customerId: 5,
    status: "Draft",
    validityDays: 30,
    contactName: "Pat Buyer",
    contactEmail: "pat@acme.example",
    budgetary: false,
    budgetaryText: "",
    quoteNotes: "  Lead time 6 weeks ARO.  ",
    comments: [
      {
        timestamp: new Date("2026-10-01T12:00:00Z"),
        authorName: "Secret Commenter",
        authorEmail: "secret.commenter@altronic-llc.com",
        bodyHtml: "<p>INTERNAL-ONLY-REMARK: we can go lower</p>",
      },
    ],
    watchers: [{ displayName: "Hidden Watcher", email: "hidden.watcher@altronic-llc.com", lookupId: 7 }],
    engineeringTaskLink: { url: "https://example.invalid/task/9", description: "ENG-LINK-SECRET" },
    operationsTaskLink: null,
    engineeringProjectRef: "PROJ-SECRET-REF",
    hasAttachments: true,
    createdBy: { displayName: "Creator Person" },
    createdAt: "2026-10-01T00:00:00Z",
    modifiedAt: "2026-10-02T00:00:00Z",
    ...over,
  };
}

const CUSTOMER: QuoteCustomer = {
  id: 5,
  name: "Acme Compression",
  code: "ACM",
  customerNumber: "0001042",
  active: true,
  note: "CUSTOMER-NOTE-SECRET",
};

function assembly(over: Partial<QuoteAssembly> = {}): QuoteAssembly {
  return {
    id: 10,
    quoteId: 1,
    lineNo: 1,
    lineType: "Assembly",
    quotedQty: 1,
    cost: null,
    materialOverheadPct: null,
    altronicPartNumber: "791950-08",
    sapPartNumber: "SAP-791950",
    customerPartNumber: "ACME-77",
    description: "CPU-95 ignition module",
    priceBreaks: [
      { qty: 10, discountPct: 5, note: "BREAK-NOTE-SECRET" },
      { qty: 25, discountPct: 11, note: "" },
    ],
    targetGM: 37.77,
    manualPrice: null,
    customerPrice: 999.01,
    ...over,
  };
}

function item(over: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: 100,
    quoteId: 1,
    assemblyId: 10,
    lineNo: 1,
    altronicPartNumber: "COMP-SECRET-601",
    sapPartNumber: "COMP-SAP-SECRET",
    description: "COMPONENT-DESC-SECRET",
    quantity: 2,
    cost: 1234.56,
    materialOverheadPct: 12.34,
    comments: [
      {
        timestamp: new Date("2026-10-01T12:00:00Z"),
        authorName: "Item Commenter",
        authorEmail: "item.commenter@altronic-llc.com",
        bodyHtml: "<p>ITEM-REMARK-SECRET</p>",
      },
    ],
    watchers: [{ displayName: "Item Watcher" }],
    hasAttachments: true,
    ...over,
  };
}

describe("quoteExpiryDate", () => {
  // A US zone: the drift this avoids only exists away from UTC. No
  // @types/node here — reach process.env the way dateInput.writtenDate.test.ts does.
  const env = (globalThis as unknown as {
    process: { env: Record<string, string | undefined> };
  }).process.env;
  const savedTz = env.TZ;
  beforeAll(() => {
    env.TZ = "America/Chicago";
  });
  afterAll(() => {
    env.TZ = savedTz;
  });

  it("adds validity days across a month end", () => {
    expect(quoteExpiryDate("2026-01-31", 30)).toBe("2026-03-02");
    expect(quoteExpiryDate("2026-12-15", 30)).toBe("2027-01-14");
    expect(quoteExpiryDate("2028-02-15", 30)).toBe("2028-03-16"); // leap year
  });

  it("doesn't drift across the DST changes", () => {
    expect(quoteExpiryDate("2026-10-30", 30)).toBe("2026-11-29"); // fall back, Nov 1
    expect(quoteExpiryDate("2026-03-01", 30)).toBe("2026-03-31"); // spring forward, Mar 8
    expect(quoteExpiryDate("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("is the issue date itself for zero days", () => {
    expect(quoteExpiryDate("2026-10-09", 0)).toBe("2026-10-09");
  });

  it("is empty for an invalid date or validity", () => {
    expect(quoteExpiryDate("", 30)).toBe("");
    expect(quoteExpiryDate("2026-02-31", 30)).toBe("");
    expect(quoteExpiryDate("10/09/2026", 30)).toBe("");
    expect(quoteExpiryDate("2026-10-09", -1)).toBe("");
    expect(quoteExpiryDate("2026-10-09", 1.5)).toBe("");
  });
});

describe("buildQuotePdfModel", () => {
  const base = {
    quote: quote(),
    customer: CUSTOMER,
    assemblies: [assembly()],
    items: [item()],
    issueDate: "2026-10-09",
  };

  it("builds the customer model", () => {
    const { model, problems } = buildQuotePdfModel(base);
    expect(problems).toEqual([]);
    const price = priceQuoteAssembly(assembly(), [item()]).price!;
    expect(model).toEqual({
      quoteNumber: "IQ-ACM-0042-R2",
      rev: 2,
      issueDate: "2026-10-09",
      expiryDate: "2026-11-08",
      customerName: "Acme Compression",
      customerNumber: "0001042",
      contactName: "Pat Buyer",
      contactEmail: "pat@acme.example",
      preparedBy: null,
      assemblies: [
        {
          lineNo: 1,
          altronicPartNumber: "791950-08",
          sapPartNumber: "SAP-791950",
          customerPartNumber: "ACME-77",
          description: "CPU-95 ignition module",
          tiers: [
            { rangeLabel: "1 – 9", unitPrice: price },
            { rangeLabel: "10 – 24", unitPrice: expect.any(Number) },
            { rangeLabel: "25+", unitPrice: expect.any(Number) },
          ],
          quotedQty: 1,
          quotedUnitPrice: price,
          lineTotal: price,
        },
      ],
      quoteTotal: price,
      budgetary: null,
      quoteNotes: "Lead time 6 weeks ARO.",
    });
  });

  it("carries Prepared by field by field, trimmed; null when both are blank", () => {
    const passed = { name: "  Ray White ", email: " ray.white@altronic-llc.com ", extra: "SECRET" };
    const { model } = buildQuotePdfModel({ ...base, preparedBy: passed });
    expect(model!.preparedBy).toEqual({ name: "Ray White", email: "ray.white@altronic-llc.com" });
    expect(model!.preparedBy).not.toBe(passed);
    expect(buildQuotePdfModel({ ...base, preparedBy: { name: " ", email: "" } }).model!.preparedBy).toBeNull();
    expect(buildQuotePdfModel({ ...base, preparedBy: { name: "", email: "x@y.com" } }).model!.preparedBy).toEqual({
      name: "",
      email: "x@y.com",
    });
  });

  it("carries each line's quoted quantity, unit price at that break and Subtotal, and the Total", () => {
    // 30 falls in the 25+ tier (11% off); the second line is quoted for one.
    const { model } = buildQuotePdfModel({
      ...base,
      assemblies: [assembly({ quotedQty: 30 }), assembly({ id: 11, lineNo: 2, altronicPartNumber: "B" })],
      items: [item(), item({ id: 101, assemblyId: 11, cost: 10 })],
    });
    const [a, b] = model!.assemblies;
    const p = priceQuoteAssembly(assembly({ quotedQty: 30 }), [item()]);
    expect(a.quotedQty).toBe(30);
    expect(a.quotedUnitPrice).toBe(p.tiers[2].unitPrice);
    expect(a.lineTotal).toBe(p.lineTotal);
    expect(b.quotedQty).toBe(1);
    expect(model!.quoteTotal).toBe(Math.round((a.lineTotal + b.lineTotal) * 100) / 100);
  });

  it("includes only this quote's assemblies, in line order", () => {
    const { model } = buildQuotePdfModel({
      ...base,
      assemblies: [
        assembly({ id: 11, lineNo: 2, altronicPartNumber: "B" }),
        assembly({ id: 12, quoteId: 99, lineNo: 0, altronicPartNumber: "OTHER" }),
        assembly({ id: 10, lineNo: 1, altronicPartNumber: "A" }),
      ],
      items: [item(), item({ id: 101, assemblyId: 11, cost: 10 })],
    });
    expect(model!.assemblies.map((a) => a.altronicPartNumber)).toEqual(["A", "B"]);
  });

  it("uses the manual price when one is set", () => {
    const { model } = buildQuotePdfModel({
      ...base,
      assemblies: [assembly({ manualPrice: 500, priceBreaks: [] })],
    });
    expect(model!.assemblies[0].tiers).toEqual([{ rangeLabel: "1+", unitPrice: 500 }]);
  });

  it("refuses an unpriced assembly, no assemblies, a bad break, no customer or a bad date", () => {
    const unpriced = buildQuotePdfModel({ ...base, items: [item({ cost: null })] });
    expect(unpriced.model).toBeNull();
    expect(unpriced.problems).toEqual([
      "Line 1 (791950-08) has no price yet — complete its components and target GM, or set a manual price.",
    ]);
    const unpricedPart = buildQuotePdfModel({
      ...base,
      assemblies: [assembly({ lineType: "Part", cost: null })],
      items: [],
    });
    expect(unpricedPart.problems).toEqual([
      "Line 1 (791950-08) has no price yet — enter its cost and target GM, or set a manual price.",
    ]);

    const none = buildQuotePdfModel({ ...base, assemblies: [assembly({ quoteId: 2 })] });
    expect(none.model).toBeNull();
    expect(none.problems).toEqual(["This quote has no lines to print."]);

    const badBreak = buildQuotePdfModel({
      ...base,
      assemblies: [assembly({ priceBreaks: [{ qty: 10, discountPct: 150, note: "" }] })],
    });
    expect(badBreak.model).toBeNull();
    expect(badBreak.problems[0]).toMatch(/quantity breaks that need fixing/);

    const noCustomer = buildQuotePdfModel({ ...base, customer: null });
    expect(noCustomer.model).toBeNull();
    expect(noCustomer.problems).toEqual(["Choose a customer before generating the quote."]);

    expect(buildQuotePdfModel({ ...base, issueDate: "" }).problems).toEqual([
      "The issue date isn't a valid date.",
    ]);
    expect(buildQuotePdfModel({ ...base, quote: quote({ validityDays: -3 }) }).problems).toEqual([
      "The validity must be a whole number of days.",
    ]);
  });

  it("prints the default budgetary wording, or the quote's own", () => {
    const def = buildQuotePdfModel({ ...base, quote: quote({ budgetary: true, budgetaryText: "  " }) });
    expect(def.model!.budgetary).toEqual({ title: DEFAULT_BUDGETARY_TITLE, text: DEFAULT_BUDGETARY_TEXT });
    const own = buildQuotePdfModel({
      ...base,
      quote: quote({ budgetary: true, budgetaryText: "  Prototype pricing.  " }),
    });
    expect(own.model!.budgetary).toEqual({ title: DEFAULT_BUDGETARY_TITLE, text: "Prototype pricing." });
    // Text typed while unticked doesn't print.
    const off = buildQuotePdfModel({ ...base, quote: quote({ budgetaryText: "Prototype" }) });
    expect(off.model!.budgetary).toBeNull();
  });

  describe("THE LEAK GUARANTEE", () => {
    // A standalone PART line alongside the assembly, with its own distinctive
    // cost, overhead and target GM.
    const partLine = assembly({
      id: 20,
      lineNo: 2,
      lineType: "Part",
      cost: 4321.09,
      materialOverheadPct: 7.65,
      targetGM: 41.23,
      altronicPartNumber: "SPARE-PART-1",
      priceBreaks: [{ qty: 5, discountPct: 3, note: "PART-BREAK-NOTE-SECRET" }],
    });
    const { model } = buildQuotePdfModel({
      ...base,
      quote: quote({ budgetary: true }),
      assemblies: [assembly(), partLine],
      // A smuggled extra key on the signed-in user must not ride along.
      preparedBy: { name: "Quoter Person", email: "quoter@altronic-llc.com", lookupId: 7 } as unknown as {
        name: string;
        email: string;
      },
    });
    const json = JSON.stringify(model);
    const pricing = priceQuoteAssembly(assembly(), [item()]);
    const partPricing = priceQuoteAssembly(partLine, []);

    it("prints the Part line like any other line", () => {
      expect(model!.assemblies.map((a) => a.altronicPartNumber)).toEqual(["791950-08", "SPARE-PART-1"]);
      expect(model!.assemblies[1].tiers[0].unitPrice).toBe(partPricing.price);
    });

    it("contains no cost, overhead, target GM, profit or margin figure", () => {
      expect(model).not.toBeNull();
      const forbidden = [
        "1234.56", // unit cost
        "12.34", // material overhead
        "37.77", // the assembly's target GM
        "4321.09", // the Part line's cost
        "7.65", // the Part line's overhead
        "41.23", // the Part line's target GM
        partPricing.unitCost!.toFixed(2),
        partPricing.profit!.toFixed(2),
        partPricing.gmPct!.toFixed(2),
        partPricing.markupPct!.toFixed(2),
        ...partPricing.tiers.map((t) => t.gmPct!.toFixed(2)),
        "999.01", // the stored CustomerPrice — the model recomputes
        pricing.unitCost!.toFixed(2),
        pricing.items[0].loadedUnitCost!.toFixed(2),
        pricing.profit!.toFixed(2),
        pricing.gmPct!.toFixed(2),
        pricing.markupPct!.toFixed(2),
        ...pricing.tiers.map((t) => t.gmPct!.toFixed(2)),
        ...pricing.tiers.map((t) => t.profit!.toFixed(2)),
      ];
      for (const value of forbidden) expect(json).not.toContain(value);
    });

    it("contains none of the words cost, margin, markup, overhead or gm", () => {
      // Whole words, so the budgetary wording's "costing" is allowed.
      expect(json).not.toMatch(/\b(cost|margin|markup|overhead|gm|profit|discount)\b/i);
      expect(json).not.toMatch(/"[^"]*(cost|margin|markup|overhead|gm|profit|discount)[^"]*":/i);
    });

    it("contains no comments, watchers, component lines or internal links", () => {
      for (const secret of [
        "INTERNAL-ONLY-REMARK",
        "Secret Commenter",
        "secret.commenter",
        "Hidden Watcher",
        "ITEM-REMARK-SECRET",
        "Item Watcher",
        "COMP-SECRET-601",
        "COMP-SAP-SECRET",
        "COMP-CUST-SECRET",
        "COMPONENT-DESC-SECRET",
        "ENG-LINK-SECRET",
        "PROJ-SECRET-REF",
        "CUSTOMER-NOTE-SECRET",
        "BREAK-NOTE-SECRET",
        "Creator Person",
      ]) {
        expect(json).not.toContain(secret);
      }
    });

    it("has EXACTLY the customer-facing keys — nothing spread in", () => {
      expect(Object.keys(model!).sort()).toEqual(
        [
          "assemblies",
          "budgetary",
          "contactEmail",
          "contactName",
          "customerName",
          "customerNumber",
          "expiryDate",
          "issueDate",
          "preparedBy",
          "quoteNotes",
          "quoteTotal",
          "quoteNumber",
          "rev",
        ].sort(),
      );
      for (const a of model!.assemblies) {
        expect(Object.keys(a).sort()).toEqual(
          [
            "altronicPartNumber",
            "customerPartNumber",
            "description",
            "lineNo",
            "lineTotal",
            "quotedQty",
            "quotedUnitPrice",
            "sapPartNumber",
            "tiers",
          ].sort(),
        );
        for (const t of a.tiers) expect(Object.keys(t).sort()).toEqual(["rangeLabel", "unitPrice"]);
      }
      expect(Object.keys(model!.budgetary!).sort()).toEqual(["text", "title"]);
      expect(Object.keys(model!.preparedBy!).sort()).toEqual(["email", "name"]);
    });
  });
});
