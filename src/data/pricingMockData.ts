import type { Comment, Person } from "@/types/task";
import type {
  NewProductWorksheet,
  PricingHistoryRecord,
  PricingRequest,
  PricingRoleEntry,
  SapCustomer,
  SapPart,
} from "@/types/pricing";

// =============================================================================
// Sales Pricing — mock-mode sample data, AND the mutable in-memory store every
// pricing API module's mock branch reads and writes. One store, one reset
// (`__resetPricingMockStores`), because module-level mock stores leak between
// tests otherwise (the feature-request lesson).
//
// The SAP half (`MOCK_SAP_*`) stands in for the Fabric warehouse until its
// tables are known: a part catalogue across three material price groups, the
// per-MPG distributor discounts (CTL deliberately has none, so the 34% default
// shows), customers in three customer groups, and their group discounts.
//
// The demo user is a pricing ADMIN, so every screen can be walked.
// =============================================================================

const DEMO: Person = { displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 1 };
const KATIE: Person = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 97 };
const BRANDON: Person = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com", lookupId: 215 };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 122 };

function comment(iso: string, who: Person, bodyHtml: string): Comment {
  return { timestamp: new Date(iso), authorName: who.displayName, authorEmail: who.email ?? "", bodyHtml };
}

// -----------------------------------------------------------------------------
// The SAP warehouse stand-in
// -----------------------------------------------------------------------------

export const MOCK_SAP_PARTS: SapPart[] = [
  // IGN — ignition modules. The 791950 family spans every cylinder count.
  { altronicPartNumber: "791950-08", sapPartNumber: "1003-0114-08", description: "CPU-95 IGNITION MODULE, 8 CYL", mpg: "IGN", listPrice: 3450, cost: 1180 },
  { altronicPartNumber: "791950-16", sapPartNumber: "1003-0114-16", description: "CPU-95 IGNITION MODULE, 16 CYL", mpg: "IGN", listPrice: 4120, cost: 1410 },
  { altronicPartNumber: "791950-18", sapPartNumber: "1003-0114-18", description: "CPU-95 IGNITION MODULE, 18 CYL", mpg: "IGN", listPrice: 4380, cost: 1495 },
  { altronicPartNumber: "791950-20", sapPartNumber: "1003-0114-20", description: "CPU-95 IGNITION MODULE, 20 CYL", mpg: "IGN", listPrice: 4650, cost: 1610 },
  { altronicPartNumber: "791962-18", sapPartNumber: "1003-0116-18", description: "CPU-95 VARISPARK, 18 CYL", mpg: "IGN", listPrice: 4900, cost: 1720 },
  // SAP holds no cost for this one, and no price for the next — both are left
  // out of the averages, and say so.
  { altronicPartNumber: "791952-18", sapPartNumber: "1003-0115-18", description: "CPU-95C IGNITION MODULE, 18 CYL", mpg: "IGN", listPrice: 4410, cost: null },
  { altronicPartNumber: "791956-16", sapPartNumber: "1003-0117-16", description: "CPU-95 EVS, 16 CYL", mpg: "IGN", listPrice: null, cost: 1530 },
  // HRN — harnesses.
  { altronicPartNumber: "593027-15", sapPartNumber: "2001-0310-15", description: "HARNESS, CPU-95, 15 FT", mpg: "HRN", listPrice: 410, cost: 120 },
  { altronicPartNumber: "593027-25", sapPartNumber: "2001-0310-25", description: "HARNESS, CPU-95, 25 FT", mpg: "HRN", listPrice: 480, cost: 142 },
  { altronicPartNumber: "593027-40", sapPartNumber: "2001-0310-40", description: "HARNESS, CPU-95, 40 FT", mpg: "HRN", listPrice: 560, cost: 170 },
  { altronicPartNumber: "593050-10", sapPartNumber: "2001-0322-10", description: "HARNESS, DE-3000 I/O, 10 FT", mpg: "HRN", listPrice: 320, cost: 98 },
  // CTL — controls. SAP has no distributor discount for CTL (the 34% default).
  { altronicPartNumber: "690100-1", sapPartNumber: "3002-0040-01", description: "DE-3000 DISPLAY MODULE", mpg: "CTL", listPrice: 2200, cost: 760 },
  { altronicPartNumber: "690100-2", sapPartNumber: "3002-0040-02", description: "DE-3000 DISPLAY MODULE, EXTENDED TEMP", mpg: "CTL", listPrice: 2350, cost: 805 },
  { altronicPartNumber: "690130-1", sapPartNumber: "3002-0044-01", description: "DE-3000 I/O EXPANSION", mpg: "CTL", listPrice: 1850, cost: 610 },
  // Components for New Product Pricing BOMs — in SAP with a cost, not sold.
  { altronicPartNumber: "601018", sapPartNumber: "5100-0018-00", description: "RESISTOR, 4K7, 1/4W", mpg: "CMP", listPrice: null, cost: 0.04 },
  { altronicPartNumber: "701230", sapPartNumber: "5200-0230-00", description: "IC, MICROCONTROLLER, 32-BIT", mpg: "CMP", listPrice: null, cost: 11.6 },
  { altronicPartNumber: "410022-1", sapPartNumber: "4100-0022-01", description: "ENCLOSURE, ALUMINIUM, CPU-95", mpg: "CMP", listPrice: null, cost: 186 },
];

