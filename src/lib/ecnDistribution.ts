import type { Ecn, EcnDistributionGroup, Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import { htmlToPlainText } from "./htmlText";
import type { ChangeEmail } from "./changeAlerts";

// =============================================================================
// ECN distribution (BusinessIT#57) — the DISTRIBUTION block on the paper ECN,
// in the shape of the MCN's (Ray: "mirror MCN distribution list structure").
//
// Tim's decisions, 2026-11-05:
//   - The roles are the paper form's ten, not the MCN's eight.
//   - A new ECN starts with the seven the form ticks (an X on every role from
//     VP Operations Eng. to Purchasing Manager); the rest start unticked.
//   - Who is in each role is its OWN list, ECN Distribution Groups on the
//     Engineering site — not the MCN's, so re-pointing one never re-points
//     the other. ARC admins manage it.
//   - The email goes the FIRST time Sign-off status is filled in (blank →
//     anything). Later edits to that text send nothing, and the list it went
//     to is recorded on the ECN (DistributedTo / DistributedAt).
//   - The form's RCVD (received) column is NOT tracked.
//
// Pure — the hook in useEcns.ts reads the groups fresh and sends.
// =============================================================================

/** The form's DISTRIBUTION block, in its order. Must match the SharePoint choices. */
export const ECN_DISTRIBUTION_ROLES = [
  "CAD Department",
  "VP Operations Eng.",
  "Quality Manager",
  "Logistics Manager",
  "Production Director",
  "Sales",
  "Op. Program Manager",
  "Purchasing Manager",
  "SHE Coordinator",
  "Panel Plant",
] as const;

/** What a new ECN starts with ticked — the X's on the paper form. */
export const ECN_DEFAULT_DISTRIBUTION: readonly string[] = [
  "VP Operations Eng.",
  "Quality Manager",
  "Logistics Manager",
  "Production Director",
  "Sales",
  "Op. Program Manager",
  "Purchasing Manager",
];

/** The ECN list's three distribution columns. `Distribution` is MULTI-choice. */
export const ECN_DISTRIBUTION_COLUMNS = ["Distribution", "DistributedTo", "DistributedAt"] as const;

/** Columns that need the Collection(Edm.String) annotation on a write. */
export const ECN_MULTI_CHOICE_COLUMNS: readonly string[] = ["Distribution"];

/**
 * Put roles in the form's order, de-duplicated (case-insensitively). A value
 * the form doesn't list — a choice added in SharePoint first — is kept, after
 * the known ones, rather than dropped: dropping it would clear it on the next
 * save.
 */
export function orderDistribution(roles: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of roles) {
    const role = raw.trim();
    const key = role.toLowerCase();
    if (!role || seen.has(key)) continue;
    seen.add(key);
    kept.push(role);
  }
  const rank = (role: string) => {
    const i = ECN_DISTRIBUTION_ROLES.findIndex((r) => r.toLowerCase() === role.toLowerCase());
    return i < 0 ? ECN_DISTRIBUTION_ROLES.length : i;
  };
  return kept
    .map((role, i) => ({ role, i }))
    .sort((a, b) => rank(a.role) - rank(b.role) || a.i - b.i)
    .map((x) => x.role);
}

/** The `Distribution` value as Graph returns it (an array; a bare string is tolerated). */
export function parseEcnDistribution(raw: unknown): string[] {
  if (Array.isArray(raw)) return orderDistribution(raw.filter((v): v is string => typeof v === "string"));
  if (typeof raw === "string" && raw.trim()) return orderDistribution([raw]);
  return [];
}

/** Tick or untick one role, keeping the form's order. */
export function toggleDistributionRole(ticked: readonly string[], role: string): string[] {
  const on = ticked.some((r) => r.toLowerCase() === role.toLowerCase());
  return on
    ? ticked.filter((r) => r.toLowerCase() !== role.toLowerCase())
    : orderDistribution([...ticked, role]);
}

/** Every role to show as a tick box: the form's ten, plus any extra one this ECN holds. */
export function distributionRoleOptions(ticked: readonly string[]): string[] {
  return orderDistribution([...ECN_DISTRIBUTION_ROLES, ...ticked]);
}

/** A recipient, with the ticked roles that put them on the list. */
export type EcnDistributionRecipient = Person & { email: string; roles: string[] };

function groupFor(groups: readonly EcnDistributionGroup[], role: string): EcnDistributionGroup | undefined {
  return groups.find((g) => g.role.trim().toLowerCase() === role.trim().toLowerCase());
}

