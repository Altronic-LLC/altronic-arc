import {
  NEW_HIRE_STEPS,
  type NewHire,
  type NewHireInput,
  type NewHireStatus,
  type NewHireStep,
} from "@/types/hr";
import { parseIsoDate, toIsoDate } from "./dateInput";

// =============================================================================
// The New Hire rules (pure) — the name and email a hire gets, which kick-off
// steps apply, what the status is, and what a submission needs. Replaces the
// HR spreadsheet's "calculated" columns (Display Name, Email, Manager Email).
// =============================================================================

/** The company domain a new hire's address is made on. */
export const NEW_HIRE_EMAIL_DOMAIN = "altronic-llc.com";

/** The first name people use: preferred if there is one, else legal. */
export function firstNameFor(input: Pick<NewHireInput, "legalFirstName" | "preferredFirstName">): string {
  return input.preferredFirstName.trim() || input.legalFirstName.trim();
}

/** "Davey Jones" — the spreadsheet's Display Name. */
export function displayNameFor(
  input: Pick<NewHireInput, "legalFirstName" | "preferredFirstName" | "lastName">,
): string {
  return [firstNameFor(input), input.lastName.trim()].filter(Boolean).join(" ");
}

/** A name as an address part: accents dropped, only letters, digits and hyphens kept. */
function addressPart(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]/g, "");
}

/**
 * "Davey.Jones@altronic-llc.com" — the spreadsheet's calculated Email, from the
 * preferred (else legal) first name, as typed. Blank until both names exist.
 * It is a SUGGESTION: the form fills it in until somebody types in the box,
 * since two people can share a name and IT decides the real address.
 */
export function defaultNewHireEmail(
  input: Pick<NewHireInput, "legalFirstName" | "preferredFirstName" | "lastName">,
): string {
  const first = addressPart(firstNameFor(input));
  const last = addressPart(input.lastName.trim());
  if (!first || !last) return "";
  return `${first}.${last}@${NEW_HIRE_EMAIL_DOMAIN}`;
}

export function looksLikeAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * The kick-off steps that apply to this hire, in order. Computer set up drops
 * out only when the answer is a definite No — an unanswered question might
 * still need a computer.
 */
export function applicableSteps(hire: Pick<NewHire, "needsComputer">): NewHireStep[] {
  return NEW_HIRE_STEPS.filter((s) => s !== "computerSetUp" || hire.needsComputer !== false);
}

export function stepProgress(hire: Pick<NewHire, "needsComputer" | "steps">): { done: number; total: number } {
  const steps = applicableSteps(hire);
  return { done: steps.filter((s) => hire.steps[s] !== null).length, total: steps.length };
}

/**
 * Cancelled wins; then Complete once every applicable step is ticked; In
 * progress once any is; else Submitted.
 */
export function newHireStatus(hire: Pick<NewHire, "needsComputer" | "steps" | "cancelled">): NewHireStatus {
  if (hire.cancelled) return "Cancelled";
  const { done, total } = stepProgress(hire);
  if (done === total) return "Complete";
  if (done > 0) return "In progress";
  return "Submitted";
}

export function isOpenNewHire(hire: Pick<NewHire, "status">): boolean {
  return hire.status === "Submitted" || hire.status === "In progress";
}

/** The fields a new hire can't be submitted without, by label — empty when ready. */
export function missingForSubmit(input: NewHireInput): string[] {
  const missing: string[] = [];
  if (!input.startDate) missing.push("Start date");
  if (!input.legalFirstName.trim()) missing.push("Legal first name");
  if (!input.lastName.trim()) missing.push("Last name");
  if (!input.email.trim()) missing.push("Email");
  else if (!looksLikeAddress(input.email)) missing.push("A valid email");
  if (!input.jobTitle.trim()) missing.push("Job title");
  if (!input.employmentType) missing.push("Permanent / Intern / Contractor");
  if (!input.department.trim()) missing.push("Department");
  if (!input.manager?.email) missing.push("Manager");
  if (input.needsComputer === null) missing.push("Computer");
  return missing;
}

/**
 * "Starts in 5 days", "Starts today", "Started 3 days ago" — counted in LOCAL
 * days, since a start date is a calendar day, not an instant.
 */
export function startLabel(startDate: string, today: Date): string {
  const start = parseIsoDate(startDate);
  if (!start) return "";
  const todayDay = parseIsoDate(toIsoDate(today));
  if (!todayDay) return "";
  const days = Math.round((start.getTime() - todayDay.getTime()) / 86_400_000);
  if (days === 0) return "Starts today";
  if (days === 1) return "Starts tomorrow";
  if (days > 1) return `Starts in ${days} days`;
  if (days === -1) return "Started yesterday";
  return `Started ${-days} days ago`;
}

/** "Mar 1, 2026" for a date-only value, or "". */
export function startDateLabel(startDate: string): string {
  const d = parseIsoDate(startDate);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

/** Only `http(s)` links are opened — a typed ticket link is otherwise shown as text. */
export function safeTicketLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function emptyNewHireInput(): NewHireInput {
  return {
    startDate: "",
    legalFirstName: "",
    preferredFirstName: "",
    lastName: "",
    email: "",
    jobTitle: "",
    fabNumber: "",
    personalNumber: "",
    empNumber: "",
    employmentType: null,
    department: "",
    manager: null,
    needsComputer: null,
    deskLocation: "",
    notes: "",
    itTicketNumber: "",
    itTicketLink: "",
  };
}

/** The input half of a record — what the form edits. */
export function inputOf(hire: NewHire): NewHireInput {
  const out = emptyNewHireInput();
  for (const key of Object.keys(out) as (keyof NewHireInput)[]) {
    (out as unknown as Record<string, unknown>)[key] = hire[key];
  }
  return out;
}

/**
 * The keys of `next` that differ from `prev` — only these are written, so a
 * save never re-sends a value nobody touched.
 */
export function changedNewHireFields(prev: NewHireInput, next: NewHireInput): Partial<NewHireInput> {
  const out: Partial<NewHireInput> = {};
  for (const key of Object.keys(next) as (keyof NewHireInput)[]) {
    const a = prev[key];
    const b = next[key];
    const same =
      key === "manager"
        ? (prev.manager?.email ?? "").toLowerCase() === (next.manager?.email ?? "").toLowerCase()
        : typeof a === "string" && typeof b === "string"
          ? a.trim() === b.trim()
          : a === b;
    if (!same) (out as Record<string, unknown>)[key] = b;
  }
  return out;
}

/** Suggested departments — the field is free text, so a new one can be typed. */
export const NEW_HIRE_DEPARTMENT_SUGGESTIONS = [
  "Coils",
  "Customer Service / Sales",
  "Engineering",
  "Finance",
  "Harness",
  "Human Resources",
  "IT",
  "Operations",
  "Panels",
  "Quality Control",
  "Supply Chain",
] as const;
