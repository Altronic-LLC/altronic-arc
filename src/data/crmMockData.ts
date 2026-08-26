import type {
  CapacityEntry,
  CustomerContact,
  CustomerNote,
  SpecialPricingEntry,
} from "@/types/task";

// =============================================================================
// Sample CRM data for mock mode — Customer Notes is the anchor; Contacts,
// Special Pricing and Capacity each reference one of these customers by id,
// mirroring the real lists' lookup shape (scripts/customer-notes-schema.json
// and siblings, captured live 2026-08-26).
// =============================================================================

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

export const MOCK_CUSTOMER_NOTES: CustomerNote[] = [
  {
    id: 1,
    customerName: "7 Compression",
    oldCustomerNumber: "1007",
    sapCustomerNumber: "105060",
    generalNotes: "<p>Enter by customer P/N.</p>",
    complianceNotes: "<p>UPS account # — use 45VY64.</p>",
    group: null,
    customerTypes: ["OEM"],
    csr: [{ displayName: "Sena Wheelhouse", email: "Sena.Wheelhouse@altronic-llc.com", lookupId: 64 }],
    kam: { displayName: "Jerrod Waldron", email: "Jerrod.Waldron@altronic-llc.com", lookupId: 45 },
    comments: [],
    hasAttachments: false,
    createdAt: daysAgo(400),
    modifiedAt: daysAgo(30),
  },
  {
    id: 2,
    customerName: "Arrow Engine Company",
    oldCustomerNumber: "436",
    sapCustomerNumber: "105053",
    generalNotes: "<p>Contact Seth Watkins.</p>",
    complianceNotes: "",
    group: "Arrow",
    customerTypes: ["OEM"],
    csr: [{ displayName: "Sena Wheelhouse", email: "Sena.Wheelhouse@altronic-llc.com", lookupId: 64 }],
    kam: null,
    comments: [],
    hasAttachments: false,
    createdAt: daysAgo(380),
    modifiedAt: daysAgo(60),
  },
  {
    id: 3,
    customerName: "Caterpillar (NI) Limited",
    oldCustomerNumber: "9250",
    sapCustomerNumber: "105224",
    generalNotes: "",
    complianceNotes: "",
    group: "CAT",
    customerTypes: ["OEM"],
    csr: [],
    kam: { displayName: "Jerrod Waldron", email: "Jerrod.Waldron@altronic-llc.com", lookupId: 45 },
    comments: [],
    hasAttachments: false,
    createdAt: daysAgo(370),
    modifiedAt: daysAgo(10),
  },
];

export const MOCK_CUSTOMER_CONTACTS: CustomerContact[] = [
  {
    id: 1,
    name: "Hunter Nixon",
    customerId: 1,
    email: "hnixon@7compression.com",
    phoneNumber: "903-630-5339 EXT 201",
    jobTitle: "Purchasing",
    contactNotes: "Alt email: procurement@7compression.com",
  },
  {
    id: 2,
    name: "Andrew Park",
    customerId: 2,
    email: "andrew.park@cooperservices.com",
    phoneNumber: "281-809-1602",
    jobTitle: "Senior Procurement",
    contactNotes: "",
  },
];

export const MOCK_SPECIAL_PRICING: SpecialPricingEntry[] = [
  {
    id: 1,
    title: "1000-0327-00",
    customerId: 1,
    pricingNotes: "Manually priced at $30.00 per prior purchase history.",
    aiPartNumber: "1000-0327-00",
  },
];

export const MOCK_CAPACITY: CapacityEntry[] = [
  {
    id: 1,
    partNumber: "1004-0770-00",
    customerId: 1,
    description: "MORIS IGNITION MODULE (JENBACHER)",
    weeklyMax: 300,
    notes: "300 total — base kits require 6 ign per kit.",
    customerPartNumber: "1244136",
  },
];
