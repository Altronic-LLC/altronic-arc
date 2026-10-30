import type { Comment, Person } from "@/types/task";
import {
  DEFAULT_BUDGETARY_TEXT,
  type Quote,
  type QuoteAssembly,
  type QuoteCustomer,
  type QuoteRoleEntry,
} from "@/types/quote";

// =============================================================================
// Insourcing Quotes — mock-mode sample data, AND the mutable in-memory store
// every quote API module's mock branch reads and writes.
//
// The store lives here rather than one per API module because a new rev
// (api/quoteRevisions.ts) reads and writes the quote lists at once, and one
// `__resetQuoteMockStores()` puts all four back — module-level mock stores
// leak between tests otherwise (the feature-request lesson in CLAUDE.md).
//
// The demo user (`demo.user@altronic-llc.com`, what useCurrentUser returns in
// mock mode) is a `manager`, so every screen can be walked in a demo.
// =============================================================================

const DEMO: Person = { displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 1 };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 122 };
const KATIE: Person = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 97 };
const BRANDON: Person = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com", lookupId: 215 };
const AMANDA: Person = { displayName: "Amanda Hoagland", email: "amanda.hoagland@altronic-llc.com", lookupId: 156 };

function at(iso: string): Date {
  return new Date(iso);
}

function comment(iso: string, who: Person, bodyHtml: string): Comment {
  return { timestamp: at(iso), authorName: who.displayName, authorEmail: who.email ?? "", bodyHtml };
}

// -----------------------------------------------------------------------------
// Customers
// -----------------------------------------------------------------------------

export const MOCK_QUOTE_CUSTOMERS: QuoteCustomer[] = [
  {
    id: 1,
    name: "Cooper Machinery Services",
    code: "COO",
    customerNumber: "0001042",
    active: true,
    note: "Net 45. Quote harness lengths in feet. Copy the plant buyer on every quote.",
  },
  {
    id: 2,
    name: "Wabtec Transportation Systems",
    code: "WAB",
    customerNumber: "0002210",
    active: true,
    note: "Quotes go to the Erie buyer group.",
  },
  { id: 3, name: "INNIO Waukesha", code: "INN", customerNumber: "0000877", active: true, note: "" },
  {
    id: 4,
    name: "Hoerbiger Service Inc.",
    code: "HOE",
    customerNumber: "0003150",
    active: false,
    note: "Retired — merged into Cooper Machinery Services.",
  },
];

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

export const MOCK_QUOTE_ROLES: QuoteRoleEntry[] = [
  {
    id: 1,
    email: "demo.user@altronic-llc.com",
    displayName: "Demo User",
    roles: ["manager"],
    note: "Mock-mode default user — manager, so the whole tool can be walked in a demo",
  },
  { id: 2, email: "katie.fleming@altronic-llc.com", displayName: "Katie Fleming", roles: ["quoter"], note: "Sales" },
  { id: 3, email: "brandon.mirto@altronic-llc.com", displayName: "Brandon Mirto", roles: ["viewer"], note: "Engineering" },
];

// -----------------------------------------------------------------------------
// Quotes — one base at R1 and R2 (IQ-COO-0001), a Sent, a Won, a budgetary Draft.
// -----------------------------------------------------------------------------

function quote(partial: Partial<Quote> & Pick<Quote, "id" | "quoteNumber" | "quoteBase" | "rev">): Quote {
  return {
    customerId: null,
    status: "Draft",
    validityDays: 30,
    contactName: "",
    contactEmail: "",
    budgetary: false,
    budgetaryText: "",
    quoteNotes: "",
    customerReference: "",
    alternates: [],
    alternatesCorrupt: false,
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
    ...partial,
  };
}

