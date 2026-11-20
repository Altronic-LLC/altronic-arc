import type { Person } from "./task";

// =============================================================================
// Human Resources — types and constants (Tim, 2026-11-17).
//
// HR's lists live on its own site, AltronicPC-ARCConnection (SITES.hr, a
// QUIET site — see api/appAccess.ts); unset list ids read nothing
// (`HR_CONFIGURED` in api/config.ts).
//
// Access is the HR Roles list — one tag per app, so a person can see New Hire
// and not the next HR app. No role = the whole HR department is HIDDEN (menu
// and Dashboard), not "coming soon": what HR runs isn't advertised. The real
// boundary is the lists' own SharePoint permissions, set to match.
// =============================================================================

// -----------------------------------------------------------------------------
// HR Roles
// -----------------------------------------------------------------------------

/**
 * The tags on the HR Roles list. Lowercase, stored as a CSV in `Roles`.
 *   * `new hire`     — open and edit New Hires.
 *   * `new hire sap` — the same, AND emailed to add each new hire to SAP.
 *   * `new hire it`  — the same, AND emailed to raise the IT ticket.
 *   * `admin`        — manage the HR Roles list (and open every HR app).
 * A future HR app adds its own tag here.
 */
export const HR_ROLES = ["new hire", "new hire sap", "new hire it", "admin"] as const;
export type HrRole = (typeof HR_ROLES)[number];

export const HR_ROLE_LABELS: Record<HrRole, string> = {
  "new hire": "New Hire",
  "new hire sap": "New Hire — SAP",
  "new hire it": "New Hire — IT",
  admin: "HR admin",
};

export const HR_ROLE_HINTS: Record<HrRole, string> = {
  "new hire": "Can open and edit new hires.",
  "new hire sap": "Can open new hires, and is emailed to add each one to SAP.",
  "new hire it": "Can open new hires, and is emailed to raise the IT ticket for each one.",
  admin: "Manages this list, and can open every HR app.",
};

export interface HrRoleEntry {
  id: number;
  email: string;
  displayName: string;
  roles: HrRole[];
  note: string;
}

export type HrRoleInput = Omit<HrRoleEntry, "id">;

// -----------------------------------------------------------------------------
// New Hires
// -----------------------------------------------------------------------------

/** Three options — pills, never a dropdown. */
export const EMPLOYMENT_TYPES = ["Permanent", "Intern", "Contractor"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/**
 * Stored in `Status` so SharePoint's own views show it, but DERIVED on every
 * write (lib/newHire.ts) — nobody picks it. Cancelled is the one status a
 * person sets, with a reason.
 */
export const NEW_HIRE_STATUSES = ["Submitted", "In progress", "Complete", "Cancelled"] as const;
export type NewHireStatus = (typeof NEW_HIRE_STATUSES)[number];

/** The kick-off checklist, in the order the work happens. */
export const NEW_HIRE_STEPS = ["addedToSap", "itTicketRaised", "itAccountCreated", "computerSetUp"] as const;
export type NewHireStep = (typeof NEW_HIRE_STEPS)[number];

export const NEW_HIRE_STEP_LABELS: Record<NewHireStep, string> = {
  addedToSap: "Added to SAP",
  itTicketRaised: "IT ticket raised",
  itAccountCreated: "IT account created",
  computerSetUp: "Computer set up",
};

/** Who ticked a step, and when. Unticking clears it. */
export interface StepStamp {
  at: Date;
  by: Person;
}

export interface NewHireCancellation {
  at: Date;
  by: Person;
  reason: string;
}

/** The fields a person types — the New Hire form and the detail page's cards. */
export interface NewHireInput {
  /** Date-only, `yyyy-mm-dd`, or "" for not set. */
  startDate: string;
  legalFirstName: string;
  preferredFirstName: string;
  lastName: string;
  /** Filled in from the name until somebody types in it — see `defaultNewHireEmail`. */
  email: string;
  jobTitle: string;
  fabNumber: string;
  personalNumber: string;
  empNumber: string;
  employmentType: EmploymentType | null;
  department: string;
  /** Picked from the staff directory, never typed — stored as name + email text. */
  manager: Person | null;
  needsComputer: boolean | null;
  deskLocation: string;
  notes: string;
  itTicketNumber: string;
  itTicketLink: string;
}

export interface NewHire extends NewHireInput {
  id: number;
  /** `Title` — the preferred (else legal) first name and the last name. */
  displayName: string;
  steps: Record<NewHireStep, StepStamp | null>;
  cancelled: NewHireCancellation | null;
  status: NewHireStatus;
  submittedBy: Person | null;
  createdAt: Date | null;
  modifiedAt: Date | null;
}

/** The fields an edit may change — any subset of the input. */
export type NewHirePatch = Partial<NewHireInput>;
