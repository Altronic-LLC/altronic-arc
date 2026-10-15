import type { Comment, Person } from "@/types/task";
import type {
  CustomerQuote,
  NewProductWorksheet,
  PricingHistoryRecord,
  PricingRequest,
  PricingRoleEntry,
  SapCustomer,
  SapPart,
  SubAssembly,
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
  // DEMO (Ray, 2026-10-15): in SAP, but with NO material price group — the
  // manager types one on PR-2026-0006 to compare it against the CTL parts.
  { altronicPartNumber: "690150-1", sapPartNumber: "3002-0050-01", description: "DE-3000 BACKLIGHT KIT", mpg: "", listPrice: null, cost: 82 },
  // Components for New Product Pricing BOMs — in SAP with a cost, not sold.
  { altronicPartNumber: "601018", sapPartNumber: "5100-0018-00", description: "RESISTOR, 4K7, 1/4W", mpg: "CMP", listPrice: null, cost: 0.04 },
  { altronicPartNumber: "701230", sapPartNumber: "5200-0230-00", description: "IC, MICROCONTROLLER, 32-BIT", mpg: "CMP", listPrice: null, cost: 11.6 },
  { altronicPartNumber: "410022-1", sapPartNumber: "4100-0022-01", description: "ENCLOSURE, ALUMINIUM, CPU-95", mpg: "CMP", listPrice: null, cost: 186 },
];

/** Standard distributor discount per MPG. No CTL entry — SAP hasn't one, so 34% applies. */
/**
 * The Calculator's cost view (`rpt.vw_cogs_material_api`) has a row per PLANT.
 * Every mock part sits at plant 4222; this one is also stocked at 4211 at a
 * different cost, so the plant picker can be shown. 4230 sorts AFTER 4222, so
 * the demo part still brings in $120 first.
 */
export const MOCK_SAP_EXTRA_PLANT_COSTS: { sapPartNumber: string; plant: string; unitCost: number }[] = [
  { sapPartNumber: "2001-0310-15", plant: "4230", unitCost: 126.5 },
];

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
    leaveAsContactFactory: false,
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
  request({
    // DEMO: SAP holds the part but gave it no material price group, so there's
    // nothing to compare until a manager types one (e.g. CTL).
    id: 6,
    requestNumber: "PR-2026-0006",
    status: "Submitted",
    altronicPartNumber: "690150-1",
    sapPartNumber: "3002-0050-01",
    requestedDescription: "Backlight kit for the DE-3000",
    description: "DE-3000 BACKLIGHT KIT",
    mpg: "",
    requestedBy: KATIE,
    notes: "Retrofit for the older displays at the Midland yard.",
    customerSoldTo: "0008842",
    customerName: "Permian Field Services",
    customerGroup: "DI",
    watchers: [KATIE],
    createdBy: KATIE,
    createdAt: "2026-10-14T16:20:00Z",
    modifiedAt: "2026-10-14T16:20:00Z",
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
        leaveAsContactFactory: false,
        mpg: { key: "IGN", averageGM: 45.1, counted: 4 },
        family: { key: "791950", averageGM: 45.0, counted: 3 },
        note: "Kept list where it is — in line with the family.",
      },
    ],
    historyCorrupt: false,
  },
];

// -----------------------------------------------------------------------------
// New Product Pricing — worksheets, built from sub-assemblies
// -----------------------------------------------------------------------------

