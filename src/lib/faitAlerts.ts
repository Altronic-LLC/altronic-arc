import type { Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { AlertDetail, ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// FAIT intake alert — telling the people who work the queue that a new First
// Article Inspection Test exists.
//
// Nothing watches the list itself, so a raised FAIT used to sit until
// somebody opened ARC and noticed it — the same gap Gray Market's intake
// alert closed (Ray, 2026-08-23), now closed here too (Ray, 2026-08-26).
// Every create emails the configured intake list (FAIT_NEW_ALERTS).
//
// This is an INTAKE queue, not the watcher mechanism: the recipients are
// config rather than the FAIT's Watchers column, they're notified whoever
// raised it, and being on the list doesn't make them watchers — later
// comments and status changes still follow the normal watcher rules. Someone
// who wants the rest of the thread presses Watch on the FAIT.
//
// Pure and email-shaped like grayMarketAlerts.ts: returns ChangeEmail[] so
// the wording is unit-testable without touching Graph.
// =============================================================================

/**
 * Build the new-FAIT email for everyone on the intake list.
 *
 * The actor is left off their own FAIT unless that would leave nobody — the
 * same rule as the Gray Market intake alert and EIR triage.
 *
 * `details` are rendered as a small list under the headline, blanks dropped —
 * a new FAIT only has its Part and Request sections filled in (inspection,
 * results and sign-off come later, by other people), so the email says what
 * IS known rather than a grid of dashes.
 */
export function buildNewFaitEmails(args: {
  target: ChangeTarget;
  /** Configured intake list — who picks a new FAIT up. */
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
    subject: `New FAIT: ${args.target.title}`,
    headlineHtml:
      `<strong>${actorName}</strong> raised a new FAIT. ` +
      `<strong>Please pick it up.</strong>`,
    detailHtml:
      `${rows}<div style="font-size:14px;margin-top:6px;">Inspection, results and ` +
      `sign-off are filled in later. Press <strong>Watch</strong> on the FAIT to ` +
      `follow its comments and status changes.</div>`,
  }));
}

/**
 * Build the closed-FAIT email for the SAME intake list that was told about
 * the FAIT when it was raised (Ray, 2026-08-27: "set alerts for the original
 * group when one is closed as well as any one assigned").
 *
 * **Everyone watching a FAIT is told when it closes — by the generic
 * status-change note**, which every status write already fires to watchers +
 * initiator / engineer / KAM. That is the "closing alerts everyone watching"
 * half of the sign-off chain, and it must not be suppressed: it is what tells
 * the INITIATOR their FAIT moved.
 *
 * So this alert covers the OTHER audience — the intake queue, who are not
 * watchers by virtue of being on a configured list and would otherwise never
 * hear that the FAIT they were asked to pick up got finished. `alreadyNotified`
 * is who the generic note reaches; they are dropped here rather than sent a
 * second email about the same event. One person, one email.
 *
 * Same `withoutActorUnlessEmpty` rule as every other intake alert: the person
 * who closed it is left off unless that would leave nobody. The de-dupe runs
 * FIRST, so that fallback applies to whoever is actually left rather than
 * resurrecting somebody the generic note already covered.
 */
export function buildFaitClosedEmails(args: {
  /** The SAME configured intake list as the new-FAIT alert. */
  recipients: Person[];
  target: ChangeTarget;
  actor: Person;
  /** Watchers + the FAIT's own people — whoever the generic status note reaches. */
  alreadyNotified?: Person[];
}): ChangeEmail[] {
  const covered = new Set(
    (args.alreadyNotified ?? [])
      .map((p) => (p?.email ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const pool = args.recipients.filter((p) => !covered.has((p.email ?? "").toLowerCase()));
  const recipients = withoutActorUnlessEmpty(pool, args.actor);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `FAIT closed: ${args.target.title}`,
    headlineHtml: `<strong>${actorName}</strong> closed this FAIT.`,
    detailHtml:
      `<div style="font-size:14px;">This is the same list that was told when the FAIT ` +
      `was first raised — no further action is needed unless something looks wrong.</div>`,
  }));
}

// =============================================================================
// The sign-off chain — SQE, then Engineering, then the KAM.
//
// A FAIT's three sign-offs could be filled in any order and nobody was told
// when it was their turn (Ray, 2026-08-28). These builders are the wording of
// that chain; the RULES (which transition happened, what status it advances
// to, whether a KAM is owed at all) live in lib/faitSignOff.ts, and the
// sending in api/email.ts.
//
// Same house style as eirStatusAlerts.ts: these are IMPERATIVE emails that say
// what the recipient has to do next — except the heads-up, which is the
// opposite and says so out loud. An "action required" email that needs no
// action is how people learn to ignore them.
// =============================================================================

