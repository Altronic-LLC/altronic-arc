import { useEffect, useRef, useState } from "react";
import { findOutOfOffice } from "@/api/mailTips";
import type { OutOfOffice } from "@/lib/outOfOffice";
import type { Person } from "@/types/task";

const NOBODY: OutOfOffice[] = [];

/**
 * Who among `people` is out of office now (Altronic-LLC/BusinessIT#4) — for the
 * line above a comment box. Never the signed-in person. `[]` while asking, when
 * nobody is away, and when the check can't be made: the note is a courtesy, so
 * a failed check shows nothing rather than an error.
 *
 * Plain state rather than React Query, deliberately: api/mailTips.ts already
 * keeps each PERSON for 15 minutes (a query keyed on the whole list would ask
 * again for everybody each time a mention is added), and the comment box is
 * rendered in many places — tests included — that have no query client.
 */
export function useOutOfOffice(people: Person[]): OutOfOffice[] {
  const byEmail = new Map<string, Person>();
  for (const p of people) {
    const email = p.email?.trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, p);
  }
  // A string, so a new array of the same people doesn't ask again.
  const key = [...byEmail.keys()].sort().join("|");
  const [away, setAway] = useState<OutOfOffice[]>(NOBODY);
  const shown = useRef<OutOfOffice[]>(NOBODY);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const wanted = key.split("|").map((email) => byEmail.get(email)!);
    findOutOfOffice(wanted).then((found) => {
      if (cancelled) return;
      // Nobody away, and nobody was: nothing to re-render. That's nearly every
      // comment, and it keeps a lookup from touching the box at all.
      if (sameAddresses(shown.current, found)) return;
      shown.current = found;
      setAway(found);
    });
    return () => {
      cancelled = true;
    };
    // byEmail is rebuilt every render; `key` is what it means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return NOBODY;
  // While a new name is being looked up, keep showing whoever was already
  // known to be away — but only people still in the list.
  const wanted = new Set(key.split("|"));
  return away.filter((p) => wanted.has(p.email.toLowerCase()));
}

function sameAddresses(a: OutOfOffice[], b: OutOfOffice[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map((p) => p.email.toLowerCase()).sort();
  const right = b.map((p) => p.email.toLowerCase()).sort();
  return left.every((e, i) => e === right[i]);
}