const SAVED_BY_BRANDON = { displayName: BRANDON.displayName, email: BRANDON.email ?? "" };
const SAVED_BY_RAY = { displayName: RAY.displayName, email: RAY.email ?? "" };

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
    overheadPct: 0, // overhead is per row now; history snapshots keep the 22% they were saved with
    mpg: "IGN",
    distributorDiscountPct: 36,
    discountSource: "SAP",
    targetGM: 45,
    unitCost: 817.24,
    listPrice: 2322,
    baseGM: 45.01,
    priceBreaks: [
      { minQty: 10, discountPct: 5 },
      { minQty: 50, discountPct: 10 },
    ],
    altronicPartNumber: "",
    sapPartNumber: "",
    comparisonParts: ["1003-0114-16", "1003-0114-18", "1003-0114-20"],
    history: [
      {
        rev: 1,
        savedAt: "2026-10-08T16:00:00Z",
        savedBy: SAVED_BY_BRANDON,
        note: "First costing from the engineering sub-assembly BOMs.",
        subAssemblies: [
          { name: "Main board", quantityPerProduct: 1, lineCount: 4, uploadedCost: 249.67, cost: 249.67 },
          { name: "Output coil set", quantityPerProduct: 1, lineCount: 2, uploadedCost: 242.8, cost: 242.8 },
          { name: "Enclosure", quantityPerProduct: 1, lineCount: 3, uploadedCost: 205.25, cost: 205.25 },
        ],
        overheadPct: 22,
        uploadedUnitCost: 851.22,
        unitCost: 851.22,
        mpg: "IGN",
        distributorDiscountPct: 36,
        discountSource: "SAP",
        input: { kind: "gm", value: 45 },
        listPrice: 2418,
        baseGM: 45.0,
        priceBreaks: [{ minQty: 10, discountPct: 5, price: 2297, baseGM: 42.1 }],
      },
      {
        rev: 2,
        savedAt: "2026-10-12T10:45:00Z",
        savedBy: SAVED_BY_RAY,
        note: "Bare board quoted lower ($185 vs $210) and a cheaper hardware kit; added a 50+ break.",
        subAssemblies: [
          {
            name: "Main board",
            quantityPerProduct: 1,
            overheadPct: 22,
            lineCount: 4,
            uploadedCost: 249.67,
            cost: 224.67,
            altronicPartNumber: "791990-24",
            // Sold on its own too (Ray, 2026-10-14): 224.67 × 1.22 = 274.10 at 45% / 36% → $779.
            sellingPrice: { distributorDiscountPct: 36, unitCost: 274.1, listPrice: 779, baseGM: 45.02, priceBreaks: [{ minQty: 10, discountPct: 5 }] },
          },
          { name: "Output coil set", quantityPerProduct: 1, lineCount: 2, uploadedCost: 242.8, cost: 242.8 },
          { name: "Enclosure", quantityPerProduct: 1, lineCount: 3, uploadedCost: 205.25, cost: 202.4 },
        ],
        overheadPct: 22,
        uploadedUnitCost: 851.22,
        unitCost: 817.24,
        mpg: "IGN",
        distributorDiscountPct: 36,
        discountSource: "SAP",
        input: { kind: "gm", value: 45 },
        listPrice: 2322,
        baseGM: 45.01,
        priceBreaks: [
          { minQty: 10, discountPct: 5, price: 2206, baseGM: 42.11 },
          { minQty: 50, discountPct: 10, price: 2090, baseGM: 38.9 },
        ],
      },
    ],
    historyCorrupt: false,
    comments: [comment("2026-10-12T10:50:00Z", RAY, "<p>R2 uses the lower board quote — Brandon, can you confirm the coil supplier's price holds at 60 a year?</p>")],
    watchers: [BRANDON, RAY],
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
    description: "Sealed remote display for wash-down skids. Early estimate — not priced yet.",
    customerSoldTo: "",
    customerName: "",
    expectedAnnualVolume: 120,
    requestId: null,
    overheadPct: 0,
    mpg: "",
    distributorDiscountPct: 34,
    discountSource: "Default",
    targetGM: null,
    unitCost: null,
    listPrice: null,
    baseGM: null,
    priceBreaks: [],
    altronicPartNumber: "",
    sapPartNumber: "",
    comparisonParts: ["3002-0040-01", "3002-0040-02", "3002-0044-01"],
    history: [],
    historyCorrupt: false,
    comments: [],
    watchers: [DEMO],
    hasAttachments: false,
    createdBy: DEMO,
    createdAt: "2026-10-13T08:00:00Z",
    modifiedAt: "2026-10-13T08:00:00Z",
  },
  {
    // DEMO: parts priced individually under one NP, each with its own breaks,
    // and no product price at all. The I/O expansion overrides the discount.
    // Figures are what rowSellingPrice gives (cost × 1.10 overhead):
    //   harness 15 ft: 132.00 at 55% / 34% → $444;  harness 40 ft: $640 typed;
    //   I/O expansion: $1,250 customer at 30% → $1,785.71.
    id: 3,
    worksheetNumber: "NP-2026-0003",
    status: "Active",
    rev: 1,
    productName: "CPU-95 harness and I/O kit — parts priced individually",
    description: "Prices the kit's harnesses and I/O expansion one by one for the Gulf Coast retrofit, each with its own quantity breaks.",
    customerSoldTo: "0007731",
    customerName: "Gulf Coast Compression",
    expectedAnnualVolume: 300,
    requestId: null,
    overheadPct: 0,
    mpg: "",
    distributorDiscountPct: 34,
    discountSource: "Default",
    targetGM: null,
    unitCost: 990,
    listPrice: null,
    baseGM: null,
    priceBreaks: [],
    altronicPartNumber: "",
    sapPartNumber: "",
    comparisonParts: ["2001-0310-15", "2001-0310-25", "2001-0310-40", "2001-0322-10", "3002-0044-01"],
    history: [
      {
        rev: 1,
        savedAt: "2026-10-14T15:00:00Z",
        savedBy: SAVED_BY_BRANDON,
        note: "",
        subAssemblies: [
          {
            name: "Harness, 15 ft",
            quantityPerProduct: 1,
            overheadPct: 10,
            lineCount: 1,
            uploadedCost: 120,
            cost: 120,
            altronicPartNumber: "593027-15",
            sapPartNumber: "2001-0310-15",
            sellingPrice: {
              distributorDiscountPct: 34,
              unitCost: 132,
              listPrice: 444,
              baseGM: 54.95,
              priceBreaks: [
                { minQty: 25, discountPct: 5 },
                { minQty: 50, discountPct: 10 },
              ],
            },
          },
          {
            name: "Harness, 40 ft",
            quantityPerProduct: 1,
            overheadPct: 10,
            lineCount: 1,
            uploadedCost: 170,
            cost: 170,
            altronicPartNumber: "593027-40",
            sapPartNumber: "2001-0310-40",
            sellingPrice: { distributorDiscountPct: 34, unitCost: 187, listPrice: 640, baseGM: 55.73, priceBreaks: [{ minQty: 25, discountPct: 5 }] },
          },
          {
            name: "I/O expansion",
            quantityPerProduct: 1,
            overheadPct: 10,
            lineCount: 1,
            uploadedCost: 610,
            cost: 610,
            altronicPartNumber: "690130-1",
            sapPartNumber: "3002-0044-01",
            sellingPrice: { distributorDiscountPct: 30, unitCost: 671, listPrice: 1785.71, baseGM: 46.32, priceBreaks: [] },
          },
        ],
        overheadPct: 0,
        uploadedUnitCost: 990,
        unitCost: 990,
        mpg: "",
        distributorDiscountPct: 34,
        discountSource: "Default",
        input: null,
        listPrice: null,
        baseGM: null,
        priceBreaks: [],
      },
    ],
    historyCorrupt: false,
    comments: [
      comment(
        "2026-10-14T15:05:00Z",
        BRANDON,
        "<p>Priced the three parts on their own for the retrofit. The I/O expansion is quoted at the 30% distributor rate it already sells at, not our standard 34%.</p>",
      ),
    ],
    watchers: [BRANDON, DEMO],
    hasAttachments: false,
    createdBy: BRANDON,
    createdAt: "2026-10-14T14:30:00Z",
    modifiedAt: "2026-10-14T15:00:00Z",
  },
];