/** Which link of the chain a person sits on. */
export type FaitSignerRole = "engineer" | "kam";

const ROLE_LABEL: Record<FaitSignerRole, string> = {
  engineer: "assigned engineer",
  kam: "KAM",
};

/** What has to happen before this role's turn comes round. */
const ROLE_WAITS_FOR: Record<FaitSignerRole, string> = {
  engineer: "once SQE has signed off",
  kam: "once Engineering has signed off",
};

/**
 * The role as a plain noun, with and without its article — "No engineer is
 * assigned", "Picking a KAM". ROLE_LABEL reads as "the assigned engineer",
 * which turns into "No assigned engineer is assigned" in these sentences.
 */
const ROLE_NOUN: Record<FaitSignerRole, string> = { engineer: "engineer", kam: "KAM" };
const ROLE_NOUN_A: Record<FaitSignerRole, string> = { engineer: "an engineer", kam: "a KAM" };

/**
 * "You're on this FAIT" — sent to an engineer or a KAM the moment they're
 * assigned.
 *
 * **Explicitly no action required yet.** Being assigned is not a request:
 * the engineer is asked for nothing until SQE signs off, and the KAM nothing
 * until Engineering does. Saying so is the point of the email — an
 * action-required alert that needs no action trains people to ignore the one
 * that does.
 *
 * The actor is excluded STRICTLY, not `withoutActorUnlessEmpty`: assigning
 * yourself is not news, and this is a single named person rather than a work
 * queue that must not go silent. Returns [] when they have no mailbox.
 */
export function buildFaitAssignmentHeadsUpEmails(args: {
  target: ChangeTarget;
  person: Person;
  role: FaitSignerRole;
  actor: Person;
}): ChangeEmail[] {
  const email = args.person.email?.trim();
  if (!email) return [];
  if (email.toLowerCase() === (args.actor.email ?? "").toLowerCase()) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const role = ROLE_LABEL[args.role];
  return [
    {
      email,
      displayName: args.person.displayName,
      subject: `${args.target.title} — you're the ${role} on this FAIT`,
      headlineHtml:
        `<strong>${actorName}</strong> put you on this FAIT as its <strong>${role}</strong>. ` +
        `<strong>No action is required yet.</strong>`,
      detailHtml:
        `<div style="font-size:14px;">You'll be emailed when it's your turn to sign off — ` +
        `${ROLE_WAITS_FOR[args.role]}. You're now watching the FAIT, so you'll also see its ` +
        `comments and status changes in the meantime.</div>`,
    },
  ];
}

/**
 * A FAIT reached **"This is with SQE"** — tell the configured SQE reviewers
 * there's something to sign.
 *
 * There is deliberately no SQE person column on the list (`SQEINITIALS` is a
 * text record of who signed, not an assignment), so SQE is a configured
 * recipient list rather than a field — the same shape as the EIR triage
 * queues. Queue-style, so `withoutActorUnlessEmpty`: the queue going silent
 * because the only reviewer happened to move the status is worse than one
 * redundant email.
 */
export function buildFaitWithSqeEmails(args: {
  target: ChangeTarget;
  /** The configured SQE reviewers, already parsed. */
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `${args.target.title} — with SQE, sign-off needed`,
    headlineHtml:
      `<strong>${actorName}</strong> moved this FAIT to <strong>This is with SQE</strong>. ` +
      `<strong>Please review it and record the SQE sign-off.</strong>`,
    detailHtml:
      `<div style="font-size:14px;">Approving the SQE sign-off moves the FAIT on to ` +
      `Engineering and asks the assigned engineer to review it.</div>`,
  }));
}

/** Wording that differs between the two "your turn" emails. */
const STAGE_COPY: Record<
  FaitSignerRole,
  { signedBy: string; asks: string; lands: string; column: string }
> = {
  engineer: {
    signedBy: "the SQE sign-off",
    asks: "Please review it and record your engineering sign-off.",
    lands: "This is with ENG",
    column: "Eng Sign Off",
  },
  kam: {
    signedBy: "the engineering sign-off",
    asks: "Please review it and record your KAM sign-off.",
    lands: "This is with KAM",
    column: "KAM Sign Off",
  },
};

