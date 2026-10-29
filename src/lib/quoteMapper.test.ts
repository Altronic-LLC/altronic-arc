import { describe, expect, it } from "vitest";
import type { GraphListItem } from "@/types/task";
import type { Quote, QuoteAssembly, QuoteCustomer } from "@/types/quote";
import {
  QUOTE_ASSEMBLY_SELECT,
  QUOTE_CUSTOMER_SELECT,
  QUOTE_ROLE_SELECT,
  QUOTE_SELECT,
  applyQuotePatch,
  buildQuoteAssemblyCreateFields,
  buildQuoteAssemblyUpdateFields,
  buildQuoteCreateFields,
  buildQuoteCustomerCreateFields,
  buildQuoteCustomerUpdateFields,
  buildQuoteRoleCreateFields,
  buildQuoteRoleUpdateFields,
  buildQuoteUpdateFields,
  compareQuotes,
  isUniqueValueRejection,
  mockUniqueRejection,
  parseLeadTimes,
  parsePastedLeadTimes,
  parsePriceBreaks,
  serializeLeadTimes,
  serializePriceBreaks,
  toQuote,
  toQuoteAssembly,
  toQuoteCustomer,
  toQuoteRoleEntry,
} from "./quoteMapper";
import { parseQuoteRoles, serializeQuoteRoles } from "./quoteRoles";

/** The exact column set from design section 13.1 — a `$select` outside it 400s the whole read. */
const CONTRACT = {
  quotes: [
    "Title", "QuoteBase", "Rev", "CustomerRef", "Status", "ValidityDays", "ContactName", "ContactEmail",
    "Budgetary", "BudgetaryText", "QuoteNotes", "CustomerReference", "LeadTimes", "Communication", "Watchers",
    "EngineeringTaskId", "OperationsTaskId", "EngineeringProjectRef", "OperationsProjectRef",
  ],
  assemblies: [
    "Title", "QuoteRef", "LineNo", "QuotedQty", "Cost", "LaborCost", "MaterialOverheadPct", "SapPartNumber",
    "CustomerPartNumber", "Description", "PriceBreaks", "TargetGM", "ManualPrice", "CustomerPrice",
  ],
  customers: ["Title", "CustomerCode", "CustomerNumber", "Active", "Note"],
  roles: ["Title", "PersonName", "Roles", "Note"],
};
/** Built-in columns every list has. */
const BUILT_IN = ["Attachments"];

function columnsOf(select: string): string[] {
  return select.split(",");
}

function assertWithinContract(select: string, allowed: string[], lookups: string[]) {
  for (const col of columnsOf(select)) {
    const base = col.endsWith("LookupId") ? col.slice(0, -"LookupId".length) : col;
    expect([...allowed, ...BUILT_IN], `${col} is not a 13.1 column`).toContain(base);
  }
  for (const l of lookups) {
    expect(columnsOf(select)).toContain(l);
    expect(columnsOf(select)).toContain(`${l}LookupId`);
  }
}

function item(fields: Record<string, unknown>, extra: Partial<GraphListItem> = {}): GraphListItem {
  return {
    id: "7",
    createdDateTime: "2026-10-01T12:00:00Z",
    lastModifiedDateTime: "2026-10-02T12:00:00Z",
    fields,
    ...extra,
  } as GraphListItem;
}

describe("$select — inside the 13.1 contract, BOTH halves of every single lookup", () => {
  it("quotes", () => assertWithinContract(QUOTE_SELECT, CONTRACT.quotes, ["CustomerRef"]));
  it("assemblies", () => assertWithinContract(QUOTE_ASSEMBLY_SELECT, CONTRACT.assemblies, ["QuoteRef"]));
  it("no longer reads the Hyperlink link columns or the old LineType", () => {
    expect(columnsOf(QUOTE_SELECT)).not.toContain("EngineeringTaskLink");
    expect(columnsOf(QUOTE_SELECT)).not.toContain("OperationsTaskLink");
    expect(columnsOf(QUOTE_ASSEMBLY_SELECT)).not.toContain("LineType");
  });
  it("customers", () => assertWithinContract(QUOTE_CUSTOMER_SELECT, CONTRACT.customers, []));
  it("roles — PersonName, never DisplayName", () => {
    assertWithinContract(QUOTE_ROLE_SELECT, CONTRACT.roles, []);
    expect(QUOTE_ROLE_SELECT).not.toMatch(/DisplayName/);
  });
});