const UPLOAD_R1 = { uploadedAt: "2026-10-08T15:40:00Z", uploadedBy: SAVED_BY_BRANDON };

const BOARD_LINES = [
  { partNumber: "701230", description: "IC, MICROCONTROLLER, 32-BIT", quantity: 2, uploadedCost: 11.6, adjustedCost: null },
  { partNumber: "601018", description: "RESISTOR, 4K7, 1/4W", quantity: 48, uploadedCost: 0.04, adjustedCost: null },
  { partNumber: "PCB-24-BARE", description: "BARE BOARD, 24 CYL MAIN", quantity: 1, uploadedCost: 210, adjustedCost: null },
  { partNumber: "CON-12P", description: "CONNECTOR, 12-PIN", quantity: 3, uploadedCost: 4.85, adjustedCost: null },
];
const COIL_LINES = [
  { partNumber: "COIL-24-OUT", description: "COIL, OUTPUT, 24 CYL", quantity: 12, uploadedCost: 18.4, adjustedCost: null },
  { partNumber: "BRKT-COIL", description: "BRACKET, COIL MOUNT", quantity: 1, uploadedCost: 22, adjustedCost: null },
];
const ENCLOSURE_LINES = [
  { partNumber: "410022-1", description: "ENCLOSURE, ALUMINIUM, CPU-95", quantity: 1, uploadedCost: 186, adjustedCost: null },
  { partNumber: "GSK-410", description: "GASKET, ENCLOSURE", quantity: 1, uploadedCost: 6.5, adjustedCost: null },
  { partNumber: "HW-KIT-95", description: "HARDWARE KIT", quantity: 1, uploadedCost: 12.75, adjustedCost: null },
];

