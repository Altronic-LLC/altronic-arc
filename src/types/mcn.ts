import type { Comment, Person, ProjectReference } from "./task";

// =============================================================================
// Manufacturing Change Notices — Operations (BusinessIT#38, Feature Request
// #24). One record per MCN: every box on MFGFRM-021 Rev 2 is a field, approval
// and distribution happen in ARC (MWI-762).
//
// The choice constants here are a CONTRACT with the SharePoint columns created
// by scripts/create-mcn-lists.ps1 — a value ARC writes that a column doesn't
// declare is refused. Change both together.
// =============================================================================

/** MWI-762's workflow, with Implemented added (the old log tracked Date Implemented). */
export const MCN_STATUSES = ["Draft", "Submitted", "Approved", "Implemented", "Rejected"] as const;
export type McnStatus = (typeof MCN_STATUSES)[number];

/** The register opens on these — work still moving. */
export const MCN_OPEN_STATUSES: readonly McnStatus[] = ["Draft", "Submitted", "Approved"];

export const MCN_PRIORITIES = ["Level 1", "Level 2", "Level 3"] as const;
export type McnPriority = (typeof MCN_PRIORITIES)[number];

/** MWI-762's meaning of each level — shown wherever a level is picked. */
export const MCN_PRIORITY_MEANINGS: Record<McnPriority, string> = {
  "Level 1": "Immediate",
  "Level 2": "By next build",
  "Level 3": "At convenience",
};

/** The eight Distribution boxes on MFGFRM-021, in the form's order. */
export const MCN_DISTRIBUTION_ROLES = [
  "Engineering",
  "VP Global Ops.",
  "Quality Manager",
  "Logistics Manager",
  "Test Eng. Manager",
  "Sales",
  "Purchasing Manager",
  "SHE Coordinator",
] as const;
export type McnDistributionRole = (typeof MCN_DISTRIBUTION_ROLES)[number];

/** A Yes / No answer on a Requires… or Incorporate into line. Blank = not answered. */
export type McnAnswer = "Yes" | "No" | "";

/** One Requires… or Incorporate into line: the answer and its reference. */
export interface McnItem {
  answer: McnAnswer;
  /** The work instruction, router, date code or serial number it refers to. */
  reference: string;
}

/** One row of the form's Department / Process / Applicable Equipment table. */
export interface McnScopeLine {
  /** Maintenance Departments item id, or null for a department typed before the list. */
  departmentId: number | null;
  /** The department's title when it was picked — shown if the id no longer resolves. */
  department: string;
  process: string;
  equipment: string;
}

export interface Mcn {
  id: number;
  /** `Title` — MCNyy###, assigned by ARC. */
  mcnNumber: string;
  /** The form's DATE. */
  date: Date | null;
  /** The form's PROCESS — a short title, shown in the register. */
  process: string;
  /** "Level 1" / "Level 2" / "Level 3", or "" when unset. */
  priority: string;
  status: McnStatus;
  originatedBy: Person | null;
  assignedEngineer: Person | null;
  /** Stamped by ARC on approval, never typed. */
  approvedBy: Person | null;
  approvedAt: Date | null;
  /** Description and/or reason of change — HTML. */
  description: string;
  scope: McnScopeLine[];
  /** The stored scope couldn't be read — it is shown as text and never written over. */
  scopeCorrupt: boolean;
  /** The Requires… and Incorporate into lines, keyed by item key (lib/mcnFields.ts). */
  items: Record<string, McnItem>;
  /** Which Distribution boxes are ticked. */
  distribution: string[];
  /** Who the approved MCN was actually sent to — the approver's final list. */
  distributedTo: Person[];
  distributedAt: Date | null;
  dateImplemented: Date | null;
  /** Date codes / serial numbers affected — what actually happened. */
  affected: string;
  rejectionReason: string;
  operationsTask: ProjectReference | null;
  /** Set on imported MCNs ("Imported from the log, no form on file"). */
  legacyNote: string;
  watchers: Person[];
  comments: Comment[];
  hasAttachments: boolean;
  createdBy: Person | null;
  createdAt: Date;
  modifiedAt: Date;
}

/** What the New MCN form sends. */
export interface McnInput {
  date: Date | null;
  process: string;
  priority: string;
  originatedBy: Person | null;
  assignedEngineer: Person | null;
  description: string;
  scope: McnScopeLine[];
  distribution: string[];
  watchers: Person[];
}

/**
 * A field edit, keyed by what changed. Only these travel through the
 * card editors; status, approval and distribution move through the
 * workflow functions, never a patch.
 */
export interface McnPatch {
  date?: Date | null;
  process?: string;
  priority?: string;
  description?: string;
  scope?: McnScopeLine[];
  items?: Record<string, McnItem>;
  distribution?: string[];
  dateImplemented?: Date | null;
  affected?: string;
}

// -----------------------------------------------------------------------------
// MCN Roles + Distribution Groups
// -----------------------------------------------------------------------------

/**
 *   member    raise an MCN, edit drafts, submit, record implementation
 *   approver  approve or reject a submitted MCN, reopen one
 *   admin     manage the team and the distribution groups
 *
 * The tags are independent — a person holds whichever they need. Everyone
 * signed in can read MCNs without any tag.
 */
export const MCN_ROLES = ["member", "approver", "admin"] as const;
export type McnRole = (typeof MCN_ROLES)[number];

export const MCN_ROLE_LABELS: Record<McnRole, string> = {
  member: "Team member",
  approver: "Approver",
  admin: "MCN admin",
};

export interface McnRoleEntry {
  id: number;
  email: string;
  displayName: string;
  roles: McnRole[];
  note: string;
}

export interface McnRoleInput {
  email: string;
  displayName: string;
  roles: McnRole[];
  note: string;
}

export interface McnDistributionGroup {
  id: number;
  /** The Distribution role on the form. */
  role: string;
  members: Person[];
  sortOrder: number;
}
