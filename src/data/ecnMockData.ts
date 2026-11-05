import type { Ecn, EcnDistributionGroup, Person } from "@/types/task";
import { ECN_DEFAULT_DISTRIBUTION, ECN_DISTRIBUTION_ROLES } from "@/lib/ecnDistribution";

// =============================================================================
// Sample ECNs for mock mode.
//
// Shaped after the real rows (scripts/ecn-new-schema.json): the long fields
// hold SharePoint's rich-text wrapper, the Log# reads YY#### with an R suffix
// on a revision, and a revision sits alongside the notice it revises rather
// than replacing it.
//
// The project lookupIds are real ones from MOCK_PROJECTS. A made-up id
// resolves to no title, which makes the project column and the dashboard's
// project filter look broken in mock mode when they aren't.
// =============================================================================

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

export const MOCK_ECNS: Ecn[] = [
  {
    id: 1,
    logNo: "260062",
    title: "PCB ASSEMBLY, WCD-20",
    parentProject: { lookupId: 274, title: "" },
    submittedBy: { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" },
    comments: [],
    hasAttachments: false,
    values: {
      finalAssemblyPartNumbers: "791970",
      detailedDescription:
        '<div class="ExternalClass1">Change R14 from 701082 to 711478 (update description from 2K to 510 ohm).<br>Change quantity of 701082 from 7 to 6.<br></div>',
      serialNumbers: '<div class="ExternalClass2">Please provide serial numbers</div>',
      inHouseStock: "Engineering - Do NOT modify stock",
      fieldReturnsImpacted: "",
      drawingsComplete: "",
      onHold: "",
      engineeringComments: "",
      signOffStatus: "",
    },
    distribution: [...ECN_DEFAULT_DISTRIBUTION],
    distributedTo: [],
    distributedAt: null,
    createdAt: daysAgo(2),
    modifiedAt: daysAgo(2),
  },
  {
    id: 2,
    logNo: "260059R1",
    title: "PCB ASSEMBLY, WCD-20",
    parentProject: { lookupId: 274, title: "" },
    submittedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    comments: [
      {
        timestamp: daysAgo(3),
        authorName: "Jerrod Waldron",
        authorEmail: "jerrod.waldron@altronic-llc.com",
        bodyHtml: "<p>Production has the modified stock on the bench — waiting on the drawing.</p>",
        attachments: [],
      },
    ],
    hasAttachments: true,
    values: {
      finalAssemblyPartNumbers: "791970",
      detailedDescription:
        '<div class="ExternalClass3">REVISION 1: Production to modify existing in-house stock.<br></div>',
      serialNumbers: '<div class="ExternalClass4">S/N 628</div>',
      inHouseStock: "Engineering - Modify stock (see pg 2 of ECN)",
      fieldReturnsImpacted: "",
      drawingsComplete: "",
      onHold: "Yes",
      engineeringComments:
        '<div class="ExternalClass5">7-30-26: SAP BOM updated. Drawings will follow at a later date.</div>',
      signOffStatus: "",
    },
    distribution: [...ECN_DEFAULT_DISTRIBUTION, "CAD Department"],
    distributedTo: [],
    distributedAt: null,
    createdAt: daysAgo(6),
    modifiedAt: daysAgo(3),
  },
  {
    id: 3,
    logNo: "260059",
    title: "PCB ASSEMBLY, WCD-20",
    parentProject: { lookupId: 412, title: "" },
    submittedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    comments: [],
    hasAttachments: false,
    values: {
      finalAssemblyPartNumbers: "791970",
      detailedDescription:
        '<div class="ExternalClass6">Update the panel array from 10x20 to 10x7 and scrap stock of Rev. 0 once implemented.</div>',
      serialNumbers: '<div class="ExternalClass7">Not a serialized product</div>',
      inHouseStock: "Operations - Stock modified",
      fieldReturnsImpacted: "",
      drawingsComplete: "Yes",
      onHold: "No",
      engineeringComments:
        '<div class="ExternalClass8">7-28-26: SAP updated and drawings are ready for distribution</div>',
      signOffStatus: "Complete",
    },
    distribution: [...ECN_DEFAULT_DISTRIBUTION],
    // Signed off and sent — what an ECN looks like afterwards.
    distributedTo: [
      { displayName: "Quinn Quality", email: "quinn.quality@example.com" },
      { displayName: "Lee Logistics", email: "lee.logistics@example.com" },
      { displayName: "Pat Production", email: "pat.production@example.com" },
    ],
    distributedAt: daysAgo(18),
    createdAt: daysAgo(20),
    modifiedAt: daysAgo(14),
  },
  {
    id: 4,
    logNo: "260058",
    title: "De-4000",
    parentProject: { lookupId: 412, title: "" },
    submittedBy: { displayName: "Steven Kelly", email: "steven.kelly@altronic-llc.com" },
    comments: [],
    hasAttachments: false,
    values: {
      finalAssemblyPartNumbers: "691759 and 691760",
      detailedDescription:
        '<div class="ExternalClass9">Correct rev and date for 691760 from 13 3-3-26 to 8 3-31-26.</div>',
      serialNumbers: '<div class="ExternalClass10">See R0</div>',
      inHouseStock: "Engineering - Do NOT modify stock",
      fieldReturnsImpacted: "Yes",
      drawingsComplete: "",
      onHold: "",
      engineeringComments: "",
      signOffStatus: "",
    },
    distribution: [...ECN_DEFAULT_DISTRIBUTION, "Panel Plant"],
    distributedTo: [],
    distributedAt: null,
    createdAt: daysAgo(28),
    modifiedAt: daysAgo(28),
  },
  {
    id: 5,
    logNo: "250107R4",
    parentProject: null,
    title: "IPMD-2 Schematic for Varispark Slave Ignition Incorporation & Obsolescence",
    submittedBy: { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" },
    comments: [],
    hasAttachments: false,
    values: {
      finalAssemblyPartNumbers: "Varispark Slave (791979-X); IPMD2 (791971-X)",
      detailedDescription:
        '<div class="ExternalClass11">Revision 4: Corrected 709144 drawing to released revision 4 dated 07/02/2019.<br></div>',
      serialNumbers: '<div class="ExternalClass12">Please provide serial numbers</div>',
      // Modify stock + a request for serial numbers: the demo's one ECN under
      // the list's "Waiting" serial-numbers filter (BusinessIT#61).
      inHouseStock: "Engineering - Modify stock (see pg 2 of ECN)",
      fieldReturnsImpacted: "",
      drawingsComplete: "Yes",
      onHold: "",
      engineeringComments: "",
      signOffStatus: "",
    },
    // Predates distribution in ARC — nothing ticked, nothing sent.
    distribution: [],
    distributedTo: [],
    distributedAt: null,
    createdAt: daysAgo(200),
    modifiedAt: daysAgo(190),
  },
];

// -----------------------------------------------------------------------------
// ECN Distribution Groups (BusinessIT#57) — INVENTED people, never real ones
// (the repository is public). Panel Plant and SHE Coordinator are left empty
// so the "nobody is set up for…" warning can be seen in the demo.
// -----------------------------------------------------------------------------

const GROUP_MEMBERS: Partial<Record<string, Person[]>> = {
  "CAD Department": [{ displayName: "Casey Drafter", email: "casey.drafter@example.com" }],
  "VP Operations Eng.": [{ displayName: "Val Operations", email: "val.operations@example.com" }],
  "Quality Manager": [{ displayName: "Quinn Quality", email: "quinn.quality@example.com" }],
  "Logistics Manager": [{ displayName: "Lee Logistics", email: "lee.logistics@example.com" }],
  "Production Director": [{ displayName: "Pat Production", email: "pat.production@example.com" }],
  Sales: [
    { displayName: "Sam Sales", email: "sam.sales@example.com" },
    { displayName: "Robin Accounts", email: "robin.accounts@example.com" },
  ],
  "Op. Program Manager": [{ displayName: "Morgan Program", email: "morgan.program@example.com" }],
  // Also in Quality — so the demo shows one person on two roles getting ONE email.
  "Purchasing Manager": [
    { displayName: "Bailey Buyer", email: "bailey.buyer@example.com" },
    { displayName: "Quinn Quality", email: "quinn.quality@example.com" },
  ],
};

export const MOCK_ECN_DISTRIBUTION_GROUPS: EcnDistributionGroup[] = ECN_DISTRIBUTION_ROLES.map((role, i) => ({
  id: i + 1,
  role,
  members: GROUP_MEMBERS[role] ?? [],
  sortOrder: i + 1,
}));
