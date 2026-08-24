import type { OpenOrderCustomerAccount, OpenOrderLine } from "@/types/task";

// =============================================================================
// Open Orders — sample data.
//
// Stands in for the SAP extract until the real one lands, and stays afterwards
// as the USE_MOCK fixture so the tool can be demoed and tested without a
// customer's real order book in the browser.
//
// It is deliberately AWKWARD, because a clean fixture proves nothing:
//
//   - lines past due, due this week, and months out, so every aging bucket
//     has something in it;
//   - a line with NO promise date (SAP genuinely leaves these blank);
//   - ZS1 repair lines, plus one repair that ISN'T ZS1 (order type ZRE), to
//     exercise the name-match safety net in isRepairLine;
//   - a sold-to padded with leading zeros ("0001042") against a list entry
//     without them, which is the join that quietly finds nothing if the
//     account match is naive;
//   - a customer name carrying characters Windows rejects in a filename
//     (`Bayou Gas & Compression, Inc. / Lafayette`);
//   - an account on the managed list with no open lines at all, which has to
//     be reported rather than skipped;
//   - a partially shipped line, so open qty ≠ order qty somewhere.
//
// Dates are relative to MOCK_RUN_DATE so the buckets stay meaningful without
// anyone editing this file every week.
// =============================================================================

/** The run date the fixtures are built around. */
export const MOCK_RUN_DATE = new Date("2026-08-24T12:00:00Z");