function adjust<T extends { partNumber: string; adjustedCost: number | null }>(lines: T[], pn: string, cost: number): T[] {
  return lines.map((l) => (l.partNumber === pn ? { ...l, adjustedCost: cost } : l));
}

/** Rows of NP Sub-Assemblies — R1 and R2 of NP-2026-0001 (R1 is never rewritten), and R1 of NP-2026-0002. */
export const MOCK_SUB_ASSEMBLIES: SubAssembly[] = [
  { id: 1, worksheetId: 1, rev: 1, name: "Main board", kind: "subAssembly", altronicPartNumber: "791990-24", sapPartNumber: "", sortOrder: 1, quantityPerProduct: 1, overheadPct: 22, pricing: null, pricingCorrupt: false, lines: BOARD_LINES, linesCorrupt: false, fileName: "main-board-bom.csv", ...UPLOAD_R1 },
  { id: 2, worksheetId: 1, rev: 1, name: "Output coil set", kind: "subAssembly", altronicPartNumber: "", sapPartNumber: "", sortOrder: 2, quantityPerProduct: 1, overheadPct: 22, pricing: null, pricingCorrupt: false, lines: COIL_LINES, linesCorrupt: false, fileName: "coil-set-bom.csv", ...UPLOAD_R1 },
  { id: 3, worksheetId: 1, rev: 1, name: "Enclosure", kind: "subAssembly", altronicPartNumber: "", sapPartNumber: "", sortOrder: 3, quantityPerProduct: 1, overheadPct: 22, pricing: null, pricingCorrupt: false, lines: ENCLOSURE_LINES, linesCorrupt: false, fileName: "enclosure-bom.csv", ...UPLOAD_R1 },
  { id: 4, worksheetId: 1, rev: 2, name: "Main board", kind: "subAssembly", altronicPartNumber: "791990-24", sapPartNumber: "", sortOrder: 1, quantityPerProduct: 1, overheadPct: 22, pricing: { input: { kind: "gm", value: 45 }, distributorDiscountPct: null, priceBreaks: [{ minQty: 10, discountPct: 5 }] }, pricingCorrupt: false, lines: adjust(BOARD_LINES, "PCB-24-BARE", 185), linesCorrupt: false, fileName: "main-board-bom.csv", ...UPLOAD_R1 },
  { id: 5, worksheetId: 1, rev: 2, name: "Output coil set", kind: "subAssembly", altronicPartNumber: "", sapPartNumber: "", sortOrder: 2, quantityPerProduct: 1, overheadPct: 22, pricing: null, pricingCorrupt: false, lines: COIL_LINES, linesCorrupt: false, fileName: "coil-set-bom.csv", ...UPLOAD_R1 },
  { id: 6, worksheetId: 1, rev: 2, name: "Enclosure", kind: "subAssembly", altronicPartNumber: "", sapPartNumber: "", sortOrder: 3, quantityPerProduct: 1, overheadPct: 22, pricing: null, pricingCorrupt: false, lines: adjust(ENCLOSURE_LINES, "HW-KIT-95", 9.9), linesCorrupt: false, fileName: "enclosure-bom.csv", ...UPLOAD_R1 },
  {
    id: 7,
    worksheetId: 2,
    rev: 1,
    name: "Display assembly",
    kind: "subAssembly", altronicPartNumber: "", sapPartNumber: "",
    sortOrder: 1,
    quantityPerProduct: 1,
    overheadPct: 15,
    pricing: null,
    pricingCorrupt: false,
    lines: [
      { partNumber: "690100-1", description: "DE-3000 DISPLAY MODULE", quantity: 1, uploadedCost: 760, adjustedCost: null },
      { partNumber: "GSK-IP67", description: "IP67 GASKET KIT", quantity: 1, uploadedCost: 38, adjustedCost: null },
      { partNumber: "LENS-SEAL", description: "SEALED LENS", quantity: 1, uploadedCost: null, adjustedCost: null },
    ],
    linesCorrupt: false,
    fileName: "display-assy.csv",
    uploadedAt: "2026-10-13T08:05:00Z",
    uploadedBy: { displayName: DEMO.displayName, email: DEMO.email ?? "" },
  },
  {
    // A standalone part on the product, typed by hand — not a sub-assembly.
    id: 8,
    worksheetId: 2,
    rev: 1,
    name: "Mounting bracket kit",
    kind: "part", altronicPartNumber: "BRKT-KIT-SEAL", sapPartNumber: "",
    sortOrder: 2,
    quantityPerProduct: 1,
    overheadPct: 15,
    pricing: null,
    pricingCorrupt: false,
    lines: [{ partNumber: "BRKT-KIT-SEAL", description: "MOUNTING BRACKET KIT, STAINLESS", quantity: 1, uploadedCost: 24.5, adjustedCost: null, source: "manual" }],
    linesCorrupt: false,
    fileName: "",
    uploadedAt: null,
    uploadedBy: null,
  },
  ...[
    {
      id: 9,
      name: "Harness, 15 ft",
      altronicPartNumber: "593027-15",
      sapPartNumber: "2001-0310-15",
      description: "HARNESS, CPU-95, 15 FT",
      cost: 120,
      pricing: {
        input: { kind: "gm" as const, value: 55 },
        distributorDiscountPct: null,
        priceBreaks: [
          { minQty: 25, discountPct: 5 },
          { minQty: 50, discountPct: 10 },
        ],
      },
    },
    {
      id: 10,
      name: "Harness, 40 ft",
      altronicPartNumber: "593027-40",
      sapPartNumber: "2001-0310-40",
      description: "HARNESS, CPU-95, 40 FT",
      cost: 170,
      pricing: { input: { kind: "list" as const, value: 640 }, distributorDiscountPct: null, priceBreaks: [{ minQty: 25, discountPct: 5 }] },
    },
    {
      id: 11,
      name: "I/O expansion",
      altronicPartNumber: "690130-1",
      sapPartNumber: "3002-0044-01",
      description: "DE-3000 I/O EXPANSION",
      cost: 610,
      pricing: { input: { kind: "customer" as const, value: 1250 }, distributorDiscountPct: 30, priceBreaks: [] },
    },
  ].map(
    (p, i): SubAssembly => ({
      id: p.id,
      worksheetId: 3,
      rev: 1,
      name: p.name,
      kind: "part",
      altronicPartNumber: p.altronicPartNumber,
      sapPartNumber: p.sapPartNumber,
      sortOrder: i + 1,
      quantityPerProduct: 1,
      overheadPct: 10,
      pricing: p.pricing,
      pricingCorrupt: false,
      lines: [
        {
          partNumber: p.altronicPartNumber,
          sapPartNumber: p.sapPartNumber,
          description: p.description,
          quantity: 1,
          uploadedCost: p.cost,
          adjustedCost: null,
          source: "sap",
        },
      ],
      linesCorrupt: false,
      fileName: "",
      uploadedAt: null,
      uploadedBy: null,
    }),
  ),
];