/**
 * The next signer's turn — the engineer once SQE approves, the KAM once
 * Engineering approves.
 *
 * **The fallback matters.** A FAIT can reach either stage with nobody to ask,
 * and an alert that reaches nobody is the same as no alert — so it goes to the
 * SQE reviewers instead, who are the people managing these requests and can
 * put somebody on it.
 *
 * **Three cases, three sentences**, the shape eirStatusAlerts.ts had to be
 * corrected into: signer reachable → "please sign off"; nobody assigned →
 * "no engineer is assigned"; assigned but not reachable → "the assigned
 * engineer couldn't be asked". A Person carrying no mailbox is
 * indistinguishable from an empty slot once the unmailable are filtered out,
 * and so is a signer who made the change themselves — telling the queue that
 * nobody is assigned when somebody is points them at replacing a person who
 * is already on it.
 *
 * The signer is excluded STRICTLY: an engineer approving the SQE step
 * themselves doesn't need an email asking themselves to act. It falls through
 * to the queue instead, so somebody other than the actor hears about it.
 */
export function buildFaitSignOffRequestEmails(args: {
  target: ChangeTarget;
  role: FaitSignerRole;
  /** From the FAIT record — may be absent, or hold somebody with no mailbox. */
  signer: Person | null;
  /** Used only when the signer can't be emailed — the SQE reviewers. */
  fallback: Person[];
  actor: Person;
}): ChangeEmail[] {
  const copy = STAGE_COPY[args.role];
  const role = ROLE_NOUN[args.role];
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const opener = `<strong>${actorName}</strong> approved ${copy.signedBy}.`;

  const signerEmail = args.signer?.email?.trim();
  const signerIsActor =
    !!signerEmail && signerEmail.toLowerCase() === (args.actor.email ?? "").toLowerCase();

  if (signerEmail && !signerIsActor) {
    return [
      {
        email: signerEmail,
        displayName: args.signer!.displayName,
        subject: `${args.target.title} — ${copy.signedBy} approved, your sign-off needed`,
        headlineHtml: `${opener} <strong>${copy.asks}</strong>`,
        detailHtml:
          `<div style="font-size:14px;">The FAIT is now at <strong>${copy.lands}</strong>. ` +
          `Setting <strong>${copy.column}</strong> to Approved moves it on.</div>`,
      },
    ];
  }

  const recipients = withoutActorUnlessEmpty(args.fallback, args.actor);
  if (recipients.length === 0) return [];

  const assignedButUnreachable = args.signer !== null;
  const why = assignedButUnreachable
    ? `<strong>The assigned ${role} couldn't be asked</strong> — no mailbox on their record, or ` +
      `they made the change themselves.`
    : `<strong>No ${role} is assigned</strong>, so nobody has been asked to sign off.`;

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: assignedButUnreachable
      ? `${args.target.title} — ${copy.signedBy} approved, ${role} not reachable`
      : `${args.target.title} — ${copy.signedBy} approved, no ${role} assigned`,
    headlineHtml: `${opener} ${why}`,
    detailHtml:
      `<div style="font-size:14px;">Picking ${ROLE_NOUN_A[args.role]} on the FAIT emails them and ` +
      `puts it in somebody's hands.</div>`,
  }));
}

/**
 * SQE sign-off recorded as **Failed** — tell the initiator it came back.
 *
 * ---------------------------------------------------------------------------
 * ASSUMPTION, needs confirming (2026-08-31). The sign-off flow as specified
 * only covers Approved; "Failed" is a real SQESignOff choice with no stated
 * behaviour. Taken to mean the FAIT goes BACK rather than forward: the status
 * doesn't advance (see faitSignOffOutcome), the engineer isn't asked for
 * anything, and the person who raised it is told. Changing that decision is
 * this builder plus the one branch in faitSignOffOutcome — nothing else in
 * the app reads it.
 * ---------------------------------------------------------------------------
 *
 * Strict actor exclusion, and **no fallback queue**: the SQE reviewers are
 * the people who record a Failed sign-off, so bouncing it back to them says
 * nothing they don't already know. A FAIT with no reachable initiator sends
 * nothing here — the generic status note still covers its watchers.
 */
export function buildFaitSqeFailedEmails(args: {
  target: ChangeTarget;
  /** Whoever raised the FAIT. */
  initiator: Person | null;
  actor: Person;
}): ChangeEmail[] {
  const email = args.initiator?.email?.trim();
  if (!email) return [];
  if (email.toLowerCase() === (args.actor.email ?? "").toLowerCase()) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  return [
    {
      email,
      displayName: args.initiator!.displayName,
      subject: `${args.target.title} — SQE sign-off failed`,
      headlineHtml:
        `<strong>${actorName}</strong> recorded the SQE sign-off as <strong>Failed</strong>. ` +
        `<strong>It's back with you.</strong>`,
      detailHtml:
        `<div style="font-size:14px;">The FAIT has not gone on to Engineering. The ` +
        `<strong>SQE Approval Notes</strong> on the FAIT say why; the sign-off can be set to ` +
        `Approved once the failure is resolved.</div>`,
    },
  ];
}