function day(offset: number): Date {
  const d = new Date(MOCK_RUN_DATE);
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

interface LineSeed {
  soldTo: string;
  customerName: string;
  salesOrder: string;
  lineNo: string;
  material: string;
  description: string;
  orderType?: string;
  orderQty: number;
  shippedQty?: number;
  unitPrice: number;
  promise: number | null;
  requested?: number | null;
  ordered?: number;
  customerPo?: string;
  plant?: string;
}

function line(seed: LineSeed): OpenOrderLine {
  const shippedQty = seed.shippedQty ?? 0;
  const openQty = seed.orderQty - shippedQty;
  return {
    soldTo: seed.soldTo,
    customerName: seed.customerName,
    salesOrder: seed.salesOrder,
    lineNo: seed.lineNo,
    material: seed.material,
    description: seed.description,
    orderType: seed.orderType ?? "ZOR",
    orderQty: seed.orderQty,
    shippedQty,
    openQty,
    unitPrice: seed.unitPrice,
    openValue: Math.round(openQty * seed.unitPrice * 100) / 100,
    currency: "USD",
    customerPo: seed.customerPo ?? "",
    orderDate: day(seed.ordered ?? -45),
    requestedDate: seed.requested === null ? null : day(seed.requested ?? seed.promise ?? -1),
    promiseDate: seed.promise === null ? null : day(seed.promise),
    plant: seed.plant ?? "1000",
    status: "Open",
  };
}

export const MOCK_OPEN_ORDER_LINES: OpenOrderLine[] = [
  // ---- 1042 Permian Midstream — the big account, spread across buckets -----
  line({
    soldTo: "0001042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500118820",
    lineNo: "000010",
    material: "1025-9975-00",
    description: "CPU-95 Ignition Module",
    orderQty: 12,
    unitPrice: 2865.5,
    promise: -34,
    ordered: -120,
    customerPo: "PO-88231",
  }),
  line({
    soldTo: "0001042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500118820",
    lineNo: "000020",
    material: "791-206-00",
    description: "Ignition Coil, 24V",
    orderQty: 48,
    shippedQty: 18,
    unitPrice: 214.75,
    promise: -12,
    ordered: -120,
    customerPo: "PO-88231",
  }),
  line({
    soldTo: "0001042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500119440",
    lineNo: "000010",
    material: "693101-1",
    description: "DE-3000 Annunciator Panel",
    orderQty: 3,
    unitPrice: 8940.0,
    promise: 9,
    customerPo: "PO-88410",
  }),
  line({
    soldTo: "0001042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500119440",
    lineNo: "000020",
    material: "701200-12",
    description: "Wiring Harness, 12 cyl",
    orderQty: 6,
    unitPrice: 1120.25,
    promise: 41,
    customerPo: "PO-88410",
  }),
  line({
    soldTo: "0001042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500120115",
    lineNo: "000010",
    material: "1025-9910-00",
    description: "CPU-XL Controller",
    orderQty: 2,
    unitPrice: 6410.0,
    promise: 74,
  }),
  line({
    soldTo: "0001042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500120990",
    lineNo: "000010",
    material: "357-4880",
    description: "Pyrometer Assembly",
    orderQty: 4,
    unitPrice: 1875.0,
    promise: 128,
  }),
  // ZS1 repair — the separate table on the customer tab.
  line({
    soldTo: "0001042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500121300",
    lineNo: "000010",
    material: "REP-CPU95",
    description: "CPU-95 module teardown and rebuild",
    orderType: "ZS1",
    orderQty: 2,
    unitPrice: 1450.0,
    promise: -6,
    customerPo: "PO-88622",
  }),
  // A repair that is NOT ZS1 — caught by the description match.
  line({
    soldTo: "0001042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500121301",
    lineNo: "000010",
    material: "REP-COIL",
    description: "Coil repair, return to service",
    orderType: "ZRE",
    orderQty: 10,
    unitPrice: 96.5,
    promise: 15,
  }),

  // ---- 2277 Bayou Gas — the filename-hostile name ------------------------
  line({
    soldTo: "2277",
    customerName: "Bayou Gas & Compression, Inc. / Lafayette",
    salesOrder: "4500119870",
    lineNo: "000010",
    material: "693111-2",
    description: "DE-2000 Display",
    orderQty: 5,
    unitPrice: 4210.0,
    promise: -3,
    customerPo: "BG-2026-0442",
  }),
  line({
    soldTo: "2277",
    customerName: "Bayou Gas & Compression, Inc. / Lafayette",
    salesOrder: "4500119870",
    lineNo: "000020",
    material: "791-206-00",
    description: "Ignition Coil, 24V",
    orderQty: 24,
    unitPrice: 214.75,
    promise: 22,
    customerPo: "BG-2026-0442",
  }),
  // No promise date at all — its own aging bucket.
  line({
    soldTo: "2277",
    customerName: "Bayou Gas & Compression, Inc. / Lafayette",
    salesOrder: "4500120440",
    lineNo: "000010",
    material: "343-4631",
    description: "Thermocouple, Type K",
    orderQty: 30,
    unitPrice: 88.0,
    promise: null,
    requested: 30,
  }),
  line({
    soldTo: "2277",
    customerName: "Bayou Gas & Compression, Inc. / Lafayette",
    salesOrder: "4500121055",
    lineNo: "000010",
    material: "REP-DE2000",
    description: "DE-2000 repair and recalibration",
    orderType: "ZS1",
    orderQty: 1,
    unitPrice: 2250.0,
    promise: 5,
  }),

  // ---- 3391 Cimarron Compression ----------------------------------------
  line({
    soldTo: "3391",
    customerName: "CIMARRON COMPRESSION LLC",
    salesOrder: "4500118115",
    lineNo: "000010",
    material: "1025-9975-00",
    description: "CPU-95 Ignition Module",
    orderQty: 8,
    unitPrice: 2865.5,
    promise: -96,
    ordered: -180,
    customerPo: "4501-CC",
  }),
  line({
    soldTo: "3391",
    customerName: "CIMARRON COMPRESSION LLC",
    salesOrder: "4500120660",
    lineNo: "000010",
    material: "701200-16",
    description: "Wiring Harness, 16 cyl",
    orderQty: 4,
    shippedQty: 1,
    unitPrice: 1480.0,
    promise: 33,
  }),
  line({
    soldTo: "3391",
    customerName: "CIMARRON COMPRESSION LLC",
    salesOrder: "4500121620",
    lineNo: "000010",
    material: "REP-HARNESS",
    description: "Harness repair, field return",
    orderType: "ZS1",
    orderQty: 3,
    unitPrice: 640.0,
    promise: 68,
  }),

  // ---- 4408 Great Lakes Field Services ----------------------------------
  line({
    soldTo: "4408",
    customerName: "GREAT LAKES FIELD SERVICES INC",
    salesOrder: "4500120880",
    lineNo: "000010",
    material: "693101-1",
    description: "DE-3000 Annunciator Panel",
    orderQty: 2,
    unitPrice: 8940.0,
    promise: 12,
  }),
  line({
    soldTo: "4408",
    customerName: "GREAT LAKES FIELD SERVICES INC",
    salesOrder: "4500120881",
    lineNo: "000010",
    material: "357-4880",
    description: "Pyrometer Assembly",
    orderQty: 6,
    unitPrice: 1875.0,
    promise: 96,
  }),

  // ---- 5560 Sabine River Gathering — NOT on the managed list -------------
  // Appears in the extract and on the master dashboard, but gets no
  // individual workbook. Proves the customer list gates the per-customer
  // files rather than the dashboard.
  line({
    soldTo: "5560",
    customerName: "SABINE RIVER GATHERING CO",
    salesOrder: "4500121770",
    lineNo: "000010",
    material: "791-206-00",
    description: "Ignition Coil, 24V",
    orderQty: 60,
    unitPrice: 214.75,
    promise: -18,
  }),
  line({
    soldTo: "5560",
    customerName: "SABINE RIVER GATHERING CO",
    salesOrder: "4500121770",
    lineNo: "000020",
    material: "343-4631",
    description: "Thermocouple, Type K",
    orderQty: 40,
    unitPrice: 88.0,
    promise: 27,
  }),
];

/**
 * The managed customer list — who gets an individual workbook each week.
 *
 * Note 1042 is stored WITHOUT the leading zeros the extract carries, and that
 * "Northern Basin" has no open lines at all. Both are the point.
 */
export const MOCK_OPEN_ORDER_ACCOUNTS: OpenOrderCustomerAccount[] = [
  {
    id: 1,
    accountNumber: "1042",
    customerName: "Permian Midstream Partners",
    regionalManager: "Paul McHenry",
    active: true,
    notes: "Weekly, Monday morning. Copy their expediter.",
  },
  {
    id: 2,
    accountNumber: "2277",
    customerName: "Bayou Gas & Compression, Inc. / Lafayette",
    regionalManager: "Neal Keeton",
    active: true,
    notes: "",
  },
  {
    id: 3,
    accountNumber: "3391",
    customerName: "Cimarron Compression",
    regionalManager: "Paul McHenry",
    active: true,
    notes: "Escalate anything past due over 90 days.",
  },
  {
    id: 4,
    accountNumber: "4408",
    customerName: "Great Lakes Field Services",
    regionalManager: "Jerrod Waldron",
    active: true,
    notes: "",
  },
  {
    id: 5,
    accountNumber: "6612",
    customerName: "Northern Basin Energy",
    regionalManager: "Jerrod Waldron",
    active: true,
    notes: "No open lines this week — reported as such.",
  },
  {
    id: 6,
    accountNumber: "7788",
    customerName: "Retired Account, Do Not Send",
    regionalManager: "",
    active: false,
    notes: "Inactive — kept for history, skipped by the weekly run.",
  },
];
