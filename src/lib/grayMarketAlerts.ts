import type { GrayMarketRequest, Person } from "@/types/task";
import { GRAY_MARKET_FIELDS, type GrayMarketSection } from "./grayMarketFields";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { AlertDetail, ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// Gray Market intake alert — telling the people who work the queue that a new
// request exists.
//
// Nothing watches the list itself, so a raised request used to sit until
// somebody opened ARC and noticed it (Ray, 2026-08-23). Every create now
// emails the configured intake list (GRAY_MARKET_NEW_REQUEST_ALERTS).
//
// This is an INTAKE queue, not the watcher mechanism: the recipients are
// config rather than the request's Watchers column, they're notified whoever
// raised it, and being on it doesn't make them watchers — later comments and
// changes still follow the normal watcher rules. Someone who wants the rest of
// the thread presses Watch on the request.
//
// Pure and email-shaped like changeAlerts.ts / eirTriage.ts: it returns
// ChangeEmail[] so the wording is unit-testable without touching Graph.
// =============================================================================

/**
 * Build the new-request email for everyone on the intake list.
 *
 * The actor is left off their own request unless that would leave nobody —
 * the same rule as EIR triage, and for the same reason: a queue going quiet
 * because the only person on it raised the request is worse than one
 * redundant email.
 *
 * `details` are rendered as a small list under the headline, blanks dropped.
 * A new request is mostly empty by design (purchasing, engineering and
 * inspection fill their own stages in later), so the email says what IS known
 * rather than a grid of dashes.
 */
export function buildNewGrayMarketRequestEmails(args: {
  target: ChangeTarget;
  /** Configured intake list — who picks a new request up. */
  recipients: Person[];
  /** Who raised it. */
  actor: Person;
  details?: AlertDetail[];
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const rows = (args.details ?? [])
    .filter((d) => d.value.trim())
    .map(
      (d) =>
        `<div style="font-size:14px;">${escapeHtml(d.label)}: ` +
        `<strong>${escapeHtml(d.value.trim())}</strong></div>`,
    )
    .join("");

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `New gray market request: ${args.target.title}`,
    headlineHtml:
      `<strong>${actorName}</strong> raised a new gray market request. ` +
      `<strong>Please pick it up.</strong>`,
    detailHtml:
      `${rows}<div style="font-size:14px;margin-top:6px;">Testing Required is ` +
      `decided later, so it may still be blank. Press <strong>Watch</strong> on ` +
      `the request to follow its comments and changes.</div>`,
  }));
}

// =============================================================================
// Field-change alert — Testing Required, and anything on the Engineering or
// Production cards (Katie Fleming via BusinessIT#20, 2026-10-06: "any changes
// in these sections, at minimum, Alex needs notified").
//
// Two audiences, two actor rules — the Build Request hand-off arrangement:
// - the configured list (GRAY_MARKET_CHANGE_ALERTS) is a work queue, so the
//   actor is dropped only if somebody else is left (withoutActorUnlessEmpty);
// - the request's WATCHERS are a notification, so the actor is dropped
//   strictly — telling someone about their own edit isn't news.
// Everyone is de-duped by lower-cased email, so a person on both gets one.
// =============================================================================

/** One watched field that moved, as the email shows it. */
export interface GrayMarketFieldChange {
  label: string;
  from: string;
  to: string;
}

/** Which fields trigger the alert: Testing Required + two whole cards. */
const ALERT_SECTIONS: readonly GrayMarketSection[] = ["Engineering", "Production"];

/**
 * The watched fields that differ between two versions of a request.
 *
 * Compares the ROWS, not the PATCH, so it can't be fooled by what a caller
 * chose to send: a card re-saved with the same values reports nothing, and a
 * field moved by any route is caught. Whitespace-only differences don't count.
 */
export function grayMarketAlertChanges(
  before: GrayMarketRequest,
  after: GrayMarketRequest,
): GrayMarketFieldChange[] {
  const out: GrayMarketFieldChange[] = [];
  const push = (label: string, from: string | undefined, to: string | undefined) => {
    const a = (from ?? "").trim();
    const b = (to ?? "").trim();
    if (a !== b) out.push({ label, from: a, to: b });
  };
  push("Testing Required", before.testingRequired, after.testingRequired);
  for (const f of GRAY_MARKET_FIELDS) {
    if (!ALERT_SECTIONS.includes(f.section)) continue;
    push(f.label, before.values[f.key], after.values[f.key]);
  }
  return out;
}

/** Long free text is clipped in the email; the full value is a click away. */
const MAX_VALUE_CHARS = 300;

function shown(value: string): string {
  if (!value) return "<em>blank</em>";
  const clipped =
    value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value;
  return `<strong>${escapeHtml(clipped)}</strong>`;
}

export function buildGrayMarketFieldChangeEmails(args: {
  target: ChangeTarget;
  changes: GrayMarketFieldChange[];
  /** Configured list — who must hear about these changes (Alex). */
  alertList: Person[];
  watchers: Person[];
  actor: Person;
}): ChangeEmail[] {
  if (args.changes.length === 0) return [];

  const actorEmail = (args.actor.email ?? "").toLowerCase();
  const seen = new Set<string>();
  const recipients: Person[] = [];
  const add = (p: Person) => {
    const key = (p.email ?? "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    recipients.push(p);
  };
  withoutActorUnlessEmpty(args.alertList, args.actor).forEach(add);
  args.watchers.filter((p) => (p.email ?? "").toLowerCase() !== actorEmail).forEach(add);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const n = args.changes.length;
  const rows = args.changes
    .map(
      (c) =>
        `<div style="font-size:14px;margin-bottom:4px;">${escapeHtml(c.label)}: ` +
        `${shown(c.from)} &rarr; ${shown(c.to)}</div>`,
    )
    .join("");

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `Gray market request updated: ${args.target.title}`,
    headlineHtml:
      `<strong>${actorName}</strong> changed ${n === 1 ? "a field" : `${n} fields`} ` +
      `on this gray market request.`,
    detailHtml: rows,
  }));
}
