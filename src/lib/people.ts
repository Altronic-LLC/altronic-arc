import type { Person } from "@/types/task";

/**
 * The identity key used for a person throughout the app: their email, folded
 * to lowercase, falling back to display name for the rare directory entry
 * without one. SharePoint hands the same person back with inconsistent
 * casing between lists, so comparisons have to be case-insensitive.
 *
 * Exported because dropdowns key their options on it — an option value and
 * the selected value have to be computed the same way or the selection
 * silently fails to match.
 */
export function personKey(person: Person): string {
  return (person.email ?? person.displayName).toLowerCase();
}

/**
 * True for the tenant's admin/service accounts — the `admin.first.last`
 * shadow account IT issues alongside a person's real one.
 *
 * They are hidden from every people picker (Ray, 2026-08-18): they don't read
 * mail, so assigning work or a notification to one sends it nowhere, and
 * having each colleague appear twice makes the right one a coin flip.
 *
 * Matched on the email's local part AND the display name, since the two
 * don't always agree — some carry a real-looking name with an admin address.
 * Deliberately NOT a general "admin" match: someone surnamed Adminski, or a
 * shared "Admin Team" mailbox people really do assign to, must survive. Only
 * the exact `admin.` prefix counts.
 */
export function isHiddenDirectoryAccount(person: {
  displayName?: string;
  email?: string | null;
}): boolean {
  const name = (person.displayName ?? "").trim().toLowerCase();
  const local = (person.email ?? "").trim().toLowerCase().split("@")[0];
  return name.startsWith("admin.") || local.startsWith("admin.");
}

/**
 * Addresses to keep out of every people picker in ARC.
 *
 * For a person who exists twice in the directory under two accounts — a
 * rename that left the old one behind, a duplicate created by mistake — where
 * only one should be pickable. Ray hit this with a "David Phillips" appearing
 * alongside the real "Dave Phillips" (2026-08-20).
 *
 * It's a config list rather than names in code, because which account is the
 * stale one is DATA and it changes. Comma-separated, and an entry can be
 * either a full address or just the part before the @:
 *
 *   VITE_HIDDEN_PEOPLE="david.phillips, someone.else@altronic-llc.com"
 *
 * The bare form exists so nobody has to know which domain a mailbox is on —
 * a local part is unique within the tenant, and getting the domain wrong
 * silently hides nobody, which is the failure that's hard to notice.
 *
 * An entry is matched against the email AND the display name, because a person
 * reaches a picker by more than one route and only some of those routes carry
 * an address (see `nameTokenKey`).
 *
 * **This is cosmetic, not a permission.** A hidden account can still be
 * assigned work directly in SharePoint; this only keeps it out of the pickers.
 * A duplicate that shouldn't exist is better disabled in Entra — which the
 * directory read now skips on its own.
 */
/**
 * The duplicates known today. Each is the account to HIDE — the other spelling
 * of that person is the one that stays:
 *
 *   david.phillips  → the real one is Dave Phillips  (Ray, 2026-08-20)
 *   steve.pirko     → the real one is Steven Pirko, who is the name tagged
 *                     on the EIR Roles list          (Ray, 2026-08-20)
 *
 * Harmless when an entry matches nobody, so listing one that may not exist
 * costs nothing. Override the whole list with VITE_HIDDEN_PEOPLE.
 */
const DEFAULT_HIDDEN_PEOPLE = "david.phillips,steve.pirko";

