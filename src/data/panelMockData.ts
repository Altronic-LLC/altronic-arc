import type { PanelOrder, PanelProject, PanelRoleEntry, PanelTask } from "@/types/task";

// =============================================================================
// Mock data for the Panels department — modelled on the real Panel Order
// Headers / Panel Project Reference / Panel User Roles schema discovered via
// Graph on the ALTRONICPANELTEAM site (2026-07-17). Used when USE_MOCK.
// =============================================================================

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 36 };
const DAVID = { displayName: "David Bulkley", email: "david.bulkley@altronic-llc.com", lookupId: 24 };
const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 46 };
const ERIC = { displayName: "Eric Gilkinson", email: "eric.gilkinson@altronic-llc.com", lookupId: 65 };
const AMANDA = { displayName: "Amanda Hoagland", email: "amanda.hoagland@altronic-llc.com", lookupId: 25 };

export const MOCK_PANEL_PROJECTS: PanelProject[] = [
  {
    id: 1,
    title: "P-0001",
    projectType: "PRD-Production Order",
    description: "Archrock skid control panels — recurring production build",
    dwgNo: "DWG-88123",
    customer: "Archrock",
    department: "Sales",
  },
  {
    id: 2,
    title: "P-0002",
    projectType: "DEV-Product Development",
    description: "Next-gen annunciator panel prototype",
    dwgNo: "DWG-90040",
    customer: "Altronic",
    department: "Engineering",
  },
  {
    id: 3,
    title: "P-0003",
    projectType: "FS-Field Support",
    description: "Odessa field retrofit panels",
    dwgNo: "",
    customer: "Kodiak Gas",
    department: "Operations",
  },
  {
    id: 4,
    title: "P-0004",
    projectType: "PRG-Programming",
    description: "PLC program updates for UE Compression order",
    dwgNo: "DWG-90311",
    customer: "UE Compression",
    department: "Engineering",
  },
  {
    id: 5,
    title: "P-0005",
    projectType: "MSC-Misc",
    description: "Internal test-bench panel",
    dwgNo: "",
    customer: "Altronic",
    department: "Operations",
  },
];

const projectRefByTitle = (title: string) => {
  const p = MOCK_PANEL_PROJECTS.find((x) => x.title === title)!;
  return { lookupId: p.id, title: p.title };
};

export const MOCK_PANEL_ORDERS: PanelOrder[] = [
  {
    id: 1,
    title: "Archrock skid panel build — June release",
    status: "In Production",
    projectRef: projectRefByTitle("P-0001"),
    salesOrder: "12345678910",
    purchaseOrder: "987654321A",
    customerReference: "Odessa Field Unit B100",
    customer: "Archrock",
    customerContactEmail: "bob@testemail.com",
    orderNotes:
      "Test order notes they want these ASAP.\n- [x] Confirm BOM ✓[Ray White · 7/10/2026, 9:05 AM]\n- [ ] Order enclosures\n- [ ] Schedule wiring",
    engineerAssigned: RAY,
    watchers: [RAY, DAVID],
    comments: [
      {
        timestamp: new Date("2026-07-10T13:20:00"),
        authorName: "Ray White",
        authorEmail: "ray.white@altronic-llc.com",
        bodyHtml: "<p>Enclosures are on a 2-week lead. Wiring can start on the bench meanwhile.</p>",
        attachments: [],
      },
    ],
    hasAttachments: true,
    createdAt: new Date("2026-07-01T14:00:00Z"),
    modifiedAt: new Date("2026-07-15T16:30:00Z"),
    author: RAY,
  },
  {
    id: 2,
    title: "Annunciator prototype — bench unit",
    status: "In Engineering",
    projectRef: projectRefByTitle("P-0002"),
    salesOrder: "",
    purchaseOrder: "",
    customerReference: "Internal prototype",
    customer: "Altronic",
    customerContactEmail: "",
    orderNotes: "Schematic review before any panel work starts.",
    engineerAssigned: SARAH,
    watchers: [SARAH, ERIC],
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-07-08T10:15:00Z"),
    modifiedAt: new Date("2026-07-14T09:45:00Z"),
    author: SARAH,
  },
  {
    id: 3,
    title: "Kodiak retrofit panels (qty 4)",
    status: "Testing",
    projectRef: projectRefByTitle("P-0003"),
    salesOrder: "22334455",
    purchaseOrder: "KG-2026-118",
    customerReference: "Permian units 12–15",
    customer: "Kodiak Gas",
    customerContactEmail: "ops@kodiakgas.example",
    orderNotes: "- [x] Hi-pot all four ✓[Eric Gilkinson · 7/12/2026, 2:40 PM]\n- [ ] Functional test with field harness",
    engineerAssigned: ERIC,
    watchers: [ERIC, AMANDA],
    comments: [
      {
        timestamp: new Date("2026-07-12T18:50:00"),
        authorName: "Eric Gilkinson",
        authorEmail: "eric.gilkinson@altronic-llc.com",
        bodyHtml: "<p>Two of four passed functional. Remaining two queued for Monday.</p>",
        attachments: [],
      },
    ],
    hasAttachments: false,
    createdAt: new Date("2026-06-20T12:00:00Z"),
    modifiedAt: new Date("2026-07-12T18:50:00Z"),
    author: DAVID,
  },
  {
    id: 4,
    title: "UE Compression PLC reprogram",
    status: "Submitted",
    projectRef: projectRefByTitle("P-0004"),
    salesOrder: "99887766",
    purchaseOrder: "",
    customerReference: "",
    customer: "UE Compression",
    customerContactEmail: "controls@uec.example",
    orderNotes: "Customer to supply current program backup before work begins.",
    engineerAssigned: null,
    watchers: [DAVID],
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-07-16T15:30:00Z"),
    modifiedAt: new Date("2026-07-16T15:30:00Z"),
    author: DAVID,
  },
  {
    id: 5,
    title: "Test-bench panel refresh",
    status: "Shipped",
    projectRef: projectRefByTitle("P-0005"),
    salesOrder: "11224488",
    purchaseOrder: "INT-0042",
    customerReference: "Bench 3",
    customer: "Altronic",
    customerContactEmail: "",
    orderNotes: "",
    engineerAssigned: AMANDA,
    watchers: [AMANDA],
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-05-04T13:00:00Z"),
    modifiedAt: new Date("2026-06-10T17:00:00Z"),
    author: AMANDA,
  },
];

