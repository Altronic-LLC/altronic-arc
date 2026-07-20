import type { Person } from "@/types/task";

/**
 * Return `people` with `person` merged in if missing (deduped by lowercase
 * email/displayName), kept alphabetical.
 *
 * Used by every list view's filter bar so the signed-in user ALWAYS appears
 * in the people dropdowns (Assigned / Engineer / Requestor / Created By) —
 * even before they're on any item. Without this, a Dashboard "Mine"
 * click-through filters the list to the user while the dropdown still reads
 * "Anyone", which looks like an empty list with no filter applied.
 */
export function withPerson(people: Person[], person: Person | null | undefined): Person[] {
  if (!person || !person.displayName) return people;
  const key = (person.email ?? person.displayName).toLowerCase();
  if (people.some((p) => (p.email ?? p.displayName).toLowerCase() === key)) return people;
  return [...people, person].sort((a, b) => a.displayName.localeCompare(b.displayName));
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
