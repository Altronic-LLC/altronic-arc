import type { Person } from "@/types/task";

// =============================================================================
// Configured recipient lists — the small distribution lists that live in env
// vars rather than SharePoint.
//
// A handful of named people (EIR triage reviewers, the Gray Market intake
// list) don't justify a SharePoint list and the admin screen that comes with
// it, so they're configured as a string and parsed here. Shared because there
// is now more than one such list, and two copies of this parser is how a fix
// reaches only one of them.
// =============================================================================

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

/**
 * Drop the actor from a configured list — unless that would leave nobody.
 *
 * Not notifying someone of their own action is the rule everywhere in ARC, and
 * it holds here. But these lists are work queues rather than change
 * notifications, and a queue going silent because the only person on it
 * happened to be the one who acted is worse than one redundant email.
 */
export function withoutActorUnlessEmpty(pool: Person[], actor: Person): Person[] {
  const mailable = pool.filter((p) => !!p.email);
  const actorEmail = (actor.email ?? "").toLowerCase();
  const others = mailable.filter((p) => (p.email ?? "").toLowerCase() !== actorEmail);
  return others.length > 0 ? others : mailable;
}

/** "A", "A and B", "A, B and C" — for naming a queue inside an email. */
export function nameList(people: Person[], fallback = "the next reviewer"): string {
  const names = people.map((p) => p.displayName).filter(Boolean);
  if (names.length === 0) return fallback;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
