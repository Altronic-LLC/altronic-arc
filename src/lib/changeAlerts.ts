import type { Person } from "@/types/task";
import { looksLikeHtml, parseChecklistItems } from "./descriptionChecklist";
import { htmlToPlainText } from "./htmlText";
import { escapeHtml } from "./mentions";

// =============================================================================
// Change-alert email construction (pure, testable).
//
// When a task/EIR changes in a notify-worthy way (status, EIR resolution, or
// assignees), we email the people who care — watchers, current assignees, and
// (for EIRs) the reporter — MINUS the person who made the change. Assignee
// changes additionally send a personal note to whoever was added/removed.
//
// These builders produce a flat list of `ChangeEmail` records; the actual
// send + HTML rendering lives in src/api/email.ts. Keeping the recipient math
// and wording here means it can be unit-tested without touching Graph.
// =============================================================================

/**
 * One "field: value" line on an intake-style alert, when the value is known.
 * Shared by grayMarketAlerts.ts and faitAlerts.ts so a new intake queue
 * doesn't redeclare the same shape.
 */
export interface AlertDetail {
  label: string;
  value: string;
}

/** One rendered-ready alert: who gets it, the subject, and the body pieces. */
export interface ChangeEmail {
  email: string;
  displayName: string;
  /** Plain-text subject line. */
  subject: string;
  /** Intro sentence as trusted HTML (dynamic parts already escaped here). */
  headlineHtml: string;
  /** Optional detail block as trusted HTML (e.g. "Open → Closed"). */
  detailHtml?: string;
  /**
   * Optional answer buttons, each a link to the item's page with `query`
   * appended (`sap=added`). A LINK, never a one-click write: ARC has no server
   * to receive a click, and mail scanners follow links on their own — so the
   * page opens with the answer picked and the person confirms it there.
   */
  actions?: EmailAction[];
}

export interface EmailAction {
  label: string;
  /** Appended to the item's URL, without the "?". */
  query: string;
}

/** What the change is on — drives the noun ("task"/"EIR"/…) in the copy. */
export interface ChangeTarget {
  kind:
    | "task"
    | "eir"
    | "operationsTask"
    | "maintenanceTask"
    | "buildRequest"
    | "buildRequestItem"
    | "panelOrder"
    | "panelTask"
    | "grayMarketRequest"
    | "fait"
    | "costImpactNotice"
    | "featureRequest"
    | "altronicPart"
    | "altronicComponent";
  id: number;
  title: string;
}

const NOUNS: Record<ChangeTarget["kind"], string> = {
  task: "task",
  eir: "EIR",
  operationsTask: "task",
  maintenanceTask: "work order",
  buildRequest: "build request",
  buildRequestItem: "build request part",
  panelOrder: "panel order",
  panelTask: "panel task",
  grayMarketRequest: "gray market request",
  fait: "FAIT",
  costImpactNotice: "cost impact notice",
  featureRequest: "feature request",
  altronicPart: "part",
  altronicComponent: "component",
};

function nounFor(target: ChangeTarget): string {
  return NOUNS[target.kind];
}

function keyOf(p: Person): string {
  return (p.email ?? p.displayName).toLowerCase();
}

/**
 * Dedupe a set of people by lowercase email, dropping anyone without an email
 * and the actor. Returns entries guaranteed to have an `email`.
 */
function dedupeMailable(
  people: Array<Person | null | undefined>,
  actorEmail: string,
): Array<Person & { email: string }> {
  const map = new Map<string, Person & { email: string }>();
  for (const p of people) {
    const email = p?.email?.trim();
    if (!p || !email) continue;
    const key = email.toLowerCase();
    if (key === actorEmail) continue;
    if (!map.has(key)) map.set(key, { ...p, email });
  }
  return [...map.values()];
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Alerts for a single-value field change (Status, or EIR Resolution).
 *
 * Recipients = watchers + assignees (+ reporter for EIRs), deduped, minus the
 * actor. Returns [] when the value didn't actually change or nobody's left to
 * notify. `fieldLabel` is lower-case ("status" / "resolution").
 */
export function buildFieldChangeEmails(args: {
  target: ChangeTarget;
  fieldLabel: string;
  from: string;
  to: string;
  actor: Person;
  watchers: Person[];
  assignees: Person[];
  reporter?: Person | null;
}): ChangeEmail[] {
  const from = (args.from ?? "").trim();
  const to = (args.to ?? "").trim();
  if (from === to) return [];

  const actorEmail = (args.actor.email ?? "").toLowerCase();
  const recipients = dedupeMailable(
    [...args.watchers, ...args.assignees, args.reporter ?? null],
    actorEmail,
  );
  if (recipients.length === 0) return [];

  const noun = nounFor(args.target);
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const label = escapeHtml(args.fieldLabel);
  const fromHtml = escapeHtml(from || "—");
  const toHtml = escapeHtml(to || "—");

  return recipients.map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `${capitalize(args.fieldLabel)} changed on ${args.target.title}`,
    headlineHtml: `<strong>${actorName}</strong> changed the ${label} of this ${noun}.`,
    detailHtml: `<div style="font-size:14px;">${fromHtml} &rarr; <strong>${toHtml}</strong></div>`,
  }));
}