/** Standard distributor discount per MPG. No CTL entry — SAP hasn't one, so 34% applies. */
export const MOCK_SAP_MPG_DISCOUNTS: Record<string, number> = { IGN: 36, HRN: 30 };

export const MOCK_SAP_CUSTOMERS: SapCustomer[] = [
  { soldTo: "0001042", name: "Cooper Machinery Services", customerGroup: "OE" },
  { soldTo: "0002210", name: "Wabtec Transportation Systems", customerGroup: "OE" },
  { soldTo: "0000877", name: "INNIO Waukesha", customerGroup: "OE" },
  { soldTo: "0004410", name: "Power Solutions Supply", customerGroup: "DI" },
  { soldTo: "0005120", name: "Gulf Coast Compression", customerGroup: "DI" },
  { soldTo: "0006001", name: "Altronic Europe GmbH", customerGroup: "IC" },
];

/** Customer group → MPG → discount %. A missing pair means SAP has no discount for it. */
export const MOCK_SAP_GROUP_DISCOUNTS: Record<string, Record<string, number>> = {
  DI: { IGN: 34, HRN: 34, CTL: 34 },
  OE: { IGN: 20, HRN: 15, CTL: 18 },
  IC: { IGN: 45, HRN: 40 },
};

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

export const MOCK_PRICING_ROLES: PricingRoleEntry[] = [
  {
    id: 1,
    email: "demo.user@altronic-llc.com",
    displayName: "Demo User",
    roles: ["admin"],
    note: "Mock-mode default user — admin, so every screen can be walked in a demo",
  },
  { id: 2, email: "katie.fleming@altronic-llc.com", displayName: "Katie Fleming", roles: ["requester"], note: "Sales" },
  { id: 3, email: "brandon.mirto@altronic-llc.com", displayName: "Brandon Mirto", roles: ["manager"], note: "Pricing" },
];

// -----------------------------------------------------------------------------
// Requests — one at every status
// -----------------------------------------------------------------------------

function request(r: Partial<PricingRequest> & Pick<PricingRequest, "id" | "requestNumber" | "status">): PricingRequest {
  return {
    altronicPartNumber: "",
    sapPartNumber: "",
    requestedDescription: "",
    description: "",
    mpg: "",
    requestedBy: null,
    notes: "",
    customerSoldTo: "",
    customerName: "",
    customerGroup: "",
    listPrice: null,
    customerDiscountPct: null,
    customerPrice: null,
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
    ...r,
  };
}

