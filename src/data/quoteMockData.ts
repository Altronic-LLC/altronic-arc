import type { Comment, Person } from "@/types/task";
import {
  DEFAULT_BUDGETARY_TEXT,
  type Quote,
  type QuoteAssembly,
  type QuoteCustomer,
  type QuoteItem,
  type QuoteRoleEntry,
} from "@/types/quote";

// =============================================================================
// Insourcing Quotes — mock-mode sample data, AND the mutable in-memory store
// every quote API module's mock branch reads and writes.
//
// The store lives here rather than one per API module because a new rev
// (api/quoteRevisions.ts) reads and writes all three quote lists at once, and
// one `__resetQuoteMockStores()` puts all five back — module-level mock stores
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
  { id: 1, name: "Cooper Machinery Services", code: "COO", customerNumber: "0001042", active: true, note: "" },
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
    comments: [],
    watchers: [],
    engineeringTaskLink: null,
    operationsTaskLink: null,
    engineeringProjectRef: "",
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
    quoteNotes: "Prices FOB Girard, OH. Lead time 6–8 weeks ARO.",
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
    engineeringProjectRef: "0042-NGI-2000",
    watchers: [DEMO, BRANDON],
    createdBy: DEMO,
    createdAt: "2026-10-06T12:00:00Z",
    modifiedAt: "2026-10-06T12:00:00Z",
  }),
];

// -----------------------------------------------------------------------------
// Quote lines — final assemblies and one standalone Part. Each carries its ONE
// target GM; breaks on some, one manual price.
// customerPrice is what lib/quotePricing.ts computes from the components below.
// -----------------------------------------------------------------------------

export const MOCK_QUOTE_ASSEMBLIES: QuoteAssembly[] = [
  // IQ-COO-0001-R1
  {
    id: 1,
    quoteId: 1,
    lineNo: 1,
    quotedQty: 3,
    lineType: "Assembly",
    cost: null,
    materialOverheadPct: null,
    altronicPartNumber: "791950-08",
    sapPartNumber: "1002-4587-10",
    customerPartNumber: "CMS-IGN-0808",
    description: "CPU-95 ignition module, 8 cyl, with harness",
    priceBreaks: [
      { qty: 10, discountPct: 5, note: "" },
      { qty: 50, discountPct: 10, note: "Annual blanket" },
    ],
    targetGM: 40,
    manualPrice: null,
    customerPrice: 1070.26,
  },
  {
    id: 2,
    quoteId: 1,
    lineNo: 2,
    quotedQty: 30,
    lineType: "Assembly",
    cost: null,
    materialOverheadPct: null,
    altronicPartNumber: "693005-1",
    sapPartNumber: "1001-9833-20",
    customerPartNumber: "",
    description: "Primary harness, 16 ft",
    priceBreaks: [],
    targetGM: 35,
    manualPrice: null,
    customerPrice: 118,
  },
  // IQ-COO-0001-R2 — the rev's own copies
  {
    id: 3,
    quoteId: 2,
    lineNo: 1,
    quotedQty: 30,
    lineType: "Assembly",
    cost: null,
    materialOverheadPct: null,
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
    manualPrice: null,
    customerPrice: 1070.26,
  },
  {
    id: 4,
    quoteId: 2,
    lineNo: 2,
    quotedQty: 1,
    lineType: "Assembly",
    cost: null,
    materialOverheadPct: null,
    altronicPartNumber: "693005-1",
    sapPartNumber: "1001-9833-20",
    customerPartNumber: "",
    description: "Primary harness, 16 ft",
    priceBreaks: [],
    targetGM: 35,
    manualPrice: 115,
    customerPrice: 115,
  },
  // IQ-WAB-0002-R1
  {
    id: 5,
    quoteId: 3,
    lineNo: 1,
    quotedQty: 25,
    lineType: "Assembly",
    cost: null,
    materialOverheadPct: null,
    altronicPartNumber: "610225-2",
    sapPartNumber: "1003-0114-40",
    customerPartNumber: "WTS-55102",
    description: "Pickup sensor assembly, magnetic, 2 in",
    priceBreaks: [{ qty: 25, discountPct: 8, note: "" }],
    targetGM: 40,
    manualPrice: null,
    customerPrice: 95.33,
  },
  // A standalone PART on the same quote — costed on the line, no components.
  // 38.40 + 10% overhead = 42.24 loaded; at 45% GM → 76.80.
  {
    id: 7,
    quoteId: 3,
    lineNo: 2,
    quotedQty: 1,
    lineType: "Part",
    cost: 38.4,
    materialOverheadPct: 10,
    altronicPartNumber: "610225-ELEM",
    sapPartNumber: "1003-0114-60",
    customerPartNumber: "WTS-55102-SP",
    description: "Spare magnetic pickup element",
    priceBreaks: [{ qty: 10, discountPct: 5, note: "" }],
    targetGM: 45,
    manualPrice: null,
    customerPrice: 76.8,
  },
  // IQ-INN-0003-R1 — budgetary, new product
  {
    id: 6,
    quoteId: 4,
    lineNo: 1,
    quotedQty: 1,
    lineType: "Assembly",
    cost: null,
    materialOverheadPct: null,
    altronicPartNumber: "NGI-2000-PROTO",
    sapPartNumber: "",
    customerPartNumber: "IW-77821",
    description: "NGI-2000 controller, prototype build",
    priceBreaks: [],
    targetGM: 35,
    manualPrice: null,
    customerPrice: 3086.15,
  },
  // A realistic final assembly with FIFTEEN components (Ray asked for an
  // example, 2026-10-09): one 32% GM prices the lot; quoted at 250 pieces,
  // which lands in the 250–499 break.
  {
    id: 8,
    quoteId: 4,
    lineNo: 2,
    quotedQty: 250,
    lineType: "Assembly",
    cost: null,
    materialOverheadPct: null,
    altronicPartNumber: "1026-6521-00",
    sapPartNumber: "1026-6521-00",
    customerPartNumber: "INN-HUB-V4",
    description: "HUB V4 control assembly, no SAT — complete with harness and enclosure",
    priceBreaks: [
      { qty: 250, discountPct: 5, note: "" },
      { qty: 500, discountPct: 10, note: "" },
    ],
    targetGM: 32,
    manualPrice: null,
    customerPrice: 726.92,
  },
];