/**
 * Who an ECN goes to: every member of every ticked role, de-duplicated by
 * address, in the form's role order. Each carries the roles that put them on
 * it, so their email can say why they're getting it.
 */
export function ecnDistributionRecipients(
  groups: readonly EcnDistributionGroup[],
  ticked: readonly string[],
): EcnDistributionRecipient[] {
  const byEmail = new Map<string, EcnDistributionRecipient>();
  for (const role of orderDistribution(ticked)) {
    const group = groupFor(groups, role);
    if (!group) continue;
    for (const member of group.members) {
      const email = member.email?.trim();
      if (!email) continue;
      const key = email.toLowerCase();
      const existing = byEmail.get(key);
      if (existing) {
        if (!existing.roles.includes(group.role)) existing.roles.push(group.role);
      } else {
        byEmail.set(key, { ...member, email, roles: [group.role] });
      }
    }
  }
  return [...byEmail.values()];
}

/** Ticked roles nobody is set up to receive — said on the ECN before anything is sent. */
export function emptyDistributionRoles(
  groups: readonly EcnDistributionGroup[],
  ticked: readonly string[],
): string[] {
  return orderDistribution(ticked).filter((role) => {
    const group = groupFor(groups, role);
    return !group || !group.members.some((m) => !!m.email?.trim());
  });
}

function signOffSet(ecn: Ecn | undefined): boolean {
  return !!ecn?.values.signOffStatus?.trim();
}

/**
 * Does this write send the distribution? Only when Sign-off status goes from
 * blank to filled in, on an ECN that hasn't been sent already. `before` is the
 * row as it stood BEFORE the optimistic patch; without it, nothing is sent —
 * guessing would risk sending on an unrelated edit.
 */
export function shouldDistributeEcn(before: Ecn | undefined, after: Ecn): boolean {
  if (!before) return false;
  if (signOffSet(before) || !signOffSet(after)) return false;
  return !before.distributedAt && !after.distributedAt;
}

/**
 * The recovery: Sign-off status is filled in but nothing was sent (nobody was
 * set up at the time, the send failed, or the ECN predates this feature).
 */
export function canSendDistributionNow(ecn: Ecn): boolean {
  return signOffSet(ecn) && !ecn.distributedAt;
}

function line(label: string, value: string): string {
  return value.trim()
    ? `<div style="font-size:14px;">${escapeHtml(label)}: <strong>${escapeHtml(value.trim())}</strong></div>`
    : "";
}

function roleList(roles: string[]): string {
  if (roles.length <= 1) return roles.join("");
  return `${roles.slice(0, -1).join(", ")} and ${roles[roles.length - 1]}`;
}

/**
 * One email per recipient. The person who filled in the sign-off is left off
 * STRICTLY — nobody needs telling what they just did (the MCN approved-email
 * rule).
 */
export function buildEcnDistributionEmails(args: {
  ecn: Ecn;
  /** What to call the ECN — `ecnLabel(ecn)` (passed in: ecnMapper imports this file). */
  label: string;
  recipients: EcnDistributionRecipient[];
  actor: Person;
  projectTitle?: string | null;
}): ChangeEmail[] {
  const actorEmail = (args.actor.email ?? "").trim().toLowerCase();
  const recipients = args.recipients.filter((r) => r.email.toLowerCase() !== actorEmail);
  const e = args.ecn;
  const description = htmlToPlainText(e.values.detailedDescription ?? "").trim();
  const detailHtml = [
    line("Log#", e.logNo),
    line("Title", e.title),
    line("Project", args.projectTitle ?? ""),
    line("Final assembly part numbers", e.values.finalAssemblyPartNumbers ?? ""),
    line("In house stock", e.values.inHouseStock ?? ""),
    line("Sign-off status", e.values.signOffStatus ?? ""),
    line("Detailed description", description.length > 400 ? `${description.slice(0, 400)}…` : description),
  ].join("");
  const who = escapeHtml(args.actor.displayName || "Someone");
  const label = escapeHtml(args.label);
  return recipients.map((r) => ({
    email: r.email,
    displayName: r.displayName,
    subject: `ECN signed off: ${args.label}`,
    headlineHtml:
      `<strong>${who}</strong> signed off Engineering Change Notice <strong>${label}</strong>. ` +
      `You are on its distribution as ${escapeHtml(roleList(r.roles))}. ` +
      `The link opens the ECN — work from it, not from a copy.`,
    detailHtml,
  }));
}
