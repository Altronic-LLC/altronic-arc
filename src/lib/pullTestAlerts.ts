import type { Person } from "@/types/task";
import type { PullTest } from "@/types/pullTest";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { ChangeEmail } from "./changeAlerts";
import { gaugeLabel } from "./crimpCheck";
import { failingPulls, forceText, minimumText } from "./pullTest";

// =============================================================================
// Failed pull test email (BusinessIT#64). A test with ANY pull below the
// minimum emails the "Pull test failed" people on the Harness Alert Recipients
// list — managed by ARC admins in ARC, no redeploy (the crimp arrangement).
//
// A work queue, so the actor is dropped only if somebody else is left.
// Pure, returning ChangeEmail[], so the wording is tested without Graph.
// =============================================================================

export function buildPullTestFailedEmails(args: {
  test: PullTest;
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const t = args.test;
  const failing = failingPulls(t.readings, t.unit, t);
  const who = escapeHtml(t.clockNumber ? `Clock # ${t.clockNumber}` : args.actor.displayName || "Someone");

  const line = (label: string, value: string, strong = false) =>
    value.trim()
      ? `<div style="font-size:14px;">${escapeHtml(label)}: ${strong ? "<strong>" : ""}${escapeHtml(value)}${strong ? "</strong>" : ""}</div>`
      : "";

  const pulls = t.readings
    .map((v, i) => ({ v, position: i + 1 }))
    .filter((p) => p.v !== null)
    .map(({ v, position }) => {
      const value = escapeHtml(forceText(v, t.unit));
      return failing.some((f) => f.position === position)
        ? `<span style="color:#CB2C30;font-weight:600;">${value} (below the minimum)</span>`
        : value;
    })
    .join(" · ");

  const detailHtml = [
    line("Terminal", t.terminal, true),
    line("Wire gauge", gaugeLabel(t.wireGauge)),
    line("Minimum", minimumText(t.minimumForce, t.specUnit), true),
    line("Spec from", t.reference),
    `<div style="font-size:14px;">Pulls: ${pulls}</div>`,
    line("How it failed", t.howFailed, true),
    line("Test", t.checkPoint ?? ""),
    line("Applicator or tool", t.applicator),
    line("Harness or assembly", t.harnessOrAssembly),
    line("Work order", t.workOrder),
    line("Notes", t.notes),
  ].join("");

  const count = failing.length === 1 ? "One pull is" : `${failing.length} pulls are`;
  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `Pull test failed: ${t.terminal} ${gaugeLabel(t.wireGauge)}`.trim(),
    headlineHtml:
      `<strong>${who}</strong> recorded a pull test on <strong>${escapeHtml(t.terminal)}</strong>. ` +
      `${count} <strong>below the minimum</strong>.`,
    detailHtml,
  }));
}