export const MOCK_QUOTES: Quote[] = [
  quote({
    id: 1,
    quoteNumber: "IQ-COO-0001-R1",
    quoteBase: "IQ-COO-0001",
    rev: 1,
    customerId: 1,
    status: "Sent",
    contactName: "Mark Balent",
    contactEmail: "mark.balent@example.com",
    customerReference: "RFQ 4471 — CPU-95 retrofit kits",
    quoteNotes: "Prices FOB Girard, OH. Lead time 6–8 weeks ARO.",
    comments: [
      comment("2026-09-18T15:20:00Z", RAY, "<p>Sent to Mark. He wants the 50-off price before Friday.</p>"),
      comment("2026-09-17T13:05:00Z", KATIE, "<p>Costing is in — please check the harness labour.</p>"),
    ],
    watchers: [DEMO, KATIE, RAY],
    createdBy: KATIE,
    createdAt: "2026-09-17T12:00:00Z",
    modifiedAt: "2026-09-18T15:20:00Z",
  }),
  quote({
    id: 2,
    quoteNumber: "IQ-COO-0001-R2",
    quoteBase: "IQ-COO-0001",
    rev: 2,
    customerId: 1,
    status: "Draft",
    contactName: "Mark Balent",
    contactEmail: "mark.balent@example.com",
    customerReference: "RFQ 4471 — CPU-95 retrofit kits",
    quoteNotes: "Prices FOB Girard, OH. Lead time 6–8 weeks ARO.",
    alternates: [
      {
        designator: "J3",
        sources: [
          { manufacturer: "TE Connectivity", partNumber: "1-1437290-3", leadTime: "22 weeks" },
          { manufacturer: "Amphenol", partNumber: "MS3106A-20-27S", leadTime: "3 weeks" },
          { manufacturer: "", partNumber: "", leadTime: "" },
        ],
        reason: "Amphenol connector is form-fit equivalent and ships in 3 weeks instead of 22.",
      },
      {
        designator: "C14",
        sources: [
          { manufacturer: "Murata", partNumber: "GRM31CR71H475KA12L", leadTime: "16 weeks" },
          { manufacturer: "KEMET", partNumber: "C1206C475K5RACTU", leadTime: "6 weeks" },
          { manufacturer: "Samsung", partNumber: "CL31B475KBHNNNE", leadTime: "Stock" },
        ],
        reason: "",
      },
    ],
    comments: [
      comment("2026-10-02T14:00:00Z", DEMO, "<p>R2 — customer asked for a 100-off break.</p>"),
      comment(
        "2026-09-18T15:20:00Z",
        RAY,
        "<p>Sent to Mark. He wants the 50-off price before Friday.</p><p><em>— carried over from R1</em></p>",
      ),
      comment(
        "2026-09-17T13:05:00Z",
        KATIE,
        "<p>Costing is in — please check the harness labour.</p><p><em>— carried over from R1</em></p>",
      ),
    ],
    watchers: [DEMO, KATIE, RAY],
    hasAttachments: true,
    createdBy: DEMO,
    createdAt: "2026-10-02T13:55:00Z",
    modifiedAt: "2026-10-02T14:00:00Z",
  }),
  quote({
    id: 3,
    quoteNumber: "IQ-WAB-0002-R1",
    quoteBase: "IQ-WAB-0002",
    rev: 1,
    customerId: 2,
    status: "Won",
    validityDays: 45,
    contactName: "Dana Kowalski",
    contactEmail: "dana.kowalski@example.com",
    watchers: [KATIE, AMANDA],
    createdBy: KATIE,
    createdAt: "2026-08-04T12:00:00Z",
    modifiedAt: "2026-08-29T12:00:00Z",
  }),
  quote({
    id: 4,
    quoteNumber: "IQ-INN-0003-R1",
    quoteBase: "IQ-INN-0003",
    rev: 1,
    customerId: 3,
    status: "Draft",
    contactName: "Luis Ortega",
    contactEmail: "luis.ortega@example.com",
    budgetary: true,
    budgetaryText: DEFAULT_BUDGETARY_TEXT,
    quoteNotes: "New product — pricing will firm up after the first article.",
    customerReference: "NGI-2000 controller — budgetary",
    engineeringProjectRef: "0042-NGI-2000",
    engineeringTaskId: 47,
    watchers: [DEMO, BRANDON],
    createdBy: DEMO,
    createdAt: "2026-10-06T12:00:00Z",
    modifiedAt: "2026-10-06T12:00:00Z",
  }),
];

