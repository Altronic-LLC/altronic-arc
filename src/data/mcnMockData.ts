import type { Person } from "@/types/task";
import type { Mcn, McnDistributionGroup, McnItem, McnRoleEntry, McnScopeLine } from "@/types/mcn";
import { MCN_DISTRIBUTION_ROLES } from "@/types/mcn";
import { blankMcnItems } from "@/lib/mcnFields";
import { MOCK_MAINTENANCE_DEPARTMENTS } from "./maintenanceMockData";

// =============================================================================
// Demo data for Manufacturing Change Notices. EVERYTHING HERE IS INVENTED —
// the repository is public (CLAUDE.md rule 8). The real MCNs, the real
// Manufacturing Team and the real distribution groups go into SharePoint
// through the import script and ARC's MCN Settings, never into src/.
//
// One MCN in every status, so each workflow button can be walked in a demo,
// plus one imported row with no form on file. The demo user holds all three
// roles. Dates are relative to today.
// =============================================================================

const DEMO_USER: Person = { displayName: "Demo User", email: "demo.user@altronic-llc.com" };
const ENGINEER: Person = { displayName: "Morgan Example", email: "morgan.example@example.com" };
const TECH: Person = { displayName: "Riley Sample", email: "riley.sample@example.com" };
const APPROVER: Person = { displayName: "Jordan Placeholder", email: "jordan.placeholder@example.com" };

function day(offset: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + offset, 12));
}

const yy = String(new Date().getFullYear() % 100).padStart(2, "0");

function department(title: string): Pick<McnScopeLine, "departmentId" | "department"> {
  const found = MOCK_MAINTENANCE_DEPARTMENTS.find((d) => d.title === title);
  return { departmentId: found?.lookupId ?? null, department: title };
}

function items(overrides: Record<string, Partial<McnItem>>): Record<string, McnItem> {
  const out = blankMcnItems();
  for (const [key, value] of Object.entries(overrides)) out[key] = { ...out[key], ...value };
  return out;
}

function base(id: number, seq: number, offset: number): Omit<Mcn, "process" | "status" | "description"> {
  return {
    id,
    mcnNumber: `MCN${yy}${String(seq).padStart(3, "0")}`,
    date: day(offset),
    priority: "Level 2",
    originatedBy: TECH,
    assignedEngineer: ENGINEER,
    approvedBy: null,
    approvedAt: null,
    scope: [],
    scopeCorrupt: false,
    items: blankMcnItems(),
    distribution: [],
    distributedTo: [],
    distributedAt: null,
    dateImplemented: null,
    affected: "",
    rejectionReason: "",
    operationsTask: null,
    legacyNote: "",
    watchers: [TECH, ENGINEER],
    comments: [],
    hasAttachments: false,
    createdBy: TECH,
    createdAt: day(offset),
    modifiedAt: day(offset),
  };
}