describe("price breaks", () => {
  it("round-trips", () => {
    const breaks = [
      { qty: 10, discountPct: 5, note: "" },
      { qty: 50, discountPct: 10, note: "blanket" },
    ];
    expect(parsePriceBreaks(serializePriceBreaks(breaks))).toEqual(breaks);
  });

  it("is tolerant: bad JSON, non-arrays and malformed entries", () => {
    expect(parsePriceBreaks("not json")).toEqual([]);
    expect(parsePriceBreaks('{"qty":5}')).toEqual([]);
    expect(parsePriceBreaks("")).toEqual([]);
    expect(parsePriceBreaks(null)).toEqual([]);
    expect(
      parsePriceBreaks(
        JSON.stringify([
          { qty: 50, discountPct: "10" },
          null,
          { qty: "x", discountPct: 3 },
          { qty: 0, discountPct: 3 },
          { qty: 2.5, discountPct: 3 },
          { qty: 5, discountPct: 120 },
          { qty: 10 },
        ]),
      ),
    ).toEqual([
      { qty: 10, discountPct: 0, note: "" },
      { qty: 50, discountPct: 10, note: "" },
    ]);
  });

  it("an empty set serialises to blank", () => {
    expect(serializePriceBreaks([])).toBe("");
  });
});

describe("lead times", () => {
  const ROWS = [
    { partNumber: "693005-1", description: "Harness", leadTime: "3 weeks", reason: "Second source" },
    { partNumber: "791950-08", description: "", leadTime: "6–8 weeks", reason: "" },
  ];

  it("round-trips, dropping blank rows and trimming", () => {
    const stored = serializeLeadTimes([...ROWS, { partNumber: " ", description: "", leadTime: "", reason: "" }]);
    expect(parseLeadTimes(stored)).toEqual({ rows: ROWS, corrupt: false });
    expect(serializeLeadTimes([])).toBe("");
    expect(parseLeadTimes("")).toEqual({ rows: [], corrupt: false });
    expect(parseLeadTimes(undefined)).toEqual({ rows: [], corrupt: false });
  });

  it("reports a value it can't read as CORRUPT, never as an empty table", () => {
    expect(parseLeadTimes("{broken")).toEqual({ rows: [], corrupt: true });
    expect(parseLeadTimes('{"partNumber":"x"}')).toEqual({ rows: [], corrupt: true });
    expect(toQuote(item({ LeadTimes: "{broken" })).leadTimesCorrupt).toBe(true);
  });

  it("parses rows pasted from Excel — tabs between cells, header skipped", () => {
    const pasted = [
      "Part #\tDescription\tLead time\tReason",
      "693005-1\tHarness\t3 weeks\tSecond source",
      "",
      "791950-08\t\t6–8 weeks",
      "LONE-PART",
      "X1\tD\t2 wk\tcheaper\tand in stock",
    ].join("\r\n");
    expect(parsePastedLeadTimes(pasted)).toEqual([
      ROWS[0],
      ROWS[1],
      { partNumber: "LONE-PART", description: "", leadTime: "", reason: "" },
      { partNumber: "X1", description: "D", leadTime: "2 wk", reason: "cheaper and in stock" },
    ]);
  });

  it("keeps a first row that is data, not a header", () => {
    expect(parsePastedLeadTimes("PART-9\tWidget\t1 wk")).toEqual([
      { partNumber: "PART-9", description: "Widget", leadTime: "1 wk", reason: "" },
    ]);
  });
});

describe("role tags", () => {
  it("parse loosely, keep known tags in canonical order", () => {
    expect(parseQuoteRoles("Manager, viewer;bogus, viewer")).toEqual(["viewer", "manager"]);
    expect(parseQuoteRoles(["QUOTER"])).toEqual(["quoter"]);
    expect(parseQuoteRoles(undefined)).toEqual([]);
    expect(serializeQuoteRoles(["manager", "quoter"])).toBe("quoter,manager");
  });
});