export const MOCK_PANEL_ROLES: PanelRoleEntry[] = [
  { id: 1, user: RAY, role: "Super User", note: "App manager" },
  { id: 2, user: SARAH, role: "Engineer", note: "" },
  { id: 3, user: ERIC, role: "Tech", note: "Panel shop lead" },
  { id: 4, user: DAVID, role: "Manager", note: "" },
  { id: 5, user: AMANDA, role: "Viewer", note: "Scheduling visibility" },
];

export const MOCK_PANEL_TASKS: PanelTask[] = [
  {
    id: 1,
    title: "Draw up enclosure layout for Archrock skids",
    status: "In Process",
    taskType: "Drawings",
    projectRef: projectRefByTitle("P-0001"),
    assigned: SARAH,
    description:
      "Panel enclosure GA drawing for the June release.\n- [x] Rough layout ✓[Sarah Shaffer · 7/11/2026, 8:30 AM]\n- [ ] Dimension callouts\n- [ ] Send to customer for approval",
    watchers: [SARAH, RAY],
    comments: [
      {
        timestamp: new Date("2026-07-11T14:05:00"),
        authorName: "Sarah Shaffer",
        authorEmail: "sarah.shaffer@altronic-llc.com",
        bodyHtml: "<p>Rough layout done — need the terminal count confirmed before dimensioning.</p>",
        attachments: [],
      },
    ],
    hasAttachments: false,
    createdAt: new Date("2026-07-09T13:00:00Z"),
    modifiedAt: new Date("2026-07-11T14:05:00Z"),
    author: RAY,
  },
  {
    id: 2,
    title: "Write sequence of operations for annunciator prototype",
    status: "Pending",
    taskType: "SOO",
    projectRef: projectRefByTitle("P-0002"),
    assigned: ERIC,
    description: "Draft SOO for the bench prototype ahead of programming.",
    watchers: [ERIC],
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-07-14T09:00:00Z"),
    modifiedAt: new Date("2026-07-14T09:00:00Z"),
    author: SARAH,
  },
  {
    id: 3,
    title: "Quote panel rebuild for Kodiak retrofit",
    status: "On Hold",
    taskType: "Quote",
    projectRef: projectRefByTitle("P-0003"),
    assigned: DAVID,
    description: "Waiting on updated BOM from engineering before quoting.",
    watchers: [DAVID, AMANDA],
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-06-28T11:00:00Z"),
    modifiedAt: new Date("2026-07-10T16:20:00Z"),
    author: DAVID,
  },
  {
    id: 4,
    title: "File closeout paperwork for test-bench refresh",
    status: "Complete",
    taskType: "Administrative",
    projectRef: projectRefByTitle("P-0005"),
    assigned: AMANDA,
    description: "",
    watchers: [AMANDA],
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-05-06T10:00:00Z"),
    modifiedAt: new Date("2026-06-11T15:00:00Z"),
    author: AMANDA,
  },
];
