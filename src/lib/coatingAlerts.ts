import type { Person } from "@/types/task";
import type { CoatingCheck } from "@/types/coating";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { ChangeEmail } from "./changeAlerts";
import {
  coatedSidesText,
  coatingLimits,
  coatingSpecRefText,
  coatingSpecText,
  formatCoatingReading,
  thicknessStatus,
  thicknessText,
  UNIT_LABEL,
} from "./coatingCheck";

// =============================================================================
// Out-of-spec conformal coating email (BusinessIT#60). A check whose coating
// thickness is outside the spec's min / max emails the "Coating out of spec"
// people on Operations Alert Recipients — managed by ARC admins in ARC, no
// redeploy (the crimp log's arrangement).
//
// A work queue, so the actor is dropped only if somebody else is left: a
// supervisor measuring a bad board themselves still gets the record of it
// when they're the only one configured.
// =============================================================================

const STATUS_WORD = { low: "below the minimum", high: "above the maximum" } as const;

export function buildCoatingOutOfSpecEmails(args: {
  check: CoatingCheck;
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const c = args.check;
  const status = thicknessStatus(c.thicknessMm, coatingLimits(c.minMm, c.maxMm, c.specUnit));
  const who = escapeHtml(c.operator || args.actor.displayName || "Someone");
  const readings = (values: CoatingCheck["coated"]) =>
    values.map((v) => formatCoatingReading(v, c.unit)).join(" · ");

  const line = (label: string, value: string, strong = false) =>
    value.trim()
      ? `<div style="font-size:14px;">${escapeHtml(label)}: ${strong ? "<strong>" : ""}${escapeHtml(value)}${strong ? "</strong>" : ""}</div>`
      : "";

  const thickness =
    `<div style="font-size:14px;">Coating thickness: ` +
    `<span style="color:#CB2C30;font-weight:600;">${escapeHtml(thicknessText(c.thicknessMm, c.specUnit))}` +
    `${status === "low" || status === "high" ? ` (${STATUS_WORD[status]})` : ""}</span></div>`;

  const detailHtml = [
    line("Machine", c.machine, true),
    line("Spec", `${c.specName} — ${coatingSpecText(c.minMm, c.maxMm, c.specUnit)}`, true),
    line("Spec for reference", coatingSpecRefText(c.minMm, c.maxMm, c.specUnit)),
    thickness,
    line("Uncoated board", `${readings(c.uncoated)} (avg ${formatCoatingReading(c.uncoatedAverage, c.unit)})`),
    line("Coated board", `${readings(c.coated)} (avg ${formatCoatingReading(c.coatedAverage, c.unit)})`),
    line("Measured in", UNIT_LABEL[c.unit]),
    line("Worked out for", coatedSidesText(c.coatedSides)),
    line("Measured", c.measuredAt ? c.measuredAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : ""),
    line("Notes", c.notes),
  ].join("");

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `Conformal coating out of spec: ${c.machine || c.specName}`.trim(),
    headlineHtml:
      `<strong>${who}</strong> recorded a conformal coating thickness check on ` +
      `<strong>${escapeHtml(c.machine || "a machine")}</strong>. The coating is <strong>out of spec</strong>.`,
    detailHtml,
  }));
}