export const MOCK_MCNS: Mcn[] = [
  {
    ...base(1, 1, -120),
    process: "Wave solder flux change",
    status: "Implemented",
    priority: "Level 3",
    description:
      "<p>Move the through-hole line to a no-clean flux. The current flux leaves residue that has to be washed off by hand.</p>",
    scope: [{ ...department("PCB"), process: "Through-hole solder", equipment: "Wave solder machine" }],
    items: items({
      bulkMaterial: { answer: "Yes", reference: "Flux, no-clean (demo part)" },
      workInstruction: { answer: "Yes", reference: "MWI-0000 (demo)" },
      router: { answer: "No" },
      she: { answer: "Yes", reference: "Add SDS for the new flux" },
      newPcbs: { answer: "Yes", reference: "Date code 2611" },
      notifyCustomer: { answer: "No" },
    }),
    distribution: ["Engineering", "Quality Manager", "Purchasing Manager", "SHE Coordinator"],
    approvedBy: APPROVER,
    approvedAt: day(-110),
    distributedTo: [ENGINEER, APPROVER, { displayName: "Avery Quality", email: "avery.quality@example.com" }],
    distributedAt: day(-110),
    dateImplemented: day(-95),
    affected: "From date code 2611",
  },
  {
    ...base(2, 2, -40),
    process: "Robotic soldering replaces selective solder",
    status: "Approved",
    description: "<p>Move the selective solder step onto the soldering robot, with a new fixture.</p>",
    scope: [
      { ...department("SMT"), process: "Selective solder", equipment: "Robot, fixture" },
      { ...department("PROD"), process: "Final assembly", equipment: "" },
    ],
    items: items({ workInstruction: { answer: "Yes", reference: "MWI-0001 (demo)" }, router: { answer: "Yes", reference: "Demo router 100-1" } }),
    distribution: ["Engineering", "VP Global Ops.", "Quality Manager"],
    approvedBy: APPROVER,
    approvedAt: day(-30),
    distributedTo: [ENGINEER, APPROVER],
    distributedAt: day(-30),
  },
  {
    ...base(3, 3, -6),
    process: "Machining coolant supplier change",
    status: "Submitted",
    priority: "Level 1",
    description: "<p>The current coolant leaves residue on fixtures. Same part number, new supplier.</p>",
    scope: [{ ...department("MACH SHOP"), process: "Machining", equipment: "All CNC machines" }],
    items: items({ bulkMaterial: { answer: "Yes", reference: "Demo coolant part" }, she: { answer: "Yes", reference: "Add SDS" } }),
    distribution: ["Logistics Manager", "Sales", "Purchasing Manager", "SHE Coordinator"],
    watchers: [TECH, ENGINEER, DEMO_USER],
  },
  {
    ...base(4, 4, -2),
    process: "Label printer ink",
    status: "Draft",
    priority: "",
    originatedBy: DEMO_USER,
    assignedEngineer: null,
    description: "",
    scope: [{ ...department("PROD"), process: "Labelling", equipment: "Label stamp machine" }],
    watchers: [DEMO_USER],
    createdBy: DEMO_USER,
  },
  {
    ...base(5, 5, -60),
    process: "Lead-free paste evaluation",
    status: "Rejected",
    description: "<p>Trial a lead-free solder paste on the screen printer.</p>",
    scope: [{ ...department("SMT"), process: "Screen print", equipment: "Screen printer" }],
    rejectionReason: "Hold until the customer qualification is planned.",
  },
  {
    ...base(6, 6, -300),
    mcnNumber: `MCN${String((new Date().getFullYear() - 1) % 100).padStart(2, "0")}001`,
    process: "Capacitor RTV application",
    status: "Implemented",
    priority: "Level 3",
    description: "",
    legacyNote: "Imported from the old log — no form on file.",
    dateImplemented: day(-290),
    approvedBy: null,
  },
];

export const MOCK_MCN_ROLES: McnRoleEntry[] = [
  {
    id: 1,
    email: DEMO_USER.email!,
    displayName: DEMO_USER.displayName,
    roles: ["member", "approver", "admin"],
    note: "Mock-mode default user — every role, so each screen can be walked in a demo",
  },
  { id: 2, email: ENGINEER.email!, displayName: ENGINEER.displayName, roles: ["member"], note: "Manufacturing engineer" },
  { id: 3, email: TECH.email!, displayName: TECH.displayName, roles: ["member"], note: "" },
  { id: 4, email: APPROVER.email!, displayName: APPROVER.displayName, roles: ["approver"], note: "Delegate" },
];

const GROUP_MEMBERS: Partial<Record<string, Person[]>> = {
  Engineering: [ENGINEER],
  "VP Global Ops.": [APPROVER],
  "Quality Manager": [{ displayName: "Avery Quality", email: "avery.quality@example.com" }],
  "Purchasing Manager": [{ displayName: "Casey Buyer", email: "casey.buyer@example.com" }],
  "SHE Coordinator": [{ displayName: "Drew Safety", email: "drew.safety@example.com" }],
};

export const MOCK_MCN_DISTRIBUTION_GROUPS: McnDistributionGroup[] = MCN_DISTRIBUTION_ROLES.map((role, i) => ({
  id: i + 1,
  role,
  members: GROUP_MEMBERS[role] ?? [],
  sortOrder: i + 1,
}));
