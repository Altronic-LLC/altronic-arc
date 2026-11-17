import {
  EMPLOYMENT_TYPES,
  NEW_HIRE_STEPS,
  type EmploymentType,
  type NewHire,
  type NewHireInput,
  type NewHireStep,
  type StepStamp,
} from "@/types/hr";
import type { GraphListItem, Person } from "@/types/task";
import { parsePeopleLines, serializePeopleLines } from "./peopleLines";
import { fromDateInputValue, parseSpDate, parseSpDateOnly, toDateInputValue, toSpDateOnly } from "./spDates";
import { displayNameFor, newHireStatus } from "./newHire";

// =============================================================================
// Graph item ⇄ NewHire. The internal names below ARE the contract with
// scripts/create-hr-lists.ps1, which creates the list with these names.
//
// Three choices that are deliberate:
//   * **The manager and every "who ticked it" are plain text** ("Name <email>",
//     lib/peopleLines.ts), not person columns. A person column needs a
//     lookupId resolved on the HR site — which doesn't exist yet — and drops
//     anybody it can't resolve. Text keeps who it was, and reads in
//     SharePoint's own views.
//   * **The ticket link is TEXT, not a Hyperlink column.** Graph cannot write
//     a Hyperlink column at all (CLAUDE.md, "Hyperlink columns").
//   * **Start date is a date-only column** written at midday UTC and read back
//     as its calendar day (the spDates rule), held as `yyyy-mm-dd`.
// =============================================================================

export const NEW_HIRE_COLUMNS = {
  displayName: "Title",
  startDate: "StartDate",
  legalFirstName: "LegalFirstName",
  preferredFirstName: "PreferredFirstName",
  lastName: "LastName",
  email: "WorkEmail",
  jobTitle: "JobTitle",
  fabNumber: "FabNumber",
  personalNumber: "PersonalNumber",
  empNumber: "EmpNumber",
  employmentType: "EmploymentType",
  department: "Department",
  manager: "Manager",
  needsComputer: "NeedsComputer",
  deskLocation: "DeskLocation",
  notes: "Notes",
  itTicketNumber: "ItTicketNumber",
  itTicketLink: "ItTicketLink",
  status: "Status",
  cancelledAt: "CancelledAt",
  cancelledBy: "CancelledBy",
  cancelReason: "CancelReason",
} as const;

/** Each step's two columns: when, and who ("Name <email>"). */
export const NEW_HIRE_STEP_COLUMNS: Record<NewHireStep, { at: string; by: string }> = {
  addedToSap: { at: "AddedToSapAt", by: "AddedToSapBy" },
  itTicketRaised: { at: "ItTicketRaisedAt", by: "ItTicketRaisedBy" },
  itAccountCreated: { at: "ItAccountCreatedAt", by: "ItAccountCreatedBy" },
  computerSetUp: { at: "ComputerSetUpAt", by: "ComputerSetUpBy" },
};

export const NEW_HIRE_SELECT = [
  ...Object.values(NEW_HIRE_COLUMNS),
  ...Object.values(NEW_HIRE_STEP_COLUMNS).flatMap((c) => [c.at, c.by]),
].join(",");

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
}

function personLine(raw: unknown): Person | null {
  return parsePeopleLines(raw)[0] ?? null;
}

export function personToLine(person: Person | null): string {
  return person ? serializePeopleLines([person]) : "";
}

function toEmploymentType(raw: unknown): EmploymentType | null {
  const v = text(raw).trim().toLowerCase();
  return EMPLOYMENT_TYPES.find((t) => t.toLowerCase() === v) ?? null;
}

function toBoolean(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  return null;
}

/** A date-only column → `yyyy-mm-dd`, by the midday pivot (lib/spDates.ts). */
function toDateOnly(raw: unknown): string {
  return toDateInputValue(parseSpDateOnly(raw));
}

/** `yyyy-mm-dd` → the column's midday-UTC value, or null to clear. */
export function toSpStartDate(value: string): string | null {
  return toSpDateOnly(fromDateInputValue(value));
}