// -----------------------------------------------------------------------------
// Quote lines — each carries its FINAL material, labor and overhead and ONE
// target GM; breaks on some, one manual price. `customerPrice` is what
// lib/quotePricing.ts computes: (material × (1 + overhead%) + labor) ÷ (1 − GM).
// -----------------------------------------------------------------------------

function line(
  partial: Partial<QuoteAssembly> & Pick<QuoteAssembly, "id" | "quoteId" | "lineNo" | "altronicPartNumber">,
): QuoteAssembly {
  return {
    quotedQty: 1,
    materialCost: null,
    laborCost: null,
    materialOverheadPct: 18,
    sapPartNumber: "",
    customerPartNumber: "",
    description: "",
    priceBreaks: [],
    targetGM: null,
    manualPrice: null,
    customerPrice: null,
    ...partial,
  };
}

export const MOCK_QUOTE_ASSEMBLIES: QuoteAssembly[] = [
  // IQ-COO-0001-R1. 520 × 1.18 + 85 = 698.60 at 40% → 1,164.33.
  line({
    id: 1,
    quoteId: 1,
    lineNo: 1,
    quotedQty: 3,
    materialCost: 520,
    laborCost: 85,
    altronicPartNumber: "791950-08",
    sapPartNumber: "1002-4587-10",
    customerPartNumber: "CMS-IGN-0808",
    description: "CPU-95 ignition module, 8 cyl, with harness",
    priceBreaks: [
      { qty: 10, discountPct: 5, note: "" },
      { qty: 50, discountPct: 10, note: "Annual blanket" },
    ],
    targetGM: 40,
    customerPrice: 1164.33,
  }),
  // 54 × 1.18 + 12 = 75.72 at 35% → 116.49.
  line({
    id: 2,
    quoteId: 1,
    lineNo: 2,
    quotedQty: 30,
    materialCost: 54,
    laborCost: 12,
    altronicPartNumber: "693005-1",
    sapPartNumber: "1001-9833-20",
    description: "Primary harness, 16 ft",
    targetGM: 35,
    customerPrice: 116.49,
  }),
  // IQ-COO-0001-R2 — the rev's own copies
  line({
    id: 3,
    quoteId: 2,
    lineNo: 1,
    quotedQty: 30,
    materialCost: 520,
    laborCost: 85,
    altronicPartNumber: "791950-08",
    sapPartNumber: "1002-4587-10",
    customerPartNumber: "CMS-IGN-0808",
    description: "CPU-95 ignition module, 8 cyl, with harness",
    priceBreaks: [
      { qty: 10, discountPct: 5, note: "" },
      { qty: 50, discountPct: 10, note: "Annual blanket" },
      { qty: 100, discountPct: 14, note: "" },
    ],
    targetGM: 40,
    customerPrice: 1164.33,
  }),
  line({
    id: 4,
    quoteId: 2,
    lineNo: 2,
    materialCost: 54,
    laborCost: 12,
    altronicPartNumber: "693005-1",
    sapPartNumber: "1001-9833-20",
    description: "Primary harness, 16 ft",
    targetGM: 35,
    manualPrice: 115,
    customerPrice: 115,
  }),
  // IQ-WAB-0002-R1. 41 × 1.18 + 9.50 = 57.88 at 40% → 96.47.
  line({
    id: 5,
    quoteId: 3,
    lineNo: 1,
    quotedQty: 25,
    materialCost: 41,
    laborCost: 9.5,
    altronicPartNumber: "610225-2",
    sapPartNumber: "1003-0114-40",
    customerPartNumber: "WTS-55102",
    description: "Pickup sensor assembly, magnetic, 2 in",
    priceBreaks: [{ qty: 25, discountPct: 8, note: "" }],
    targetGM: 40,
    customerPrice: 96.47,
  }),
  // A bought-in part with no labor and a 10% overhead: 38.40 × 1.10 = 42.24
  // at 45% → 76.80.
  line({
    id: 7,
    quoteId: 3,
    lineNo: 2,
    materialCost: 38.4,
    materialOverheadPct: 10,
    altronicPartNumber: "610225-ELEM",
    sapPartNumber: "1003-0114-60",
    customerPartNumber: "WTS-55102-SP",
    description: "Spare magnetic pickup element",
    priceBreaks: [{ qty: 10, discountPct: 5, note: "" }],
    targetGM: 45,
    customerPrice: 76.8,
  }),
  // IQ-INN-0003-R1 — budgetary, new product. 1,520 × 1.18 + 310 = 2,103.60
  // at 35% → 3,236.31.
  line({
    id: 6,
    quoteId: 4,
    lineNo: 1,
    materialCost: 1520,
    laborCost: 310,
    altronicPartNumber: "NGI-2000-PROTO",
    customerPartNumber: "IW-77821",
    description: "NGI-2000 controller, prototype build",
    targetGM: 35,
    customerPrice: 3236.31,
  }),
  // Quoted at 250 pieces, which lands in the 250–499 break.
  // 395 × 1.18 + 68 = 534.10 at 32% → 785.44.
  line({
    id: 8,
    quoteId: 4,
    lineNo: 2,
    quotedQty: 250,
    materialCost: 395,
    laborCost: 68,
    altronicPartNumber: "1026-6521-00",
    sapPartNumber: "1026-6521-00",
    customerPartNumber: "INN-HUB-V4",
    description: "HUB V4 control assembly, no SAT — complete with harness and enclosure",
    priceBreaks: [
      { qty: 250, discountPct: 5, note: "" },
      { qty: 500, discountPct: 10, note: "" },
    ],
    targetGM: 32,
    customerPrice: 785.44,
  }),
];

