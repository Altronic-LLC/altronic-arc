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