/**
 * Alerts for Description-checklist toggles (a box was checked or unchecked).
 *
 * Recipients = watchers + assignees ONLY, deduped, minus the actor. (No
 * reporter — checklist ticks are working detail, tighter audience than a
 * status change.) `toggles` carries each item's text and its NEW checked
 * state; returns [] when there's nothing to report or nobody left to notify.
 */
export function buildChecklistToggleEmails(args: {
  target: ChangeTarget;
  toggles: Array<{ text: string; checked: boolean }>;
  actor: Person;
  watchers: Person[];
  assignees: Person[];
}): ChangeEmail[] {
  if (args.toggles.length === 0) return [];

  const actorEmail = (args.actor.email ?? "").toLowerCase();
  const recipients = dedupeMailable([...args.watchers, ...args.assignees], actorEmail);
  if (recipients.length === 0) return [];

  const noun = nounFor(args.target);
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const single = args.toggles.length === 1 ? args.toggles[0] : null;
  const headlineHtml = single
    ? `<strong>${actorName}</strong> ${single.checked ? "checked off" : "unchecked"} a checklist item on this ${noun}.`
    : `<strong>${actorName}</strong> updated the checklist on this ${noun}.`;
  const detailHtml = args.toggles
    .map(
      (t) =>
        `<div style="font-size:14px;">${t.checked ? "✓ Checked" : "✗ Unchecked"}: <strong>${escapeHtml(t.text || "(empty item)")}</strong></div>`,
    )
    .join("");

  return recipients.map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `Checklist updated on ${args.target.title}`,
    headlineHtml,
    detailHtml,
  }));
}

/**
 * What the personal "You've been assigned" email says about the work itself,
 * so the assignee can judge urgency and context without opening the link
 * (David Markovitch, BusinessIT #5 / #6). Engineering tasks only for now —
 * every other caller omits it and its email is unchanged.
 */
export interface AssignmentDetails {
  dueDate: Date | null;
  /** The raw stored Description — HTML or plain text, checklists included. */
  description: string;
}

/**
 * Longest description excerpt an assignment email carries. Long enough for a
 * normal task's context; a multi-page spec stops here rather than burying
 * the Open button under it.
 */
export const ASSIGNMENT_DESCRIPTION_MAX_CHARS = 600;