describe("toQuote", () => {
  it("maps every column, lookup ids arriving as STRINGS", () => {
    const q = toQuote(
      item(
        {
          Title: "IQ-COO-0042-R2",
          QuoteBase: "IQ-COO-0042",
          Rev: 2,
          CustomerRefLookupId: "3",
          Status: "Sent",
          ValidityDays: 45,
          ContactName: " Mark ",
          ContactEmail: "m@x.com",
          Budgetary: true,
          BudgetaryText: "Non-binding",
          QuoteNotes: "FOB Girard",
          Communication: "10/01/2026 9:00:00 AM|||Ray White|||ray@x.com|||<p>hi</p>",
          Watchers: [{ LookupId: 22, LookupValue: "Ray White", Email: "ray@x.com" }],
          CustomerReference: " RFQ 4471 ",
          LeadTimes: '[{"partNumber":"P1","description":"D","leadTime":"3 wk","reason":"R"}]',
          EngineeringTaskId: 5,
          OperationsTaskId: "12",
          EngineeringProjectRef: "0042-NGI",
          OperationsProjectRef: "0007-Line 3",
          Attachments: true,
        },
        { createdBy: { user: { displayName: "Katie", email: "k@x.com" } } },
      ),
    );
    expect(q).toMatchObject({
      id: 7,
      quoteNumber: "IQ-COO-0042-R2",
      quoteBase: "IQ-COO-0042",
      rev: 2,
      customerId: 3,
      status: "Sent",
      validityDays: 45,
      contactName: "Mark",
      budgetary: true,
      customerReference: "RFQ 4471",
      leadTimes: [{ partNumber: "P1", description: "D", leadTime: "3 wk", reason: "R" }],
      leadTimesCorrupt: false,
      engineeringTaskId: 5,
      operationsTaskId: 12,
      engineeringProjectRef: "0042-NGI",
      operationsProjectRef: "0007-Line 3",
      hasAttachments: true,
      createdBy: { displayName: "Katie", email: "k@x.com" },
      createdAt: "2026-10-01T12:00:00Z",
      modifiedAt: "2026-10-02T12:00:00Z",
    });
    expect(q.comments).toHaveLength(1);
    expect(q.watchers).toEqual([{ displayName: "Ray White", email: "ray@x.com", lookupId: 22 }]);
  });

  it("reads an expanded lookup object too, and defaults sensibly", () => {
    const q = toQuote(item({ CustomerRef: { LookupId: 9, LookupValue: "Cooper" }, Status: "Superseded" }));
    expect(q.customerId).toBe(9);
    // Unknown status → Draft (documented in toStatus).
    expect(q.status).toBe("Draft");
    expect(q.rev).toBe(1);
    expect(q.validityDays).toBe(30);
    expect(q.budgetary).toBe(false);
    expect(q.createdBy).toBeNull();
    expect(q.engineeringTaskId).toBeNull();
    expect(q.operationsTaskId).toBeNull();
    expect(q.customerReference).toBe("");
    expect(q.leadTimes).toEqual([]);
    expect(toQuote(item({ CustomerRefLookupId: "" })).customerId).toBeNull();
  });
});