function stamp(at: unknown, by: unknown): StepStamp | null {
  const when = parseSpDate(at);
  if (!when) return null;
  return { at: when, by: personLine(by) ?? { displayName: "Someone" } };
}

type GraphItemWithMeta = Pick<GraphListItem, "id"> & {
  fields?: Record<string, unknown>;
  createdBy?: { user?: { displayName?: string; email?: string } };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
};

export function toNewHire(item: GraphItemWithMeta): NewHire {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  const c = NEW_HIRE_COLUMNS;
  const steps = Object.fromEntries(
    NEW_HIRE_STEPS.map((s) => [s, stamp(f[NEW_HIRE_STEP_COLUMNS[s].at], f[NEW_HIRE_STEP_COLUMNS[s].by])]),
  ) as Record<NewHireStep, StepStamp | null>;
  const cancelledAt = parseSpDate(f[c.cancelledAt]);
  const base = {
    id: parseInt(item.id, 10),
    startDate: toDateOnly(f[c.startDate]),
    legalFirstName: text(f[c.legalFirstName]),
    preferredFirstName: text(f[c.preferredFirstName]),
    lastName: text(f[c.lastName]),
    email: text(f[c.email]),
    jobTitle: text(f[c.jobTitle]),
    fabNumber: text(f[c.fabNumber]),
    personalNumber: text(f[c.personalNumber]),
    empNumber: text(f[c.empNumber]),
    employmentType: toEmploymentType(f[c.employmentType]),
    department: text(f[c.department]),
    manager: personLine(f[c.manager]),
    needsComputer: toBoolean(f[c.needsComputer]),
    deskLocation: text(f[c.deskLocation]),
    notes: text(f[c.notes]),
    itTicketNumber: text(f[c.itTicketNumber]),
    itTicketLink: text(f[c.itTicketLink]),
    steps,
    cancelled: cancelledAt
      ? { at: cancelledAt, by: personLine(f[c.cancelledBy]) ?? { displayName: "Someone" }, reason: text(f[c.cancelReason]) }
      : null,
  };
  const user = item.createdBy?.user;
  const hire: NewHire = {
    ...base,
    displayName: text(f[c.displayName]).trim() || displayNameFor(base),
    status: "Submitted",
    submittedBy: user?.displayName || user?.email ? { displayName: user.displayName || user.email || "", email: user.email } : null,
    createdAt: parseSpDate(item.createdDateTime),
    modifiedAt: parseSpDate(item.lastModifiedDateTime),
  };
  // Status is DERIVED, never trusted from the column — a hand edit in
  // SharePoint can't make the screen disagree with the steps.
  return { ...hire, status: newHireStatus(hire) };
}

/** The columns for the input keys given. Display name follows the names. */
export function newHireInputFields(patch: Partial<NewHireInput>, merged: NewHireInput): Record<string, unknown> {
  const c = NEW_HIRE_COLUMNS;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch) as [keyof NewHireInput, unknown][]) {
    switch (key) {
      case "startDate":
        out[c.startDate] = toSpStartDate(value as string);
        break;
      case "manager":
        out[c.manager] = personToLine(value as Person | null);
        break;
      case "needsComputer":
      case "employmentType":
        out[c[key]] = value ?? null;
        break;
      default:
        out[c[key]] = typeof value === "string" ? value.trim() : value;
    }
  }
  if ("legalFirstName" in patch || "preferredFirstName" in patch || "lastName" in patch) {
    out[c.displayName] = displayNameFor(merged);
  }
  return out;
}

/** One step's two columns — set to now / the actor, or cleared. */
export function stepFields(step: NewHireStep, value: StepStamp | null): Record<string, unknown> {
  const cols = NEW_HIRE_STEP_COLUMNS[step];
  return { [cols.at]: value ? value.at.toISOString() : null, [cols.by]: value ? personToLine(value.by) : "" };
}