// -----------------------------------------------------------------------------
// The mutable store — the mock branches read and write THIS, never the seeds.
// -----------------------------------------------------------------------------

function cloneQuote(q: Quote): Quote {
  return {
    ...q,
    comments: q.comments.map((c) => ({ ...c })),
    watchers: q.watchers.map((p) => ({ ...p })),
    alternates: q.alternates.map((r) => ({ designator: r.designator, sources: r.sources.map((x) => ({ ...x })), reason: r.reason })),
    createdBy: q.createdBy ? { ...q.createdBy } : null,
  };
}

function cloneAssembly(a: QuoteAssembly): QuoteAssembly {
  return { ...a, priceBreaks: a.priceBreaks.map((b) => ({ ...b })) };
}

function cloneCustomer(c: QuoteCustomer): QuoteCustomer {
  return { ...c };
}

function cloneRole(r: QuoteRoleEntry): QuoteRoleEntry {
  return { ...r, roles: [...r.roles] };
}

/** Deep copies, so a caller can never mutate the store through what it was handed. */
export const quoteMockClone = {
  quote: cloneQuote,
  assembly: cloneAssembly,
  customer: cloneCustomer,
  role: cloneRole,
};

export interface QuoteMockDb {
  quotes: Quote[];
  assemblies: QuoteAssembly[];
  customers: QuoteCustomer[];
  roles: QuoteRoleEntry[];
}

/** The live mock store. Mutated in place by the API modules' mock branches. */
export const quoteMockDb: QuoteMockDb = {
  quotes: [],
  assemblies: [],
  customers: [],
  roles: [],
};

/** Put all four quote mock stores back to the seed rows. Call in a test's `beforeEach`. */
export function __resetQuoteMockStores(): void {
  quoteMockDb.quotes = MOCK_QUOTES.map(cloneQuote);
  quoteMockDb.assemblies = MOCK_QUOTE_ASSEMBLIES.map(cloneAssembly);
  quoteMockDb.customers = MOCK_QUOTE_CUSTOMERS.map(cloneCustomer);
  quoteMockDb.roles = MOCK_QUOTE_ROLES.map(cloneRole);
}

__resetQuoteMockStores();

/** Next free id in one of the mock tables. */
export function nextMockId(rows: readonly { id: number }[]): number {
  return Math.max(0, ...rows.map((r) => r.id)) + 1;
}
