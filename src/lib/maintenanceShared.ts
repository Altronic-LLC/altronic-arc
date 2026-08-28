import type { MaintenanceStatus, Person, ProjectReference } from "@/types/task";
import { parseLookupSingle } from "./taskMapper";
import { personOrLookup, readLookupId } from "./faitMapper";

// =============================================================================
// Read helpers shared by the three CMMS mappers (maintenanceTaskMapper,
// scheduledMaintenanceMapper, equipmentMapper).
//
// One copy on purpose. Three near-identical mappers is exactly the shape that
// produced this repo's `htmlToPlainText` drift — three copies that looked the
// same until one of them was fixed.
//
// `personOrLookup` and `readLookupId` are the FAIT module's, re-exported here
// rather than written a fourth time: they encode the rule that a SINGLE-value
// person or lookup column comes back from Graph as a bare `<Name>LookupId`,
// which is the one thing about these lists most likely to be got wrong.
// =============================================================================

export { personOrLookup, readLookupId };

/** A text column's value, or "" for anything that isn't a string. */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A number column's value, or null.
 *
 * Graph hands numbers back as numbers on some lists and as strings on others,
 * so both are read. An empty column is `null` — NOT 0: "no labour hours
 * recorded" and "this job took zero hours" are different answers, and only one
 * of them should count towards a total.
 */
export function readNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A boolean column's value. Anything unset reads as false. */
export function readBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return /^(true|yes|1)$/i.test(raw.trim());
  return false;
}

/**
 * A SINGLE-value lookup column, from either shape Graph might return: the
 * expanded `{ LookupId, LookupValue }` object, or (far more often) a bare
 * `<Name>LookupId` with no title attached. A bare id becomes a title-less
 * reference the caller joins against the loaded target list — the same
 * "resolve afterwards" pattern `attachLookupTitles` uses for Operations tasks.
 */
export function lookupRef(expanded: unknown, rawLookupId: unknown): ProjectReference | null {
  const resolved = parseLookupSingle(expanded);
  if (resolved) return resolved;
  const lookupId = readLookupId(rawLookupId);
  return lookupId ? { lookupId, title: "" } : null;
}

/**
 * Fill in a person ARC only holds a lookupId for, from the site's user
 * directory.
 *
 * An id nobody answers for renders as `User #46`, never as empty: a person
 * column that IS set must not look unset, or the next person to open the
 * record reassigns it without knowing somebody was already on it.
 */
export function fillPerson(
  person: Person | null,
  siteUsers: Map<number, Person>,
): Person | null {
  if (!person) return null;
  if (person.displayName) return person;
  const known = person.lookupId ? siteUsers.get(person.lookupId) : undefined;
  if (known) return { ...known };
  return { ...person, displayName: `User #${person.lookupId ?? "?"}` };
}

/** `fillPerson` across a watcher list. */
export function fillPeople(people: Person[], siteUsers: Map<number, Person>): Person[] {
  return people.map((p) => fillPerson(p, siteUsers)).filter((p): p is Person => p !== null);
}

/** Resolve a title-less lookup reference against a loaded reference list. */
export function attachLookupTitle(
  ref: ProjectReference | null,
  byId: Map<number, { title: string }>,
): ProjectReference | null {
  if (!ref || ref.title) return ref;
  const found = byId.get(ref.lookupId);
  return found ? { ...ref, title: found.title } : ref;
}

/**
 * True for the two statuses that mean a work order is finished with.
 *
 * Lives in lib/ rather than in components/maintenanceAtoms.tsx (which
 * re-exports it) because lib must never import from components — the metrics
 * layer needs this rule and would otherwise pull a React module into pure
 * code. Same knowledge, one definition.
 */
export function isClosedMaintenanceStatus(status: MaintenanceStatus): boolean {
  return status === "Complete" || status === "Canceled";
}