export const MOCK_PRICING_REQUESTS: PricingRequest[] = [
  request({
    id: 1,
    requestNumber: "PR-2026-0001",
    status: "Priced",
    altronicPartNumber: "791950-16",
    sapPartNumber: "1003-0114-16",
    requestedDescription: "CPU-95 16 cyl module",
    description: "CPU-95 IGNITION MODULE, 16 CYL",
    mpg: "IGN",
    requestedBy: KATIE,
    notes: "Cooper wants to standardise on the 16-cylinder unit across their Gulf fleet — 40 a year.",
    customerSoldTo: "0001042",
    customerName: "Cooper Machinery Services",
    customerGroup: "OE",
    listPrice: 4120,
    customerDiscountPct: 20,
    customerPrice: 3296,
    pricedBy: BRANDON,
    pricedAt: "2026-10-06T15:20:00Z",
    comments: [
      comment("2026-10-06T15:22:00Z", BRANDON, "<p>Kept list where it is — 44.4% base GM, in line with the family.</p>"),
      comment("2026-10-05T13:10:00Z", KATIE, "<p>Customer is asking for this week if we can.</p>"),
    ],
    watchers: [KATIE, BRANDON],
    createdBy: KATIE,
    createdAt: "2026-10-05T13:02:00Z",
    modifiedAt: "2026-10-06T15:22:00Z",
  }),
  request({
    id: 2,
    requestNumber: "PR-2026-0002",
    status: "In Review",
    altronicPartNumber: "593027-25",
    sapPartNumber: "2001-0310-25",
    requestedDescription: "25 ft harness",
    description: "HARNESS, CPU-95, 25 FT",
    mpg: "HRN",
    requestedBy: KATIE,
    notes: "Replacement harnesses for an existing install.",
    customerSoldTo: "0005120",
    customerName: "Gulf Coast Compression",
    customerGroup: "DI",
    watchers: [KATIE],
    createdBy: KATIE,
    createdAt: "2026-10-09T09:40:00Z",
    modifiedAt: "2026-10-10T08:15:00Z",
  }),
  request({
    id: 3,
    requestNumber: "PR-2026-0003",
    status: "Submitted",
    altronicPartNumber: "690100-2",
    sapPartNumber: "3002-0040-02",
    requestedDescription: "DE-3000 display, extended temperature",
    description: "DE-3000 DISPLAY MODULE, EXTENDED TEMP",
    mpg: "CTL",
    requestedBy: DEMO,
    notes: "Contact Factory on the price list. Arctic site — needs the extended temperature version.",
    customerSoldTo: "0000877",
    customerName: "INNIO Waukesha",
    customerGroup: "OE",
    watchers: [DEMO],
    createdBy: DEMO,
    createdAt: "2026-10-12T14:05:00Z",
    modifiedAt: "2026-10-12T14:05:00Z",
  }),
  request({
    id: 4,
    requestNumber: "PR-2026-0004",
    status: "Awaiting SAP",
    altronicPartNumber: "791950-24",
    requestedDescription: "CPU-95 24 cylinder module (new variant)",
    description: "CPU-95 24 cylinder module (new variant)",
    requestedBy: KATIE,
    notes: "Engineering has the drawing; SAP doesn't have the part yet.",
    customerSoldTo: "0004410",
    customerName: "Power Solutions Supply",
    customerGroup: "DI",
    watchers: [KATIE],
    createdBy: KATIE,
    createdAt: "2026-10-13T10:30:00Z",
    modifiedAt: "2026-10-13T10:30:00Z",
  }),
  request({
    id: 5,
    requestNumber: "PR-2026-0005",
    status: "Cancelled",
    altronicPartNumber: "690130-1",
    sapPartNumber: "3002-0044-01",
    requestedDescription: "I/O expansion",
    description: "DE-3000 I/O EXPANSION",
    mpg: "CTL",
    requestedBy: KATIE,
    customerSoldTo: "0002210",
    customerName: "Wabtec Transportation Systems",
    customerGroup: "OE",
    cancelReason: "Customer bought the standard kit off the price list instead.",
    watchers: [KATIE],
    createdBy: KATIE,
    createdAt: "2026-10-01T11:00:00Z",
    modifiedAt: "2026-10-02T09:00:00Z",
  }),
];