// -----------------------------------------------------------------------------
// Items (components)
// -----------------------------------------------------------------------------

function item(partial: Partial<QuoteItem> & Pick<QuoteItem, "id" | "quoteId" | "assemblyId" | "lineNo" | "altronicPartNumber">): QuoteItem {
  return {
    sapPartNumber: "",
    description: "",
    quantity: 1,
    cost: null,
    materialOverheadPct: null,
    comments: [],
    watchers: [],
    hasAttachments: false,
    ...partial,
  };
}

/** The CPU-95 assembly's component set, reused on R1 and R2 with fresh ids. */
function cpu95Components(firstId: number, quoteId: number, assemblyId: number, carried: boolean): QuoteItem[] {
  const tag = carried ? "<p><em>— carried over from R1</em></p>" : "";
  return [
    item({
      id: firstId,
      quoteId,
      assemblyId,
      lineNo: 1,
      altronicPartNumber: "791950-PCB",
      sapPartNumber: "1002-4590-10",
      description: "CPU-95 main board, populated",
      cost: 412.35,
      materialOverheadPct: 8,
      comments: [comment("2026-09-17T14:10:00Z", BRANDON, `<p>Board cost from the Sept build lot.</p>${tag}`)],
      watchers: [BRANDON],
    }),
    item({
      id: firstId + 1,
      quoteId,
      assemblyId,
      lineNo: 2,
      altronicPartNumber: "791950-ENC",
      sapPartNumber: "1002-4590-20",
      description: "Aluminium enclosure, machined",
      cost: 88.1,
    }),
    item({
      id: firstId + 2,
      quoteId,
      assemblyId,
      lineNo: 3,
      altronicPartNumber: "R-681-0.25W",
      description: "Resistor, 681R 1/4W",
      quantity: 12,
      cost: 0.1,
    }),
    item({
      id: firstId + 3,
      quoteId,
      assemblyId,
      lineNo: 4,
      altronicPartNumber: "LAB-ASSY-08",
      description: "Assembly and test labour, 1.6 h",
      cost: 96,
      materialOverheadPct: 12,
    }),
  ];
}

