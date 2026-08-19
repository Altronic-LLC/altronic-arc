import type { Ecn } from "@/types/task";

// =============================================================================
// Sample ECNs for mock mode.
//
// Shaped after the real rows (scripts/ecn-new-schema.json): the long fields
// hold SharePoint's rich-text wrapper, the Log# reads YY#### with an R suffix
// on a revision, and a revision sits alongside the notice it revises rather
// than replacing it.
// =============================================================================

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

export const MOCK_ECNS: Ecn[] = [
  {
    id: 1,
    logNo: "260062",
    title: "PCB ASSEMBLY, WCD-20",
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
    createdAt: daysAgo(2),
    modifiedAt: daysAgo(2),
  },
  {
    id: 2,
    logNo: "260059R1",
    title: "PCB ASSEMBLY, WCD-20",
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
    createdAt: daysAgo(6),
    modifiedAt: daysAgo(3),
  },
  {
    id: 3,
    logNo: "260059",
    title: "PCB ASSEMBLY, WCD-20",
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
    createdAt: daysAgo(20),
    modifiedAt: daysAgo(14),
  },
  {
    id: 4,
    logNo: "260058",
    title: "De-4000",
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
    createdAt: daysAgo(28),
    modifiedAt: daysAgo(28),
  },
  {
    id: 5,
    logNo: "250107R4",
    title: "IPMD-2 Schematic for Varispark Slave Ignition Incorporation & Obsolescence",
    submittedBy: { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" },
    comments: [],
    hasAttachments: false,
    values: {
      finalAssemblyPartNumbers: "Varispark Slave (791979-X); IPMD2 (791971-X)",
      detailedDescription:
        '<div class="ExternalClass11">Revision 4: Corrected 709144 drawing to released revision 4 dated 07/02/2019.<br></div>',
      serialNumbers: '<div class="ExternalClass12">Please provide serial numbers</div>',
      inHouseStock: "Engineering - Do NOT modify stock",
      fieldReturnsImpacted: "",
      drawingsComplete: "Yes",
      onHold: "",
      engineeringComments: "",
      signOffStatus: "",
    },
    createdAt: daysAgo(200),
    modifiedAt: daysAgo(190),
  },
];
