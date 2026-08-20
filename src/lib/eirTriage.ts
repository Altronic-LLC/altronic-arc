import type { Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import type { ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// EIR triage — chasing a new EIR until someone owns it.
//
// A raised EIR is nobody's until it has a project reference and an engineer,
// and both were previously chased by someone noticing (Ray, 2026-08-20). The
// chain:
//
//   raised with NO project  →  ask the project reviewer to add one
//   project reference set   →  ask the assigners to put an engineer on it
//   raised WITH a project   →  skip the first step, go straight to the second
//
// Each email says what happens next, so a recipient can see they're one link
// in a chain rather than the end of it.
//
// Pure and email-shaped, like changeAlerts.ts: it returns ChangeEmail[] for
// the same sender, so the wording is unit-testable without touching Graph.
// =============================================================================

export type EirTriageStage = "needs-project" | "needs-engineer";

/**
 * What this EIR is waiting for, or null when it's waiting for neither.
 *
 * Order matters: an EIR with no project isn't chased for an engineer as well,
 * because the assigners can't sensibly pick one without knowing the project.
 */
export function eirTriageStage(args: {
  hasProject: boolean;
  hasEngineer: boolean;
}): EirTriageStage | null {
  if (!args.hasProject) return "needs-project";
  if (!args.hasEngineer) return "needs-engineer";
  return null;
}

/**
 * Parse a configured recipient list — `"Sheila Horn <sheila.horn@x.com>, other@x.com"`.
 *
 * Tolerates a bare address (the name falls back to the local part, title-cased
 * enough to read properly in "Hello …"), because whoever sets the env var
 * shouldn't have to get the format exactly right for mail to work.
 */
export function parseRecipientList(raw: string | undefined): Person[] {
  if (!raw) return [];
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const angled = /^(.*?)<([^>]+)>$/.exec(entry);
    const email = (angled ? angled[2] : entry).trim();
    if (!email.includes("@")) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const named = angled ? angled[1].trim().replace(/^"|"$/g, "") : "";
    out.push({ displayName: named || prettyNameFromEmail(email), email });
  }
  return out;
}

function prettyNameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function nameList(people: Person[]): string {
  const names = people.map((p) => p.displayName).filter(Boolean);
  if (names.length === 0) return "the next reviewer";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Build the triage email(s) for one stage.
 *
 * **The actor is excluded — unless that would leave nobody.** Not notifying
 * someone of their own action is the rule everywhere else in ARC, and it holds
 * here: Sheila raising an EIR without a project doesn't need an email telling
 * her so. But these are work-queue requests rather than change notifications,
 * and a queue that goes silent because the only reviewer happened to type the
 * EIR is worse than one redundant email. So the exclusion yields.
 */
export function buildEirTriageEmails(args: {
  target: ChangeTarget;
  stage: EirTriageStage;
  /** Who chases a missing project reference. */
  projectReviewers: Person[];
  /** Who assigns an engineer once there's a project. */
  assigners: Person[];
  /** Who raised the EIR, or who just set the project reference. */
  actor: Person;
  /** Project name, shown on the needs-engineer email when known. */
  projectTitle?: string;
  /** True when the project was set later rather than present at creation. */
  projectJustAdded?: boolean;
}): ChangeEmail[] {
  const pool =
    args.stage === "needs-project" ? args.projectReviewers : args.assigners;
  const recipients = withoutActorUnlessEmpty(pool, args.actor);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const title = args.target.title;

  if (args.stage === "needs-project") {
    const nextUp = escapeHtml(nameList(args.assigners));
    return recipients.map((p) => ({
      email: p.email!,
      displayName: p.displayName,
      subject: `${title} needs a project reference`,
      headlineHtml:
        `<strong>${actorName}</strong> raised this EIR without a project reference. ` +
        `<strong>Please add a project reference.</strong>`,
      detailHtml:
        `<div style="font-size:14px;">Once it has one, ${nextUp} ` +
        `${args.assigners.length === 1 ? "is" : "are"} asked to assign an engineer.</div>`,
    }));
  }

  const opened = args.projectJustAdded
    ? `<strong>${actorName}</strong> added a project reference to this EIR.`
    : `<strong>${actorName}</strong> raised this EIR with a project reference.`;
  const project = args.projectTitle?.trim()
    ? `<div style="font-size:14px;">Project: <strong>${escapeHtml(args.projectTitle.trim())}</strong></div>`
    : "";

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `${title} needs an engineer assigned`,
    headlineHtml: `${opened} <strong>Please assign an engineer.</strong>`,
    detailHtml:
      `${project}<div style="font-size:14px;margin-top:6px;">Assigning one notifies ` +
      `them and takes the EIR out of the Needs Assigned queue.</div>`,
  }));
}

function withoutActorUnlessEmpty(pool: Person[], actor: Person): Person[] {
  const mailable = pool.filter((p) => !!p.email);
  const actorEmail = (actor.email ?? "").toLowerCase();
  const others = mailable.filter((p) => (p.email ?? "").toLowerCase() !== actorEmail);
  return others.length > 0 ? others : mailable;
}