const HIDDEN_PEOPLE: Set<string> = new Set(
  (import.meta.env.VITE_HIDDEN_PEOPLE ?? DEFAULT_HIDDEN_PEOPLE)
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * An order- and punctuation-insensitive key for a name:
 *
 *   "David Phillips"   → "david.phillips"
 *   "Phillips, David"  → "david.phillips"
 *   "david.phillips"   → "david.phillips"
 *
 * All three forms are the SAME person arriving by a different route, and the
 * duplicate survived two fixes because each fix only knew one of them
 * (Ray, 2026-08-20). Entra returns display names surname-first, SharePoint
 * person columns return whatever was stored, and the config list is written in
 * address form — so tokens are sorted and rejoined rather than compared in
 * order.
 */
function nameTokenKey(text: string): string {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(".");
}

/** The configured entries, indexed both ways so either form matches. */
const HIDDEN_KEYS: Set<string> = new Set([...HIDDEN_PEOPLE].map(nameTokenKey));

/**
 * True when this person should be kept out of the pickers.
 *
 * Checks the address first and the name second, rather than treating the name
 * as a fallback for a missing address: people gathered off ITEMS come from a
 * SharePoint person column, where Graph frequently omits `Email` altogether,
 * and an address that IS present may be on a domain the config list doesn't
 * spell out. Matching only what happened to be populated is exactly how the
 * duplicate kept coming back.
 *
 * The cost is that a real colleague whose name reduces to the same key would
 * be hidden too. That's accepted: entries are configured deliberately, one
 * named person at a time — and "Dave Phillips", the one who must survive here,
 * reduces to `dave.phillips` and is untouched.
 */
export function isHiddenPerson(person: {
  displayName?: string;
  email?: string | null;
}): boolean {
  if (isHiddenDirectoryAccount(person)) return true;

  const email = (person.email ?? "").trim().toLowerCase();
  if (email) {
    const local = email.split("@")[0];
    if (HIDDEN_PEOPLE.has(email) || HIDDEN_PEOPLE.has(local)) return true;
    if (HIDDEN_KEYS.has(nameTokenKey(local))) return true;
  }

  const name = (person.displayName ?? "").trim();
  return name.length > 0 && HIDDEN_KEYS.has(nameTokenKey(name));
}

/**
 * Return `people` with `person` merged in if missing (deduped by lowercase
 * email/displayName), kept alphabetical.
 *
 * Used by every list view's filter bar so the signed-in user ALWAYS appears
 * in the people dropdowns (Assigned / Engineer / Requestor / Created By) —
 * even before they're on any item. Without this, a Dashboard "Mine"
 * click-through filters the list to the user while the dropdown still reads
 * "Anyone", which looks like an empty list with no filter applied.
 *
 * **Hidden people are dropped here too.** Every filter bar in ARC funnels
 * through this function, and its options come from the ITEMS — who's assigned
 * to a task — not from the directory. So the directory-side filters never see
 * them: a duplicate account that's been assigned real work keeps appearing in
 * the dropdown however thoroughly the directory is cleaned (Ray, 2026-08-20 —
 * "David Phillips" still in the Operations Assigned filter after the directory
 * fix). One place, all ten bars.
 *
 * The explicitly-passed `person` is never filtered: that's the signed-in user,
 * and the promise above matters more than the edge case of someone being
 * signed in as a hidden account.
 */
export function withPerson(people: Person[], person: Person | null | undefined): Person[] {
  const visible = people.filter((p) => !isHiddenPerson(p));
  if (!person || !person.displayName) return visible;
  const key = (person.email ?? person.displayName).toLowerCase();
  if (visible.some((p) => (p.email ?? p.displayName).toLowerCase() === key)) return visible;
  return [...visible, person].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Merge several people lists into one, deduped by lowercase email/displayName
 * and sorted alphabetically. Earlier lists win on identity, BUT an entry that
 * carries a `lookupId` always beats one that doesn't — so a directory person
 * (no lookupId) never shadows the same person already known to the app with a
 * resolved lookupId. Used to fold the staff directory into the assignment +
 * @-mention pickers without losing the write-ready lookupIds from item data.
 */
export function mergePeople(...lists: Array<Person[] | undefined>): Person[] {
  const byKey = new Map<string, Person>();
  for (const list of lists) {
    if (!list) continue;
    for (const p of list) {
      if (!p || !p.displayName) continue;
      // admin.first.last shadow accounts never belong in a picker.
      if (isHiddenPerson(p)) continue;
      const key = (p.email ?? p.displayName).toLowerCase();
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, p);
      } else if (!existing.lookupId && p.lookupId) {
        // Prefer the entry that can actually be written to a person field.
        byKey.set(key, p);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Everyone who should be watching an item, given the people involved with it.
 *
 * The rule (Ray, 2026-08-18): **whoever creates an item watches it, whoever
 * it's assigned to watches it**, alongside anyone added by hand or picked up
 * from an @-mention. Before this, creating a task and assigning it to someone
 * else left BOTH of you off the watcher list — so the next comment on it
 * notified nobody, and the person who raised the work never heard about it
 * again.
 *
 * Accepts people and lists of people in any mix, so a caller can pass
 * `(input.watchers, input.assigned, creator)` whether "assigned" on that
 * entity is one person or several. Deduping is `mergePeople`'s — by lowercase
 * email, preferring the copy that carries a lookupId, since only that one can
 * be written to a SharePoint person field.
 *
 * Nobody is ever REMOVED here. Unassigning someone leaves them watching, which
 * is the right default — they were involved, and Unwatch is one click away.
 */
export function autoWatchers(
  ...groups: Array<Person | Person[] | null | undefined>
): Person[] {
  const lists: Person[][] = [];
  for (const group of groups) {
    if (!group) continue;
    lists.push(Array.isArray(group) ? group : [group]);
  }
  return mergePeople(...lists);
}