describe("toQuoteAssembly / toQuoteCustomer / toQuoteRoleEntry", () => {
  it("assembly", () => {
    const a = toQuoteAssembly(
      item({
        Title: "791950-08",
        QuoteRefLookupId: "12",
        LineNo: 2,
        QuotedQty: 30,
        Cost: 520,
        LaborCost: 85,
        MaterialOverheadPct: 18,
        SapPartNumber: "1002-4587-10",
        CustomerPartNumber: "C-1",
        Description: "Module",
        PriceBreaks: '[{"qty":10,"discountPct":5,"note":""}]',
        TargetGM: 40,
        ManualPrice: null,
        CustomerPrice: 1070.26,
      }),
    );
    expect(a).toEqual({
      id: 7,
      quoteId: 12,
      lineNo: 2,
      quotedQty: 30,
      materialCost: 520,
      laborCost: 85,
      materialOverheadPct: 18,
      altronicPartNumber: "791950-08",
      sapPartNumber: "1002-4587-10",
      customerPartNumber: "C-1",
      description: "Module",
      priceBreaks: [{ qty: 10, discountPct: 5, note: "" }],
      targetGM: 40,
      manualPrice: null,
      customerPrice: 1070.26,
    });
  });

  it("the quoted quantity is NEVER blank: missing, blank, zero, negative or fractional reads as 1", () => {
    for (const raw of [undefined, null, "", 0, -3, 2.5, "x"]) {
      expect(toQuoteAssembly(item({ Title: "A", QuotedQty: raw })).quotedQty, String(raw)).toBe(1);
    }
    expect(toQuoteAssembly(item({ Title: "A", QuotedQty: 12 })).quotedQty).toBe(12);
    expect(toQuoteAssembly(item({ Title: "A", QuotedQty: "12" })).quotedQty).toBe(12);
    // A create always sends it — a bad value is written as 1.
    expect(buildQuoteAssemblyCreateFields({ ...ASSEMBLY, quoteId: 1, quotedQty: 0 }).QuotedQty).toBe(1);
  });

  it("assembly — blank costs read null; the SAP # is read as stored", () => {
    expect(toQuoteAssembly(item({ Title: "A" }))).toMatchObject({ materialCost: null, laborCost: null, materialOverheadPct: null });
    expect(toQuoteAssembly(item({ Title: "A", SapPartNumber: "100245871" })).sapPartNumber).toBe("100245871");
  });

  it("customer — text sold-to keeps zeros; missing Active reads active", () => {
    const c = toQuoteCustomer(item({ Title: "Cooper", CustomerCode: "coo", CustomerNumber: "0001042" }));
    expect(c).toEqual({ id: 7, name: "Cooper", code: "COO", customerNumber: "0001042", active: true, note: "" });
    expect(toQuoteCustomer(item({ Active: false })).active).toBe(false);
  });

  it("role entry", () => {
    expect(
      toQuoteRoleEntry(item({ Title: "Ray@X.com", PersonName: "Ray", Roles: "manager", Note: "" })),
    ).toEqual({ id: 7, email: "ray@x.com", displayName: "Ray", roles: ["manager"], note: "" });
  });
});

const QUOTE: Quote = {
  id: 1,
  quoteNumber: "IQ-COO-0001-R1",
  quoteBase: "IQ-COO-0001",
  rev: 1,
  customerId: 3,
  status: "Draft",
  validityDays: 30,
  contactName: "Mark",
  contactEmail: "m@x.com",
  budgetary: false,
  budgetaryText: "",
  quoteNotes: "",
  customerReference: "",
  leadTimes: [],
  leadTimesCorrupt: false,
  comments: [],
  watchers: [],
  engineeringTaskId: null,
  operationsTaskId: null,
  engineeringProjectRef: "",
  operationsProjectRef: "",
  hasAttachments: false,
  createdBy: null,
  createdAt: null,
  modifiedAt: null,
};

