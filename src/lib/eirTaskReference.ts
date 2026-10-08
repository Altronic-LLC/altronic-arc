import type { Task } from "@/types/task";

// =============================================================================
// An EIR's Task Reference → the task it names.
//
// `TaskReference` is a free-text column, so it holds whatever shape put it
// there:
//
//   1. A Power Apps deep link — `https://apps.powerapps.com/...&ItemID=2755`.
//      `ItemID` is the SharePoint item id, i.e. `task.id`.
//   2. An ARC link — `https://altronic-llc.github.io/altronic-arc/task/3344`
//      (or any origin: `…/task/3344`). People paste these by hand.
//   3. ARC's own promotion writes the task's FULL numbered title —
//      `T188-321--CM4 BOM changes  1013-8626-00`.
//   4. Typed by hand: `T115`, or `T115-0017`, or a bare item id `2755`.
//
// THE RULE THAT MATTERS: a task number is only unique WITHIN its project.
// `T{n}` restarts in every project, so live there are three T188s (0001,
// 321 and 328). Resolving by the `T188` prefix alone linked EIR_2026-0270 to
// the wrong one — the first T188 in list order (reported 2026-10-08). So:
//
//   - a full numbered title matches EXACTLY (case- and space-insensitive);
//   - a shorter `T{n}` / `T{n}-{project}` reference links ONLY when exactly
//     one task carries it. Two or more is ambiguous, and an ambiguous
//     reference links to NOTHING — the candidates are offered instead, so a
//     person can pick. Linking a guess is how the wrong task got shown.
// =============================================================================

/** Collapse runs of whitespace and lower-case, for comparing titles. */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The task item id a LINK carries — a Power Apps `ItemID=` deep link or an
 * ARC `/task/{id}` URL — or null when the text isn't a link to a task.
 */
export function taskIdFromLink(raw: string | null | undefined): number | null {
  const text = raw?.trim() ?? "";
  if (!/^https?:\/\//i.test(text)) return null;
  const itemId = /[?&]ItemID=(\d+)/i.exec(text);
  const arcPath = /\/task\/(\d+)(?:[/?#]|$)/i.exec(text);
  const n = parseInt((itemId ?? arcPath)?.[1] ?? "", 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

/** What a Task Reference resolves to: one task, or the tasks it can't choose between. */
export interface EirTaskReferenceMatch {
  task: Task | null;
  /** Two or more tasks the reference fits equally — never linked, offered instead. */
  ambiguous: Task[];
}

/**
 * Resolve an EIR's Task Reference against the loaded tasks. `task` is null
 * when nothing matches, or when the reference fits several tasks — those are
 * in `ambiguous`, so the screen can offer them rather than guess.
 */
export function matchEirTaskReference(
  raw: string | null | undefined,
  tasks: readonly Task[],
): EirTaskReferenceMatch {
  const none: EirTaskReferenceMatch = { task: null, ambiguous: [] };
  const one = (task: Task | undefined): EirTaskReferenceMatch => ({ task: task ?? null, ambiguous: [] });
  const pick = (hits: Task[]): EirTaskReferenceMatch =>
    hits.length === 1 ? one(hits[0]) : { task: null, ambiguous: hits };

  const text = raw?.trim() ?? "";
  if (!text) return none;

  // 1–2. A link names the item id outright.
  const linkedId = taskIdFromLink(text);
  if (linkedId !== null) return one(tasks.find((t) => t.id === linkedId));

  // 3. The full numbered title ARC's promotion writes — exact, never a prefix.
  const key = norm(text);
  const exact = tasks.filter((t) => t.numberedTitle && norm(t.numberedTitle) === key);
  if (exact.length > 0) return pick(exact);

  // 4a. A short `T{n}` or `T{n}-{project}` reference: unique, or nothing.
  const short = /^(t\d+(?:-[^-\s]+)?)$/i.exec(text)?.[1];
  if (short) {
    const prefix = short.toLowerCase();
    return pick(
      tasks.filter((t) => {
        const title = norm(t.numberedTitle ?? "");
        return title === prefix || title.startsWith(`${prefix}-`);
      }),
    );
  }

  // 4b. A bare item id.
  if (/^\d+$/.test(text)) return one(tasks.find((t) => t.id === parseInt(text, 10)));

  return none;
}

/** The one task an EIR's Task Reference names, or null (none, or ambiguous). */
export function resolveEirTaskReference(
  raw: string | null | undefined,
  tasks: readonly Task[],
): Task | null {
  return matchEirTaskReference(raw, tasks).task;
}
