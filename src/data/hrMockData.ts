import type { HrRoleEntry, NewHire, NewHireStep, StepStamp } from "@/types/hr";
import type { Person } from "@/types/task";
import { toIsoDate } from "@/lib/dateInput";
import { newHireStatus } from "@/lib/newHire";

// =============================================================================
// Demo data for Human Resources. EVERYTHING HERE IS INVENTED — the repository
// is public (CLAUDE.md rule 8), and this department holds personal data. Real
// new hires and the real HR team go into SharePoint, never into src/.
//
// ONE exception: new hire #6 is Tim Webster, by name only, at his request
// (2026-11-20) — he is on SAP's real employee list, so the dev server's
// demo-with-live-Fabric mode (VITE_FABRIC_IN_DEMO) shows the SAP check
// confirming a real person. His name is already in src/ elsewhere; no number
// or personal identifier of his is here — his row in MOCK_SAP_EMPLOYEES
// carries an invented employee number.
//
// One new hire in each state (just submitted, part-way, complete, cancelled,
// no computer needed). The demo user holds every HR tag; the other role rows
// show the SAP and IT tags. Start dates are relative to today.
// =============================================================================

const DEMO_USER: Person = { displayName: "Demo User", email: "demo.user@altronic-llc.com" };
const HR_PERSON: Person = { displayName: "Avery Example", email: "avery.example@example.com" };
const SAP_PERSON: Person = { displayName: "Sam Placeholder", email: "sam.placeholder@example.com" };
const IT_PERSON: Person = { displayName: "Quinn Sample", email: "quinn.sample@example.com" };
const MANAGER_A: Person = { displayName: "Jordan Manager", email: "jordan.manager@example.com" };
const MANAGER_B: Person = { displayName: "Casey Lead", email: "casey.lead@example.com" };

export const MOCK_HR_ROLES: HrRoleEntry[] = [
  { id: 1, email: DEMO_USER.email!, displayName: DEMO_USER.displayName, roles: ["new hire", "new hire sap", "new hire it", "admin"], note: "Demo — every tag" },
  { id: 2, email: HR_PERSON.email!, displayName: HR_PERSON.displayName, roles: ["new hire", "admin"], note: "" },
  { id: 3, email: SAP_PERSON.email!, displayName: SAP_PERSON.displayName, roles: ["new hire sap"], note: "Adds people to SAP" },
  { id: 4, email: IT_PERSON.email!, displayName: IT_PERSON.displayName, roles: ["new hire it"], note: "Raises the IT ticket" },
];

function dayFromToday(offset: number): string {
  const d = new Date();
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset));
}