describe("quote field builders", () => {
  it("create: bare-integer lookup, two-key Watchers, NO hyperlink columns, blanks left out", () => {
    const fields = buildQuoteCreateFields({
      quoteNumber: "IQ-COO-0001-R1",
      quoteBase: "IQ-COO-0001",
      rev: 1,
      customerId: 3,
      status: "Draft",
      validityDays: 30,
      contactName: "Mark",
      contactEmail: "",
      budgetary: true,
      budgetaryText: "Non-binding",
      quoteNotes: "",
      watchers: [{ displayName: "A", lookupId: 5 }, { displayName: "B" }],
    });
    expect(fields).toEqual({
      Title: "IQ-COO-0001-R1",
      QuoteBase: "IQ-COO-0001",
      Rev: 1,
      Status: "Draft",
      ValidityDays: 30,
      Budgetary: true,
      CustomerRefLookupId: 3,
      ContactName: "Mark",
      BudgetaryText: "Non-binding",
      "WatchersLookupId@odata.type": "Collection(Edm.Int32)",
      WatchersLookupId: [5],
    });
    expect(Object.keys(fields).join()).not.toMatch(/Link/);
  });

  it("create carries the reference, lead times and links when set", () => {
    const fields = buildQuoteCreateFields({
      quoteNumber: "x", quoteBase: "x", rev: 2, customerId: null, status: "Draft", validityDays: 30,
      contactName: "", contactEmail: "", budgetary: false, budgetaryText: "", quoteNotes: "",
      customerReference: " RFQ 1 ",
      leadTimes: [{ partNumber: "P1", description: "", leadTime: "2 wk", reason: "" }],
      engineeringTaskId: 47,
      operationsTaskId: 9,
      engineeringProjectRef: "0042-NGI",
      operationsProjectRef: "0007-Line 3",
      watchers: [],
    });
    expect(fields).toMatchObject({
      CustomerReference: "RFQ 1",
      LeadTimes: '[{"partNumber":"P1","description":"","leadTime":"2 wk","reason":""}]',
      EngineeringTaskId: 47,
      OperationsTaskId: 9,
      EngineeringProjectRef: "0042-NGI",
      OperationsProjectRef: "0007-Line 3",
    });
  });

  it("create leaves Watchers out when nobody resolved", () => {
    const fields = buildQuoteCreateFields({
      quoteNumber: "x", quoteBase: "x", rev: 1, customerId: null, status: "Draft", validityDays: 30,
      contactName: "", contactEmail: "", budgetary: false, budgetaryText: "", quoteNotes: "",
      watchers: [{ displayName: "B" }], communication: "carried",
    });
    expect(fields).not.toHaveProperty("WatchersLookupId");
    expect(fields).not.toHaveProperty("CustomerRefLookupId");
    expect(fields.Communication).toBe("carried");
  });

  it("update is DIFFED: only changed columns, nothing when unchanged", () => {
    expect(buildQuoteUpdateFields({ contactName: "Mark", status: "Draft", customerId: 3 }, QUOTE)).toEqual({});
    expect(buildQuoteUpdateFields({ contactName: " Mark ", status: "Sent" }, QUOTE)).toEqual({ Status: "Sent" });
    expect(buildQuoteUpdateFields({ customerId: 4, budgetary: true }, QUOTE)).toEqual({
      CustomerRefLookupId: 4,
      Budgetary: true,
    });
    expect(buildQuoteUpdateFields({ customerId: null }, QUOTE)).toEqual({ CustomerRefLookupId: null });
    expect(buildQuoteUpdateFields({ contactName: undefined }, QUOTE)).toEqual({});
  });

  it("update writes the links as numbers / titles, and the lead times as JSON", () => {
    expect(buildQuoteUpdateFields({ engineeringTaskId: 47, operationsProjectRef: "0007" }, QUOTE)).toEqual({
      EngineeringTaskId: 47,
      OperationsProjectRef: "0007",
    });
    expect(buildQuoteUpdateFields({ engineeringTaskId: null }, { ...QUOTE, engineeringTaskId: 47 })).toEqual({
      EngineeringTaskId: null,
    });
    expect(buildQuoteUpdateFields({ leadTimes: [] }, QUOTE)).toEqual({});
    expect(
      buildQuoteUpdateFields({ leadTimes: [{ partNumber: "P", description: "", leadTime: "", reason: "" }] }, QUOTE),
    ).toEqual({ LeadTimes: '[{"partNumber":"P","description":"","leadTime":"","reason":""}]' });
    expect(buildQuoteUpdateFields({ customerReference: " RFQ " }, QUOTE)).toEqual({ CustomerReference: "RFQ" });
  });

  it("frozen keys can't travel", () => {
    const sneaky = { quoteNumber: "IQ-HACK-9999-R1", rev: 9 } as unknown as Parameters<typeof buildQuoteUpdateFields>[0];
    expect(buildQuoteUpdateFields(sneaky, QUOTE)).toEqual({});
    expect(applyQuotePatch(QUOTE, sneaky).quoteNumber).toBe("IQ-COO-0001-R1");
  });
});

const ASSEMBLY: QuoteAssembly = {
  id: 1,
  quoteId: 1,
  lineNo: 1,
  quotedQty: 1,
  materialCost: 400,
  laborCost: null,
  materialOverheadPct: 18,
  altronicPartNumber: "791950-08",
  sapPartNumber: "",
  customerPartNumber: "",
  description: "",
  priceBreaks: [{ qty: 10, discountPct: 5, note: "" }],
  targetGM: 35,
  manualPrice: null,
  customerPrice: 100,
};