function formatDueDate(d: Date | null): string {
  // Local getters, as the task page reads it — the sender's browser builds the
  // email, and that's the same day the sender sees on screen.
  if (!d || Number.isNaN(d.getTime())) return "No due date";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * A description as readable plain text for an email: HTML stripped, and each
 * `- [ ]` / `- [x]` checklist line shown as a box with its who/when stamp
 * dropped (the stamp is working detail, not context). Capped at
 * ASSIGNMENT_DESCRIPTION_MAX_CHARS on a word boundary, ending "…".
 */
export function assignmentDescriptionExcerpt(description: string): string {
  const raw = description ?? "";
  // A plain description goes through as typed: htmlToPlainText's tag strip
  // would eat "< 5V … >" out of ordinary prose.
  const plain = looksLikeHtml(raw) ? htmlToPlainText(raw) : raw.trim();
  if (!plain) return "";

  const lines = plain.split("\n");
  for (const item of parseChecklistItems(plain) ?? []) {
    lines[item.lineIndex] =
      `${item.depth === 1 ? "    " : ""}${item.checked ? "☑" : "☐"} ${item.text.trim()}`;
  }
  const text = lines.join("\n").trim();
  if (text.length <= ASSIGNMENT_DESCRIPTION_MAX_CHARS) return text;

  const cut = text.slice(0, ASSIGNMENT_DESCRIPTION_MAX_CHARS);
  const lastBreak = cut.search(/\s\S*$/);
  // No whitespace in the back half means one enormous word — cut it mid-word
  // rather than throwing most of the excerpt away.
  const end = lastBreak > ASSIGNMENT_DESCRIPTION_MAX_CHARS / 2 ? lastBreak : cut.length;
  return `${cut.slice(0, end).trimEnd()}…`;
}

function assignmentDetailHtml(details: AssignmentDetails): string {
  const due = `<div style="font-size:14px;"><strong>Due:</strong> ${escapeHtml(formatDueDate(details.dueDate))}</div>`;
  const excerpt = assignmentDescriptionExcerpt(details.description);
  if (!excerpt) return due;
  return (
    due +
    `<div style="font-size:14px;margin-top:12px;"><strong>Description</strong></div>` +
    `<div style="font-size:14px;margin-top:4px;">${escapeHtml(excerpt).replace(/\n/g, "<br/>")}</div>`
  );
}

/**
 * Alerts for an assignee change.
 *
 * - Each newly ADDED person gets a personal "You've been assigned…" email,
 *   carrying the due date and description when `details` is passed.
 * - Each REMOVED person gets a personal "You've been unassigned…" email.
 * - Everyone else who cares (watchers + remaining assignees + reporter) gets a
 *   broadcast summarising what changed.
 *
 * The actor is excluded throughout; people who receive a personal email are not
 * also sent the broadcast. Returns [] when nothing actually changed.
 */
export function buildAssigneeChangeEmails(args: {
  target: ChangeTarget;
  prev: Person[];
  next: Person[];
  actor: Person;
  watchers: Person[];
  reporter?: Person | null;
  details?: AssignmentDetails;
}): ChangeEmail[] {
  const prevKeys = new Set(args.prev.map(keyOf));
  const nextKeys = new Set(args.next.map(keyOf));
  const added = args.next.filter((p) => !prevKeys.has(keyOf(p)));
  const removed = args.prev.filter((p) => !nextKeys.has(keyOf(p)));
  if (added.length === 0 && removed.length === 0) return [];

  const actorEmail = (args.actor.email ?? "").toLowerCase();
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const noun = nounFor(args.target);

  const emails: ChangeEmail[] = [];
  // Emails handled personally — excluded from the broadcast to avoid doubles.
  const personalEmails = new Set<string>();
  const assignedDetailHtml = args.details ? assignmentDetailHtml(args.details) : undefined;

  for (const p of added) {
    const email = p.email?.trim();
    if (!email || email.toLowerCase() === actorEmail) continue;
    personalEmails.add(email.toLowerCase());
    emails.push({
      email,
      displayName: p.displayName,
      subject: `You've been assigned to ${args.target.title}`,
      headlineHtml: `<strong>${actorName}</strong> assigned you to this ${noun}.`,
      detailHtml: assignedDetailHtml,
    });
  }
  for (const p of removed) {
    const email = p.email?.trim();
    if (!email || email.toLowerCase() === actorEmail) continue;
    personalEmails.add(email.toLowerCase());
    emails.push({
      email,
      displayName: p.displayName,
      subject: `You've been unassigned from ${args.target.title}`,
      headlineHtml: `<strong>${actorName}</strong> removed you from this ${noun}.`,
    });
  }

  const broadcast = dedupeMailable(
    [...args.watchers, ...args.next, args.reporter ?? null],
    actorEmail,
  ).filter((p) => !personalEmails.has(p.email.toLowerCase()));

  if (broadcast.length > 0) {
    const parts: string[] = [];
    if (added.length) {
      parts.push(
        `added ${added.map((p) => `<strong>${escapeHtml(p.displayName)}</strong>`).join(", ")}`,
      );
    }
    if (removed.length) {
      parts.push(
        `removed ${removed.map((p) => `<strong>${escapeHtml(p.displayName)}</strong>`).join(", ")}`,
      );
    }
    const detail = parts.join("; ");
    for (const p of broadcast) {
      emails.push({
        email: p.email,
        displayName: p.displayName,
        subject: `Assignees changed on ${args.target.title}`,
        headlineHtml: `<strong>${actorName}</strong> updated the assignees on this ${noun}.`,
        detailHtml: detail ? `<div style="font-size:14px;">${detail}</div>` : undefined,
      });
    }
  }

  return emails;
}

/**
 * Alerts for promoting an EIR to a task. Recipients = the EIR's watchers +
 * reporter (minus the actor). The email links to the NEW TASK — callers send
 * these with a task-kind target so the callout + button open the task.
 *
 * `eirLabel` is the EIR number (or "EIR #id"); it appears in the copy so
 * recipients know which EIR spawned the task.
 */
export function buildPromotionEmails(args: {
  eirLabel: string;
  watchers: Person[];
  reporter?: Person | null;
  actor: Person;
}): ChangeEmail[] {
  const actorEmail = (args.actor.email ?? "").toLowerCase();
  const recipients = dedupeMailable([...args.watchers, args.reporter ?? null], actorEmail);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const eir = escapeHtml(args.eirLabel);
  return recipients.map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `${args.eirLabel} was promoted to a task`,
    headlineHtml: `<strong>${actorName}</strong> promoted EIR <strong>${eir}</strong> to a task.`,
    detailHtml:
      '<div style="font-size:14px;">A task has been created to carry this work forward — open it below.</div>',
  }));
}
