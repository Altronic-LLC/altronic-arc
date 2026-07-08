import type { Person } from "@/types/task";
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
}

/** What the change is on — drives the noun ("task"/"EIR") in the copy. */
export interface ChangeTarget {
  kind: "task" | "eir";
  id: number;
  title: string;
}

function nounFor(target: ChangeTarget): string {
  return target.kind === "eir" ? "EIR" : "task";
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
 * Alerts for an assignee change.
 *
 * - Each newly ADDED person gets a personal "You've been assigned…" email.
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

  for (const p of added) {
    const email = p.email?.trim();
    if (!email || email.toLowerCase() === actorEmail) continue;
    personalEmails.add(email.toLowerCase());
    emails.push({
      email,
      displayName: p.displayName,
      subject: `You've been assigned to ${args.target.title}`,
      headlineHtml: `<strong>${actorName}</strong> assigned you to this ${noun}.`,
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