describe("assembly builders", () => {
  it("create writes QuoteRef as a bare integer", () => {
    const fields = buildQuoteAssemblyCreateFields({ ...ASSEMBLY, quoteId: 12 });
    expect(fields).toEqual({
      Title: "791950-08",
      QuoteRefLookupId: 12,
      LineNo: 1,
      QuotedQty: 1,
      Cost: 400,
      MaterialOverheadPct: 18,
      PriceBreaks: '[{"qty":10,"discountPct":5,"note":""}]',
      TargetGM: 35,
      CustomerPrice: 100,
    });
    expect(buildQuoteAssemblyCreateFields({ ...ASSEMBLY, quoteId: 12, targetGM: null })).not.toHaveProperty("TargetGM");
  });

  it("update diffs, comparing breaks by value", () => {
    expect(buildQuoteAssemblyUpdateFields({ priceBreaks: [{ qty: 10, discountPct: 5, note: "" }] }, ASSEMBLY)).toEqual({});
    expect(buildQuoteAssemblyUpdateFields({ priceBreaks: [], manualPrice: 90 }, ASSEMBLY)).toEqual({
      PriceBreaks: "",
      ManualPrice: 90,
    });
    expect(buildQuoteAssemblyUpdateFields({ targetGM: 35 }, ASSEMBLY)).toEqual({});
    expect(buildQuoteAssemblyUpdateFields({ targetGM: 42 }, ASSEMBLY)).toEqual({ TargetGM: 42 });
    expect(buildQuoteAssemblyUpdateFields({ targetGM: null }, ASSEMBLY)).toEqual({ TargetGM: null });
    expect(buildQuoteAssemblyUpdateFields({ quotedQty: 1 }, ASSEMBLY)).toEqual({});
    expect(buildQuoteAssemblyUpdateFields({ quotedQty: 25 }, ASSEMBLY)).toEqual({ QuotedQty: 25 });
    // Material is the Cost column; labor its own.
    expect(buildQuoteAssemblyUpdateFields({ materialCost: 410, laborCost: 30 }, ASSEMBLY)).toEqual({
      Cost: 410,
      LaborCost: 30,
    });
    expect(buildQuoteAssemblyUpdateFields({ laborCost: null }, ASSEMBLY)).toEqual({});
  });
});

describe("customer and role builders", () => {
  const CUSTOMER: QuoteCustomer = { id: 1, name: "Cooper", code: "COO", customerNumber: "001", active: true, note: "" };

  it("customer create upper-cases the code and always sends Active", () => {
    expect(
      buildQuoteCustomerCreateFields({ name: " Cooper ", code: "coo", customerNumber: "", note: "" }),
    ).toEqual({ Title: "Cooper", CustomerCode: "COO", Active: true });
  });

  it("customer update diffs, and can never send the code", () => {
    expect(buildQuoteCustomerUpdateFields({ name: "Cooper", active: true }, CUSTOMER)).toEqual({});
    expect(buildQuoteCustomerUpdateFields({ active: false }, CUSTOMER)).toEqual({ Active: false });
    const sneaky = { code: "XXX" } as unknown as Parameters<typeof buildQuoteCustomerUpdateFields>[0];
    expect(buildQuoteCustomerUpdateFields(sneaky, CUSTOMER)).toEqual({});
  });

  it("roles write PersonName, never DisplayName", () => {
    const fields = buildQuoteRoleCreateFields({ email: "Ray@X.com", displayName: "Ray", roles: ["manager"], note: "" });
    expect(fields).toEqual({ Title: "ray@x.com", Roles: "manager", PersonName: "Ray" });
    expect(buildQuoteRoleUpdateFields({ roles: ["viewer"] })).toEqual({ Roles: "viewer" });
    expect(buildQuoteRoleUpdateFields({ displayName: "R" })).toEqual({ PersonName: "R" });
  });
});

describe("misc", () => {
  it("compareQuotes: newest sequence, then newest rev", () => {
    const a = { ...QUOTE, id: 1, quoteBase: "IQ-COO-0001", rev: 1 };
    const b = { ...QUOTE, id: 2, quoteBase: "IQ-COO-0001", rev: 2 };
    const c = { ...QUOTE, id: 3, quoteBase: "IQ-WAB-0002", rev: 1 };
    expect([a, b, c].sort(compareQuotes).map((q) => q.id)).toEqual([3, 2, 1]);
  });

  it("isUniqueValueRejection recognises the duplicate wording, not an edit conflict", () => {
    expect(isUniqueValueRejection(mockUniqueRejection("Title", "IQ-COO-0001-R1"))).toBe(true);
    expect(isUniqueValueRejection({ status: 409, body: '{"error":{"code":"nameAlreadyExists"}}' })).toBe(true);
    expect(isUniqueValueRejection({ status: 409, body: '{"error":{"code":"resourceModified"}}' })).toBe(false);
    expect(isUniqueValueRejection(new Error("Graph 500"))).toBe(false);
  });
});
