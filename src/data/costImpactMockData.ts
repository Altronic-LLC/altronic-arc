import type { CostImpactNotice } from "@/types/task";

// =============================================================================
// Sample Cost Impact Notices for mock mode.
//
// Shaped after the real list (scripts/cost-impact-portal-schema.json):
// Original/New Cost are decimal strings, Delta Cost mirrors SharePoint's own
// `=[New Cost]-[Original Cost]` calculated column, and Where Used carries the
// same rich-text wrapper as EIR/Gray Market's field of the same name.
// =============================================================================

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

export const MOCK_COST_IMPACT_NOTICES: CostImpactNotice[] = [
  {
    id: 1,
    title: "DATA LOGGING MODULE",
    supplier: "Redlion",
    sapNumber: "1000-5110-00",
    oldPartNumber: "615240",
    mpn: "",
    originalCost: "604.50",
    newCost: "1026.35",
    deltaCost: 421.85,
    timeOfImpact: "Near Future (<6 mo)",
    usedOnPanels: "No",
    whereUsed: '<div class="ExternalClass1"><table><tbody><tr><td>Material</td><td>Old</td><td>Description</td></tr><tr><td>1000-7843-00</td><td>615240KT</td><td>DATA LOGGER MODULE KIT</td></tr></tbody></table></div>',
    eau: "",
    bpReference: "",
    notes: "Supplier cited chip shortage.",
    yearIssued: String(now.getFullYear()),
    submittedBy: { displayName: "Mark Balent", email: "mark.balent@altronic-llc.com" },
    comments: [],
    hasAttachments: false,
    createdAt: daysAgo(4),
    modifiedAt: daysAgo(4),
  },
  {
    id: 2,
    title: "STEPPER MOTOR, HI TORQUE",
    supplier: "Haydon Kirk",
    sapNumber: "1000-2925-00",
    oldPartNumber: "610890",
    mpn: "46461-24-002",
    originalCost: "42.55",
    newCost: "59.02",
    deltaCost: 16.47,
    timeOfImpact: "Near Future (<6 mo)",
    usedOnPanels: "No",
    whereUsed: '<div class="ExternalClass2">Used on the WCD-20 assembly.</div>',
    eau: "721",
    bpReference: "",
    notes: "",
    yearIssued: String(now.getFullYear()),
    submittedBy: { displayName: "David Bell", email: "david.bell@altronic-llc.com" },
    comments: [],
    hasAttachments: false,
    createdAt: daysAgo(10),
    modifiedAt: daysAgo(9),
  },
  {
    id: 3,
    title: "CURRENT TRANSFORMER, 3500A:5A, 6\"ID",
    supplier: "Flexcore",
    sapNumber: "1002-4033-00",
    oldPartNumber: "G11081-3500A",
    mpn: "FCL3500/5-R411",
    originalCost: "297.60",
    newCost: "344.80",
    deltaCost: 47.2,
    timeOfImpact: "Immediate",
    usedOnPanels: "Yes",
    whereUsed: '<div class="ExternalClass3">None on file.</div>',
    eau: "0",
    bpReference: "",
    notes: "",
    yearIssued: String(now.getFullYear()),
    submittedBy: { displayName: "Matthew Traina", email: "matthew.traina@altronic-llc.com" },
    comments: [
      {
        timestamp: daysAgo(1),
        authorName: "Ray White",
        authorEmail: "ray.white@altronic-llc.com",
        bodyHtml: "<p>Confirmed with the supplier — effective next PO.</p>",
        attachments: [],
      },
    ],
    hasAttachments: false,
    createdAt: daysAgo(3),
    modifiedAt: daysAgo(1),
  },
];
