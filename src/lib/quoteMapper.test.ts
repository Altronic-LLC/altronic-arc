import { describe, expect, it } from "vitest";
import type { GraphListItem } from "@/types/task";
import type { Quote, QuoteAssembly, QuoteCustomer, QuoteItem } from "@/types/quote";
import {
  QUOTE_ASSEMBLY_SELECT,
  QUOTE_CUSTOMER_SELECT,
  QUOTE_ITEM_SELECT,
  QUOTE_ROLE_SELECT,
  QUOTE_SELECT,
  applyQuotePatch,
  buildQuoteAssemblyCreateFields,
  buildQuoteAssemblyUpdateFields,
  buildQuoteCreateFields,
  buildQuoteCustomerCreateFields,
  buildQuoteCustomerUpdateFields,
  buildQuoteItemCreateFields,
  buildQuoteItemUpdateFields,
  buildQuoteRoleCreateFields,
  buildQuoteRoleUpdateFields,
  buildQuoteUpdateFields,
  compareQuotes,
  isUniqueValueRejection,
  mockUniqueRejection,
  parsePriceBreaks,
  serializePriceBreaks,
  toQuote,
  toQuoteAssembly,
  toQuoteCustomer,
  toQuoteItem,
  toQuoteRoleEntry,
} from "./quoteMapper";
import { parseQuoteRoles, serializeQuoteRoles } from "./quoteRoles";

/** The exact column set from design section 13.1 — a `$select` outside it 400s the whole read. */
const CONTRACT = {
  quotes: [
    "Title", "QuoteBase", "Rev", "CustomerRef", "Status", "ValidityDays", "ContactName", "ContactEmail",
    "Budgetary", "BudgetaryText", "QuoteNotes", "Communication", "Watchers", "EngineeringTaskLink",
    "OperationsTaskLink", "EngineeringProjectRef",
  ],
  assemblies: [
    "Title", "QuoteRef", "LineNo", "QuotedQty", "LineType", "Cost", "MaterialOverheadPct", "SapPartNumber", "CustomerPartNumber", "Description", "PriceBreaks",
    "TargetGM", "ManualPrice", "CustomerPrice",
  ],
  items: [
    "Title", "QuoteRef", "AssemblyRef", "LineNo", "SapPartNumber", "Description",
    "Quantity", "Cost", "MaterialOverheadPct", "Communication", "Watchers",
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
  it("items", () => assertWithinContract(QUOTE_ITEM_SELECT, CONTRACT.items, ["QuoteRef", "AssemblyRef"]));
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
          EngineeringTaskLink: { Url: "https://arc/task/5", Description: "T5" },
          OperationsTaskLink: null,
          EngineeringProjectRef: "0042-NGI",
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
      engineeringTaskLink: { url: "https://arc/task/5", description: "T5" },
      operationsTaskLink: null,
      engineeringProjectRef: "0042-NGI",
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
    expect(toQuote(item({ CustomerRefLookupId: "" })).customerId).toBeNull();
  });
});

describe("toQuoteAssembly / toQuoteItem / toQuoteCustomer / toQuoteRoleEntry", () => {
  it("assembly", () => {
    const a = toQuoteAssembly(
      item({
        Title: "791950-08",
        QuoteRefLookupId: "12",
        LineNo: 2,
        QuotedQty: 30,
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
      lineType: "Assembly",
      cost: null,
      materialOverheadPct: null,
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

  it("assembly — LineType Part with its own cost; missing or unknown LineType reads Assembly", () => {
    const part = toQuoteAssembly(item({ Title: "SP", LineType: "Part", Cost: 38.4, MaterialOverheadPct: 10 }));
    expect(part).toMatchObject({ lineType: "Part", cost: 38.4, materialOverheadPct: 10 });
    expect(toQuoteAssembly(item({ Title: "A" })).lineType).toBe("Assembly");
    expect(toQuoteAssembly(item({ Title: "A", LineType: "Kit" })).lineType).toBe("Assembly");
    expect(toQuoteAssembly(item({ Title: "A", LineType: "part" })).lineType).toBe("Part");
    // The SAP # is read as stored — no reformatting of legacy values.
    expect(toQuoteAssembly(item({ Title: "A", SapPartNumber: "100245871" })).sapPartNumber).toBe("100245871");
  });

  it("item", () => {
    const i = toQuoteItem(
      item({
        Title: "R-681",
        QuoteRefLookupId: "12",
        AssemblyRefLookupId: "4",
        LineNo: 3,
        Quantity: 12,
        Cost: 0.1,
        MaterialOverheadPct: null,
        // A stray TargetGM on an item (an old list) is ignored — the margin is the assembly's.
        TargetGM: 60,
        Attachments: false,
      }),
    );
    expect(i).toMatchObject({
      quoteId: 12,
      assemblyId: 4,
      lineNo: 3,
      quantity: 12,
      cost: 0.1,
      materialOverheadPct: null,
      comments: [],
      watchers: [],
      hasAttachments: false,
    });
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
  comments: [],
  watchers: [],
  engineeringTaskLink: null,
  operationsTaskLink: null,
  engineeringProjectRef: "",
  hasAttachments: false,
  createdBy: null,
  createdAt: null,
  modifiedAt: null,
};

describe("quote field builders", () => {
  it("create: bare-integer lookup, two-key Watchers, NO hyperlink columns", () => {
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
  lineType: "Assembly",
  quotedQty: 1,
  cost: null,
  materialOverheadPct: null,
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
      LineType: "Assembly",
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
    // Part → Assembly clears the line's own cost in the same write.
    const part = { ...ASSEMBLY, lineType: "Part" as const, cost: 12, materialOverheadPct: 5 };
    expect(
      buildQuoteAssemblyUpdateFields({ lineType: "Assembly", cost: null, materialOverheadPct: null }, part),
    ).toEqual({ LineType: "Assembly", Cost: null, MaterialOverheadPct: null });
  });
});

const ITEM: QuoteItem = {
  id: 1,
  quoteId: 1,
  assemblyId: 2,
  lineNo: 1,
  altronicPartNumber: "R-1",
  sapPartNumber: "",
  description: "",
  quantity: 1,
  cost: 10,
  materialOverheadPct: null,
  comments: [],
  watchers: [],
  hasAttachments: false,
};

describe("item builders", () => {
  it("create writes both lookups as bare integers", () => {
    const fields = buildQuoteItemCreateFields(
      { ...ITEM, quoteId: 12, assemblyId: 4 },
      [{ displayName: "A", lookupId: 5 }],
    );
    expect(fields).toMatchObject({ QuoteRefLookupId: 12, AssemblyRefLookupId: 4, WatchersLookupId: [5] });
    expect(fields).not.toHaveProperty("MaterialOverheadPct");
    expect(fields).not.toHaveProperty("TargetGM");
    // A component has no customer part number — and the read never asks for one.
    expect(fields).not.toHaveProperty("CustomerPartNumber");
    expect(QUOTE_ITEM_SELECT.split(",")).not.toContain("CustomerPartNumber");
  });

  it("update diffs; a moved assembly is a bare integer", () => {
    expect(buildQuoteItemUpdateFields({ cost: 10 }, ITEM)).toEqual({});
    expect(buildQuoteItemUpdateFields({ cost: null, assemblyId: 9 }, ITEM)).toEqual({
      Cost: null,
      AssemblyRefLookupId: 9,
    });
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