export const MOCK_PRICING_HISTORY: PricingHistoryRecord[] = [
  {
    id: 1,
    requestNumber: "PR-2026-0001",
    requestId: 1,
    cost: 1410,
    costSource: "SAP",
    distributorDiscountPct: 36,
    discountSource: "SAP",
    targetGM: null,
    listPrice: 4120,
    baseGM: 46.53,
    customerGM: 57.22,
    mpg: "IGN",
    mpgAvgGM: 45.1,
    mpgCount: 4,
    familyPrefix: "791950",
    familyAvgGM: 45.0,
    familyCount: 3,
    pricingNote: "Kept list where it is — in line with the family.",
    history: [
      {
        pricedAt: "2026-10-06T15:20:00Z",
        pricedBy: { displayName: BRANDON.displayName, email: BRANDON.email ?? "" },
        cost: 1410,
        costSource: "SAP",
        distributorDiscountPct: 36,
        discountSource: "SAP",
        input: { kind: "list", value: 4120 },
        listPrice: 4120,
        baseGM: 46.53,
        customerGroup: "OE",
        customerDiscountPct: 20,
        customerPrice: 3296,
        customerGM: 57.22,
        mpg: { key: "IGN", averageGM: 45.1, counted: 4 },
        family: { key: "791950", averageGM: 45.0, counted: 3 },
        note: "Kept list where it is — in line with the family.",
      },
    ],
    historyCorrupt: false,
  },
];

// -----------------------------------------------------------------------------
// New Product Pricing
// -----------------------------------------------------------------------------

const BOM_R2 = [
  { id: "l1", partNumber: "410022-1", description: "ENCLOSURE, ALUMINIUM, CPU-95", quantity: 1, unitCost: 186, costSource: "SAP" as const },
  { id: "l2", partNumber: "701230", description: "IC, MICROCONTROLLER, 32-BIT", quantity: 2, unitCost: 11.6, costSource: "SAP" as const },
  { id: "l3", partNumber: "601018", description: "RESISTOR, 4K7, 1/4W", quantity: 48, unitCost: 0.04, costSource: "SAP" as const },
  { id: "l4", partNumber: "NEW-PCB-24", description: "MAIN BOARD, 24 CYL (prototype quote)", quantity: 1, unitCost: 640, costSource: "Estimate" as const },
  { id: "l5", partNumber: "NEW-COIL-24", description: "OUTPUT TRANSFORMER SET (supplier estimate)", quantity: 1, unitCost: 410, costSource: "Estimate" as const },
];