function ago(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function steps(done: Partial<Record<NewHireStep, StepStamp>>): Record<NewHireStep, StepStamp | null> {
  return {
    addedToSap: done.addedToSap ?? null,
    itTicketRaised: done.itTicketRaised ?? null,
    itAccountCreated: done.itAccountCreated ?? null,
    computerSetUp: done.computerSetUp ?? null,
  };
}

type Seed = Omit<NewHire, "status">;

const SEEDS: Seed[] = [
  {
    id: 1,
    displayName: "Taylor Newman",
    startDate: dayFromToday(14),
    legalFirstName: "Taylor",
    preferredFirstName: "",
    lastName: "Newman",
    email: "Taylor.Newman@altronic-llc.com",
    jobTitle: "Production Associate",
    fabNumber: "",
    personalNumber: "",
    empNumber: "",
    employmentType: "Permanent",
    department: "Operations",
    manager: MANAGER_A,
    needsComputer: true,
    deskLocation: "Shop floor office",
    notes: "Needs safety glasses on the first day.",
    itTicketNumber: "",
    itTicketLink: "",
    steps: steps({}),
    cancelled: null,
    submittedBy: HR_PERSON,
    createdAt: ago(1),
    modifiedAt: ago(1),
  },
  {
    id: 2,
    displayName: "Robin Starter",
    startDate: dayFromToday(5),
    legalFirstName: "Robert",
    preferredFirstName: "Robin",
    lastName: "Starter",
    email: "Robin.Starter@altronic-llc.com",
    jobTitle: "Design Engineer",
    fabNumber: "F-1001",
    personalNumber: "",
    empNumber: "900101",
    employmentType: "Intern",
    department: "Engineering",
    manager: MANAGER_B,
    needsComputer: true,
    deskLocation: "Engineering, desk 4",
    notes: "",
    itTicketNumber: "IT-0001",
    itTicketLink: "https://example.com/tickets/IT-0001",
    steps: steps({
      addedToSap: { at: ago(3), by: SAP_PERSON },
      itTicketRaised: { at: ago(2), by: IT_PERSON },
    }),
    cancelled: null,
    submittedBy: HR_PERSON,
    createdAt: ago(6),
    modifiedAt: ago(2),
  },
  {
    id: 3,
    displayName: "Morgan Joiner",
    startDate: dayFromToday(-10),
    legalFirstName: "Morgan",
    preferredFirstName: "",
    lastName: "Joiner",
    email: "Morgan.Joiner@altronic-llc.com",
    jobTitle: "Buyer",
    fabNumber: "F-1002",
    personalNumber: "",
    empNumber: "900102",
    employmentType: "Permanent",
    department: "Supply Chain",
    manager: MANAGER_A,
    needsComputer: true,
    deskLocation: "Purchasing office",
    notes: "",
    itTicketNumber: "IT-0002",
    itTicketLink: "https://example.com/tickets/IT-0002",
    steps: steps({
      addedToSap: { at: ago(30), by: SAP_PERSON },
      itTicketRaised: { at: ago(29), by: IT_PERSON },
      itAccountCreated: { at: ago(20), by: IT_PERSON },
      computerSetUp: { at: ago(12), by: IT_PERSON },
    }),
    cancelled: null,
    submittedBy: HR_PERSON,
    createdAt: ago(32),
    modifiedAt: ago(12),
  },
  {
    id: 4,
    displayName: "Drew Contractor",
    startDate: dayFromToday(21),
    legalFirstName: "Andrew",
    preferredFirstName: "Drew",
    lastName: "Contractor",
    email: "Drew.Contractor@altronic-llc.com",
    jobTitle: "Electrician",
    fabNumber: "",
    personalNumber: "",
    empNumber: "",
    employmentType: "Contractor",
    department: "Operations",
    manager: MANAGER_B,
    needsComputer: false,
    deskLocation: "n/a",
    notes: "Badge access only — no computer.",
    itTicketNumber: "",
    itTicketLink: "",
    steps: steps({ addedToSap: { at: ago(1), by: SAP_PERSON } }),
    cancelled: null,
    submittedBy: HR_PERSON,
    createdAt: ago(2),
    modifiedAt: ago(1),
  },
  {
    id: 5,
    displayName: "Alex Withdrawn",
    startDate: dayFromToday(3),
    legalFirstName: "Alex",
    preferredFirstName: "",
    lastName: "Withdrawn",
    email: "Alex.Withdrawn@altronic-llc.com",
    jobTitle: "Customer Service Representative",
    fabNumber: "",
    personalNumber: "",
    empNumber: "",
    employmentType: "Permanent",
    department: "Customer Service / Sales",
    manager: MANAGER_A,
    needsComputer: true,
    deskLocation: "Front office",
    notes: "",
    itTicketNumber: "",
    itTicketLink: "",
    steps: steps({}),
    cancelled: { at: ago(4), by: HR_PERSON, reason: "Offer declined." },
    submittedBy: HR_PERSON,
    createdAt: ago(9),
    modifiedAt: ago(4),
  },
  {
    // Tim, at his request — see the header. Found in SAP by NAME (no EMP # yet).
    id: 6,
    displayName: "Tim Webster",
    startDate: dayFromToday(10),
    legalFirstName: "Tim",
    preferredFirstName: "",
    lastName: "Webster",
    email: "Tim.Webster@altronic-llc.com",
    jobTitle: "Business IT",
    fabNumber: "",
    personalNumber: "",
    empNumber: "",
    employmentType: "Permanent",
    department: "Business IT",
    manager: MANAGER_B,
    needsComputer: true,
    deskLocation: "",
    notes: "Demo row — the SAP check should find this one.",
    itTicketNumber: "",
    itTicketLink: "",
    steps: steps({}),
    cancelled: null,
    submittedBy: HR_PERSON,
    createdAt: ago(1),
    modifiedAt: ago(1),
  },
];

/**
 * SAP's employee list, as the demo's Fabric stand-in — the shape of
 * `dbo.tbl_arc_employee`, every number invented. Robin and Morgan are found by
 * their EMP number; Andrew ("Drew") Contractor and Tim Webster by name; Taylor
 * Newman isn't in SAP yet.
 */
export const MOCK_SAP_EMPLOYEES = [
  { EMPLOYEE_NUMBER: "900101", EMPLOYEE_NAME: "Robert Starter", FIRST_NAME: "Robert", LAST_NAME: "Starter" },
  { EMPLOYEE_NUMBER: "900102", EMPLOYEE_NAME: "Morgan Joiner", FIRST_NAME: "Morgan", LAST_NAME: "Joiner" },
  { EMPLOYEE_NUMBER: "900103", EMPLOYEE_NAME: "Tim Webster", FIRST_NAME: "Tim", LAST_NAME: "Webster" },
  { EMPLOYEE_NUMBER: "900104", EMPLOYEE_NAME: "Andrew Contractor", FIRST_NAME: "Andrew", LAST_NAME: "Contractor" },
  { EMPLOYEE_NUMBER: "900200", EMPLOYEE_NAME: "Jordan Manager", FIRST_NAME: "Jordan", LAST_NAME: "Manager" },
];

export function mockNewHires(): NewHire[] {
  return SEEDS.map((s) => ({ ...s, steps: { ...s.steps }, status: newHireStatus(s) }));
}