// -----------------------------------------------------------------------------
// Customer Quotes
// -----------------------------------------------------------------------------

export const MOCK_CUSTOMER_QUOTES: CustomerQuote[] = [
  {
    id: 1,
    quoteNumber: "SQ-2026-0001-R1",
    quoteBase: "SQ-2026-0001",
    rev: 1,
    status: "Sent",
    validityDays: 30,
    customer: {
      soldTo: "0004410",
      name: "Power Solutions Supply",
      customerGroup: "DI",
      contactName: "Dana Ortiz",
      contactEmail: "dana.ortiz@example.com",
    },
    lines: [
      {
        // Priced from R1 — the worksheet has since moved to R2, so it offers an update.
        id: "q1-l1",
        kind: "worksheet",
        partNumber: "NP-2026-0001",
        description: "CPU-95 24-cylinder ignition module",
        quantity: 10,
        listPrice: 2418,
        customerDiscountPct: 34,
        unitPrice: 1595.88,
        breaks: [{ minQty: 10, price: 1516.02 }],
        worksheetId: 1,
        worksheetNumber: "NP-2026-0001",
        worksheetRev: 1,
      },
      {
        id: "q1-l2",
        kind: "sapPart",
        partNumber: "593027-25",
        description: "HARNESS, CPU-95, 25 FT",
        quantity: 10,
        listPrice: 480,
        customerDiscountPct: 34,
        unitPrice: 316.8,
        breaks: [],
        sapPartNumber: "2001-0310-25",
      },
      {
        id: "q1-l3",
        kind: "free",
        partNumber: "",
        description: "Freight, prepaid and added",
        quantity: 1,
        listPrice: null,
        customerDiscountPct: null,
        unitPrice: 85,
        breaks: [],
      },
    ],
    linesCorrupt: false,
    notes: "Prices are for the 24-cylinder module as specified in your RFQ of 7 October.",
    comments: [comment("2026-10-09T14:00:00Z", BRANDON, "<p>Sent to Dana today.</p>")],
    watchers: [BRANDON, DEMO],
    hasAttachments: false,
    createdBy: BRANDON,
    createdAt: "2026-10-09T13:30:00Z",
    modifiedAt: "2026-10-09T14:00:00Z",
  },
  {
    id: 2,
    quoteNumber: "SQ-2026-0002-R1",
    quoteBase: "SQ-2026-0002",
    rev: 1,
    status: "Draft",
    validityDays: 45,
    customer: { soldTo: "0001042", name: "Cooper Machinery Services", customerGroup: "OE", contactName: "", contactEmail: "" },
    lines: [
      {
        id: "q2-l1",
        kind: "request",
        partNumber: "791950-16",
        description: "CPU-95 IGNITION MODULE, 16 CYL",
        quantity: 40,
        listPrice: 4120,
        customerDiscountPct: 20,
        unitPrice: 3296,
        breaks: [],
        requestId: 1,
        requestNumber: "PR-2026-0001",
        sapPartNumber: "1003-0114-16",
      },
      {
        id: "q2-l2",
        kind: "worksheet",
        partNumber: "791990-24",
        description: "Main board",
        quantity: 12,
        listPrice: 779,
        customerDiscountPct: 36,
        unitPrice: 498.56,
        breaks: [{ minQty: 10, price: 473.6 }],
        worksheetId: 1,
        worksheetNumber: "NP-2026-0001",
        worksheetRev: 2,
        worksheetRow: "Main board",
        customerPartNumber: "CMS-BRD-24",
      },
    ],
    linesCorrupt: false,
    notes: "",
    comments: [],
    watchers: [DEMO],
    hasAttachments: false,
    createdBy: DEMO,
    createdAt: "2026-10-13T09:00:00Z",
    modifiedAt: "2026-10-13T09:00:00Z",
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
  subAssemblies: clone(MOCK_SUB_ASSEMBLIES),
  quotes: clone(MOCK_CUSTOMER_QUOTES),
  sapParts: clone(MOCK_SAP_PARTS),
};

/** Put every pricing store back to the samples. Tests call this in beforeEach. */
export function __resetPricingMockStores(): void {
  pricingMockDb.roles = clone(MOCK_PRICING_ROLES);
  pricingMockDb.requests = clone(MOCK_PRICING_REQUESTS);
  pricingMockDb.history = clone(MOCK_PRICING_HISTORY);
  pricingMockDb.worksheets = clone(MOCK_NEW_PRODUCT_WORKSHEETS);
  pricingMockDb.subAssemblies = clone(MOCK_SUB_ASSEMBLIES);
  pricingMockDb.quotes = clone(MOCK_CUSTOMER_QUOTES);
  pricingMockDb.sapParts = clone(MOCK_SAP_PARTS);
}

export function nextPricingMockId(rows: { id: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}

export const pricingMockClone = clone;
