import type { Person } from "@/types/task";
import type { CrimpCheck } from "@/types/crimp";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { ChangeEmail } from "./changeAlerts";
import { crimpLimits, failingReadings, formatCrimp, gaugeLabel, specText } from "./crimpCheck";

// =============================================================================
// Out-of-spec crimp email (BusinessIT#55). A check with ANY reading outside
// nominal ± tolerance emails the "Crimp out of spec" people on the Harness
// Alert Recipients list — managed by ARC admins in ARC, no redeploy.
//
// A work queue, so the actor is dropped only if somebody else is left
// (withoutActorUnlessEmpty): a supervisor measuring a bad crimp themselves
// still gets the record of it when they're the only one configured.
//
// Pure, returning ChangeEmail[], so the wording is tested without Graph.
// =============================================================================

const READING_WORD = { low: "below the lower limit", high: "above the upper limit" } as const;

export function buildCrimpOutOfSpecEmails(args: {
  check: CrimpCheck;
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const c = args.check;
  const limits = crimpLimits(c.crimpHeight, c.tolerance);
  const failing = failingReadings(c.readings, limits);
  const who = escapeHtml(c.clockNumber ? `Clock # ${c.clockNumber}` : args.actor.displayName || "Someone");

  const line = (label: string, value: string, strong = false) =>
    value.trim()
      ? `<div style="font-size:14px;">${escapeHtml(label)}: ${strong ? "<strong>" : ""}${escapeHtml(value)}${strong ? "</strong>" : ""}</div>`
      : "";

  const readings = c.readings
    .map((v, i) => {
      const bad = failing.find((f) => f.position === i + 1);
      const value = escapeHtml(formatCrimp(v));
      return bad
        ? `<span style="color:#CB2C30;font-weight:600;">${value} (${READING_WORD[bad.status]})</span>`
        : value;
    })
    .join(" · ");

  const detailHtml = [
    line("Terminal", c.terminal, true),
    line("Wire gauge", gaugeLabel(c.wireGauge)),
    line("Applicator", c.applicator),
    line("Spec", `${specText(c.crimpHeight, c.tolerance)} in`, true),
    `<div style="font-size:14px;">Readings: ${readings}</div>`,
    line("Average", formatCrimp(c.average)),
    line("Check", c.checkPoint ?? ""),
    line("Harness or assembly", c.harnessOrAssembly),
    line("Applicator change", c.applicatorChange),
    line("Notes", c.notes),
  ].join("");

  const count = failing.length === 1 ? "One reading is" : `${failing.length} readings are`;
  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `Crimp height out of spec: ${c.terminal} ${gaugeLabel(c.wireGauge)}`.trim(),
    headlineHtml:
      `<strong>${who}</strong> recorded a crimp height check on ` +
      `<strong>${escapeHtml(c.terminal)}</strong>. ${count} <strong>out of spec</strong>.`,
    detailHtml,
  }));
}