export const MOCK_NEW_PRODUCT_WORKSHEETS: NewProductWorksheet[] = [
  {
    id: 1,
    worksheetNumber: "NP-2026-0001",
    status: "Active",
    rev: 2,
    productName: "CPU-95 24-cylinder ignition module",
    description: "A 24-cylinder variant of the CPU-95 for the large-bore market. Not in SAP yet.",
    customerSoldTo: "0004410",
    customerName: "Power Solutions Supply",
    expectedAnnualVolume: 60,
    requestId: 4,
    bom: BOM_R2,
    overheadPct: 22,
    mpg: "IGN",
    distributorDiscountPct: 36,
    discountSource: "SAP",
    targetGM: 45,
    unitCost: 1520.55,
    listPrice: 4319,
    baseGM: 45.0,
    priceBreaks: [
      { minQty: 10, discountPct: 5 },
      { minQty: 50, discountPct: 10 },
    ],
    altronicPartNumber: "",
    sapPartNumber: "",
    history: [
      {
        rev: 1,
        savedAt: "2026-10-08T16:00:00Z",
        savedBy: { displayName: BRANDON.displayName, email: BRANDON.email ?? "" },
        note: "First costing from the engineering BOM.",
        bom: BOM_R2.map((l) => (l.id === "l4" ? { ...l, unitCost: 720 } : l)),
        overheadPct: 22,
        unitCost: 1618.15,
        mpg: "IGN",
        distributorDiscountPct: 36,
        discountSource: "SAP",
        input: { kind: "gm", value: 45 },
        listPrice: 4597,
        baseGM: 45.0,
        priceBreaks: [{ minQty: 10, discountPct: 5, price: 4367, baseGM: 42.1 }],
      },
      {
        rev: 2,
        savedAt: "2026-10-12T10:45:00Z",
        savedBy: { displayName: RAY.displayName, email: RAY.email ?? "" },
        note: "Board quote came in lower ($640 vs $720); added a 50+ break.",
        bom: BOM_R2,
        overheadPct: 22,
        unitCost: 1520.55,
        mpg: "IGN",
        distributorDiscountPct: 36,
        discountSource: "SAP",
        input: { kind: "gm", value: 45 },
        listPrice: 4319,
        baseGM: 45.0,
        priceBreaks: [
          { minQty: 10, discountPct: 5, price: 4103, baseGM: 42.1 },
          { minQty: 50, discountPct: 10, price: 3887, baseGM: 38.9 },
        ],
      },
    ],
    historyCorrupt: false,
    hasAttachments: false,
    createdBy: BRANDON,
    createdAt: "2026-10-08T15:30:00Z",
    modifiedAt: "2026-10-12T10:45:00Z",
  },
  {
    id: 2,
    worksheetNumber: "NP-2026-0002",
    status: "Active",
    rev: 1,
    productName: "DE-3000 remote display, sealed",
    description: "Sealed remote display for wash-down skids. Early estimate.",
    customerSoldTo: "",
    customerName: "",
    expectedAnnualVolume: 120,
    requestId: null,
    bom: [
      { id: "l1", partNumber: "690100-1", description: "DE-3000 DISPLAY MODULE", quantity: 1, unitCost: 760, costSource: "SAP" },
      { id: "l2", partNumber: "NEW-GASKET-IP67", description: "IP67 GASKET KIT (estimate)", quantity: 1, unitCost: 38, costSource: "Estimate" },
    ],
    overheadPct: 15,
    mpg: "",
    distributorDiscountPct: 34,
    discountSource: "Default",
    targetGM: null,
    unitCost: 917.7,
    listPrice: null,
    baseGM: null,
    priceBreaks: [],
    altronicPartNumber: "",
    sapPartNumber: "",
    history: [],
    historyCorrupt: false,
    hasAttachments: false,
    createdBy: DEMO,
    createdAt: "2026-10-13T08:00:00Z",
    modifiedAt: "2026-10-13T08:00:00Z",
  },
];

// -----------------------------------------------------------------------------
// The mutable store
// -----------------------------------------------------------------------------

/** A deep copy that keeps Dates (comment timestamps) as Dates. */
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out as T;
  }
  return value;
}

export const pricingMockDb = {
  roles: clone(MOCK_PRICING_ROLES),
  requests: clone(MOCK_PRICING_REQUESTS),
  history: clone(MOCK_PRICING_HISTORY),
  worksheets: clone(MOCK_NEW_PRODUCT_WORKSHEETS),
  sapParts: clone(MOCK_SAP_PARTS),
};

/** Put every pricing store back to the samples. Tests call this in beforeEach. */
export function __resetPricingMockStores(): void {
  pricingMockDb.roles = clone(MOCK_PRICING_ROLES);
  pricingMockDb.requests = clone(MOCK_PRICING_REQUESTS);
  pricingMockDb.history = clone(MOCK_PRICING_HISTORY);
  pricingMockDb.worksheets = clone(MOCK_NEW_PRODUCT_WORKSHEETS);
  pricingMockDb.sapParts = clone(MOCK_SAP_PARTS);
}

export function nextPricingMockId(rows: { id: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}

export const pricingMockClone = clone;
