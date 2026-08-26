import type { Supplier, SupplierContact, SupplierIssue } from "@/types/task";

// =============================================================================
// Sample SRM data for mock mode — Suppliers List is the anchor; Contacts and
// Issues each reference a supplier by id, mirroring the real lists' lookup
// shape (scripts/suppliers-list-schema.json and siblings, captured live
// 2026-08-26).
// =============================================================================

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

export const MOCK_SUPPLIERS: Supplier[] = [
  {
    id: 25,
    title: "103832-Arrow Electronics",
    companyName: "Arrow Electronics",
    businessPartnerNumber: "103832",
    address: "6675 Parkland Blvd.  Solon, OH 44139",
    website: "https://www.arrow.com/",
    supplierScore: "5",
    coreCompetencies: ["Capacitors"],
    status: "Active",
    notes: "",
    assignedBuyer: { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com", lookupId: 21 },
    supplierIdentifier: "",
    watchers: [{ displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com", lookupId: 21 }],
    pointOfContactId: 1,
    allDeliveries: 616,
    supplierPerformanceRate: 97,
    logisticalPerformance: 93,
    qualityPerformance: 100,
    // Demonstrates the Logo round-trip in mock mode — MOCK_LOGO_ATTACHMENT
    // below seeds a matching reserved-attachment entry for this supplier.
    logo: { fileName: "Reserved_ImageAttachment_demo_arrow.png", originalImageName: "arrow-logo.png" },
    comments: [],
    hasAttachments: false,
    createdAt: daysAgo(370),
    modifiedAt: daysAgo(5),
  },
  {
    id: 29,
    title: "104054-TTI, Inc.",
    companyName: "TTI, Inc.",
    businessPartnerNumber: "104054",
    address: "6480 Rockside Woods Blvd., Suite Independence, OH 44131",
    website: "www.tti.com/",
    supplierScore: "20",
    coreCompetencies: ["Assembly", "Capacitors"],
    status: "Active",
    notes: "",
    assignedBuyer: null,
    supplierIdentifier: "",
    watchers: [],
    pointOfContactId: null,
    allDeliveries: 980,
    supplierPerformanceRate: 96,
    logisticalPerformance: 98,
    qualityPerformance: 95,
    logo: null,
    comments: [],
    hasAttachments: false,
    createdAt: daysAgo(360),
    modifiedAt: daysAgo(20),
  },
  {
    id: 30,
    title: "103836-Avnet Inc",
    companyName: "Avnet Inc",
    businessPartnerNumber: "103836",
    address: "30575 Bainbridge Road, Suite 28 Solon, OH 44139",
    website: "https://www.avnet.com/americas/",
    supplierScore: "10",
    coreCompetencies: [],
    status: "Phase Out",
    notes: "",
    assignedBuyer: null,
    supplierIdentifier: "",
    watchers: [],
    pointOfContactId: null,
    allDeliveries: 165,
    supplierPerformanceRate: 93,
    logisticalPerformance: 97,
    qualityPerformance: 90,
    logo: null,
    comments: [],
    hasAttachments: false,
    createdAt: daysAgo(350),
    modifiedAt: daysAgo(60),
  },
];

export const MOCK_SUPPLIER_CONTACTS: SupplierContact[] = [
  {
    id: 1,
    name: "",
    firstName: "",
    lastName: "",
    supplierId: 25,
    email: "josh.neal@carlton-bates.com",
    phone: "",
    status: "Active",
    contactNotes: "",
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdAt: daysAgo(300),
    modifiedAt: daysAgo(300),
  },
  {
    id: 2,
    name: "",
    firstName: "",
    lastName: "",
    supplierId: 29,
    email: "sales@aihfasteners.com",
    phone: "",
    status: "Active",
    contactNotes: "",
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdAt: daysAgo(280),
    modifiedAt: daysAgo(280),
  },
];

export const MOCK_SUPPLIER_ISSUES: SupplierIssue[] = [
  {
    id: 1,
    title: "Test",
    supplierId: 29,
    description: "Test item",
    status: "Choice 1",
    resolution: "",
    severity: "Choice 1",
    comments: [],
    watchers: [
      { displayName: "Chandana Ramisetty", email: "Chandana.Ramisetty@altronic-llc.com", lookupId: 64 },
    ],
    hasAttachments: false,
    createdAt: daysAgo(400),
    modifiedAt: daysAgo(370),
  },
];