export const MOCK_QUOTE_ITEMS: QuoteItem[] = [
  ...cpu95Components(1, 1, 1, false),
  item({
    id: 5,
    quoteId: 1,
    assemblyId: 2,
    lineNo: 1,
    altronicPartNumber: "693005-WIRE",
    description: "18 AWG wire, 16 ft, 4 cond",
    cost: 31.2,
  }),
  item({
    id: 6,
    quoteId: 1,
    assemblyId: 2,
    lineNo: 2,
    altronicPartNumber: "693005-CONN",
    description: "MS connector set",
    quantity: 2,
    cost: 22.75,
    comments: [comment("2026-09-17T16:00:00Z", AMANDA, "<p>Connector lead time is 4 weeks right now.</p>")],
    watchers: [AMANDA],
  }),
  ...cpu95Components(7, 2, 3, true),
  item({
    id: 11,
    quoteId: 2,
    assemblyId: 4,
    lineNo: 1,
    altronicPartNumber: "693005-WIRE",
    description: "18 AWG wire, 16 ft, 4 cond",
    cost: 31.2,
  }),
  item({
    id: 12,
    quoteId: 2,
    assemblyId: 4,
    lineNo: 2,
    altronicPartNumber: "693005-CONN",
    description: "MS connector set",
    quantity: 2,
    cost: 22.75,
    hasAttachments: true,
  }),
  item({
    id: 13,
    quoteId: 3,
    assemblyId: 5,
    lineNo: 1,
    altronicPartNumber: "610225-SENSOR",
    description: "Magnetic pickup element",
    cost: 38.4,
  }),
  item({
    id: 14,
    quoteId: 3,
    assemblyId: 5,
    lineNo: 2,
    altronicPartNumber: "610225-HSG",
    description: "Stainless housing, 2 in",
    cost: 17.9,
    materialOverheadPct: 5,
  }),
  item({
    id: 15,
    quoteId: 4,
    assemblyId: 6,
    lineNo: 1,
    altronicPartNumber: "NGI-2000-PCB",
    description: "Controller board, prototype quantity",
    cost: 1320,
    comments: [comment("2026-10-06T15:30:00Z", BRANDON, "<p>Prototype pricing — expect 20% lower at volume.</p>")],
    watchers: [BRANDON, DEMO],
  }),
  item({
    id: 16,
    quoteId: 4,
    assemblyId: 6,
    lineNo: 2,
    altronicPartNumber: "NGI-2000-HMI",
    description: "Touch display module",
    cost: 410,
  }),
  item({
    id: 17,
    quoteId: 4,
    assemblyId: 6,
    lineNo: 3,
    altronicPartNumber: "LAB-PROTO",
    description: "Prototype assembly labour, 4 h",
    cost: 240,
    materialOverheadPct: 15,
  }),
  // The HUB V4 assembly's fifteen components (assembly 8).
  item({
    id: 18,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 1,
    altronicPartNumber: "1026-1001-00",
    description: "Main controller PCB, populated",
    materialOverheadPct: 3,
    cost: 212.4,
  }),
  item({
    id: 19,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 2,
    altronicPartNumber: "1026-1002-00",
    description: "Display board, 4.3 in TFT",
    materialOverheadPct: 3,
    cost: 64.75,
  }),
  item({
    id: 20,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 3,
    altronicPartNumber: "1026-1003-00",
    description: "Power supply module, 24 VDC",
    cost: 41.2,
  }),
  item({
    id: 21,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 4,
    altronicPartNumber: "1026-1004-00",
    description: "Enclosure, die-cast aluminium",
    materialOverheadPct: 5,
    cost: 38.9,
  }),
  item({
    id: 22,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 5,
    altronicPartNumber: "1026-1005-00",
    description: "Gasket, enclosure lid",
    cost: 2.15,
  }),
  item({
    id: 23,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 6,
    altronicPartNumber: "1026-1006-00",
    description: "Main wiring harness",
    materialOverheadPct: 8,
    cost: 27.6,
  }),
  item({
    id: 24,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 7,
    altronicPartNumber: "1026-1007-00",
    description: "Sensor harness, 2 m",
    quantity: 2,
    materialOverheadPct: 8,
    cost: 9.85,
  }),
  item({
    id: 25,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 8,
    altronicPartNumber: "1026-1008-00",
    description: "Connector, 12-pin circular",
    quantity: 4,
    cost: 6.4,
  }),
  item({
    id: 26,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 9,
    altronicPartNumber: "1026-1009-00",
    description: "Terminal block, 10-way",
    quantity: 2,
    cost: 3.75,
  }),
  item({
    id: 27,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 10,
    altronicPartNumber: "1026-1010-00",
    description: "Mounting bracket, stainless",
    quantity: 2,
    materialOverheadPct: 5,
    cost: 4.2,
  }),
  item({
    id: 28,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 11,
    altronicPartNumber: "1026-1011-00",
    description: "Screw, M4 x 10 SS",
    quantity: 12,
    cost: 0.0825,
  }),
  item({
    id: 29,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 12,
    altronicPartNumber: "1026-1012-00",
    description: "Cable gland, M20",
    quantity: 3,
    cost: 1.9,
  }),
  item({
    id: 30,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 13,
    altronicPartNumber: "1026-1013-00",
    description: "Label set, nameplate + warnings",
    cost: 1.35,
  }),
  item({
    id: 31,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 14,
    altronicPartNumber: "1026-1014-00",
    description: "Firmware load + test",
    cost: 18.0,
  }),
  item({
    id: 32,
    quoteId: 4,
    assemblyId: 8,
    lineNo: 15,
    altronicPartNumber: "1026-1015-00",
    description: "Packaging, foam insert + carton",
    cost: 5.6,
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
    engineeringTaskLink: q.engineeringTaskLink ? { ...q.engineeringTaskLink } : null,
    operationsTaskLink: q.operationsTaskLink ? { ...q.operationsTaskLink } : null,
    createdBy: q.createdBy ? { ...q.createdBy } : null,
  };
}

function cloneAssembly(a: QuoteAssembly): QuoteAssembly {
  return { ...a, priceBreaks: a.priceBreaks.map((b) => ({ ...b })) };
}

function cloneItem(i: QuoteItem): QuoteItem {
  return { ...i, comments: i.comments.map((c) => ({ ...c })), watchers: i.watchers.map((p) => ({ ...p })) };
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
  item: cloneItem,
  customer: cloneCustomer,
  role: cloneRole,
};

export interface QuoteMockDb {
  quotes: Quote[];
  assemblies: QuoteAssembly[];
  items: QuoteItem[];
  customers: QuoteCustomer[];
  roles: QuoteRoleEntry[];
}

/** The live mock store. Mutated in place by the API modules' mock branches. */
export const quoteMockDb: QuoteMockDb = {
  quotes: [],
  assemblies: [],
  items: [],
  customers: [],
  roles: [],
};

/** Put all five quote mock stores back to the seed rows. Call in a test's `beforeEach`. */
export function __resetQuoteMockStores(): void {
  quoteMockDb.quotes = MOCK_QUOTES.map(cloneQuote);
  quoteMockDb.assemblies = MOCK_QUOTE_ASSEMBLIES.map(cloneAssembly);
  quoteMockDb.items = MOCK_QUOTE_ITEMS.map(cloneItem);
  quoteMockDb.customers = MOCK_QUOTE_CUSTOMERS.map(cloneCustomer);
  quoteMockDb.roles = MOCK_QUOTE_ROLES.map(cloneRole);
}

__resetQuoteMockStores();

/** Next free id in one of the mock tables. */
export function nextMockId(rows: readonly { id: number }[]): number {
  return Math.max(0, ...rows.map((r) => r.id)) + 1;
}
