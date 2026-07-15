import type { OperationsTask, ProjectReference } from "@/types/task";

// =============================================================================
// Mock data for the Operations department — modelled on the real Operations
// Task List / Operations Projects / Altronic Equipment List schema discovered
// via Graph on the Altronic_PMO site. Used when VITE_USE_MOCK=true.
// =============================================================================

export const MOCK_OPERATIONS_PROJECTS: ProjectReference[] = [
  { lookupId: 1, title: "0000-Operations Task List" },
  { lookupId: 3, title: "0002-PVA Conformal Coating Machine" },
  { lookupId: 4, title: "0003-Shop Floor Relayout - Repair Department" },
];

/** Read-only reference list — no admin CRUD, just a picker. */
export const MOCK_OPERATIONS_EQUIPMENT: ProjectReference[] = [
  { lookupId: 1, title: "TM1" },
  { lookupId: 2, title: "20 HP COMPRESSOR" },
  { lookupId: 3, title: "40 HP COMPRESSOR" },
  { lookupId: 4, title: "50 HP COMPRESSOR" },
  { lookupId: 5, title: "5000 DIGITAL" },
];

const projectByName = (name: string) => MOCK_OPERATIONS_PROJECTS.find((p) => p.title === name)!;
const equipmentByName = (name: string) => MOCK_OPERATIONS_EQUIPMENT.find((e) => e.title === name)!;

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 };
const DAVID = { displayName: "David Bulkley", email: "david.bulkley@altronic-llc.com", lookupId: 24 };
const CHANDANA = { displayName: "Chandana Ramisetty", email: "chandana.ramisetty@altronic-llc.com", lookupId: 64 };
const ERIC = { displayName: "Eric Gilkinson", email: "eric.gilkinson@altronic-llc.com", lookupId: 65 };
const ALYSSA = { displayName: "Alyssa Garrett", email: "alyssa.garrett@altronic-llc.com", lookupId: 63 };
const AMANDA = { displayName: "Amanda Hoagland", email: "amanda.hoagland@altronic-llc.com", lookupId: 25 };

const MOCK_OPERATIONS_TASKS_RAW: Omit<OperationsTask, "author">[] = [
  {
    id: 1,
    taskNumber: "Task 0000-1",
    title: "Build Operations Task App",
    description:
      "Build Operations a checklist-style app for tracking tasks, mirroring the Engineering task flow.",
    status: "Complete",
    priority: "High",
    taskType: "Administrative",
    location: "Office/Admin",
    dueDate: new Date("2025-04-30T22:00:00Z"),
    createdAt: new Date("2025-03-25T14:40:52Z"),
    modifiedAt: new Date("2025-08-21T12:23:21Z"),
    authorLookupId: 22,
    editorLookupId: 24,
    assigned: RAY,
    watchers: [RAY, DAVID, CHANDANA],
    parentProject: projectByName("0000-Operations Task List"),
    equipment: null,
    comments: [
      {
        timestamp: new Date("2026-01-14T16:53:23"),
        authorName: "Ray White",
        authorEmail: "ray.white@altronic-llc.com",
        bodyHtml: "<p>Most requests are done — check them out.</p>",
        attachments: [],
      },
    ],
    hasAttachments: true,
  },
  {
    id: 4,
    taskNumber: "Task 0002-4",
    title: "Conformal Coating PVA Installation",
    description: "Installation of new PVA conformal coating equipment.",
    status: "Complete",
    priority: "High",
    taskType: "NEW Equipment",
    location: "Conformal Coating",
    dueDate: null,
    createdAt: new Date("2025-07-02T18:46:32Z"),
    modifiedAt: new Date("2026-04-28T13:48:27Z"),
    authorLookupId: 24,
    editorLookupId: 24,
    assigned: DAVID,
    watchers: [DAVID, ERIC, AMANDA, ALYSSA],
    parentProject: projectByName("0002-PVA Conformal Coating Machine"),
    equipment: null,
    comments: [
      {
        timestamp: new Date("2026-01-14T15:14:45"),
        authorName: "Eric Gilkinson",
        authorEmail: "eric.gilkinson@altronic-llc.com",
        bodyHtml: "<p>PVA coating system is in MP2. Finalizing the needed tasks.</p>",
        attachments: [],
      },
    ],
    hasAttachments: false,
  },
  {
    id: 5,
    taskNumber: "Task 0003-1",
    title: "Move Repair Department bench layout",
    description:
      "Relayout the Repair Department floor plan to accommodate the incoming Jenbacher work cell.",
    status: "WIP",
    priority: "Med",
    taskType: "Plant Relayout",
    location: "Repair",
    dueDate: new Date("2026-08-15T00:00:00Z"),
    createdAt: new Date("2025-07-09T13:12:08Z"),
    modifiedAt: new Date("2026-06-01T09:00:00Z"),
    authorLookupId: 24,
    editorLookupId: 24,
    assigned: ALYSSA,
    watchers: [DAVID],
    parentProject: projectByName("0003-Shop Floor Relayout - Repair Department"),
    equipment: equipmentByName("TM1"),
    comments: [],
    hasAttachments: false,
  },
  {
    id: 6,
    taskNumber: "Task 0000-2",
    title: "Quarterly compressor PM",
    description: "Preventive maintenance on the shop compressors per the vendor schedule.",
    status: "Backlog",
    priority: "Low",
    taskType: "Existing Equipment",
    location: "Machine Shop",
    dueDate: null,
    createdAt: new Date("2026-06-10T10:00:00Z"),
    modifiedAt: new Date("2026-06-10T10:00:00Z"),
    authorLookupId: 22,
    editorLookupId: 22,
    assigned: null,
    watchers: [RAY],
    parentProject: null,
    equipment: equipmentByName("40 HP COMPRESSOR"),
    comments: [],
    hasAttachments: false,
  },
];

const PEOPLE_BY_LOOKUP_ID = new Map(
  [RAY, DAVID, CHANDANA, ERIC, ALYSSA, AMANDA].map((p) => [p.lookupId, p]),
);

export const MOCK_OPERATIONS_TASKS: OperationsTask[] = MOCK_OPERATIONS_TASKS_RAW.map((t) => ({
  ...t,
  author: PEOPLE_BY_LOOKUP_ID.get(t.authorLookupId) ?? null,
}));
