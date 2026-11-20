import type { Eir, Task, TaskEirReference } from "@/types/task";

/** What the resolver needs from a task — the backfill passes bare rows. */
type TaskRef = Pick<Task, "id" | "numberedTitle">;

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
 * Does a stored Task Reference name exactly this numbered title? The same
 * case- and space-insensitive comparison the resolver uses, so a reference
 * rewritten after a renumber (BusinessIT#33) is matched by the same rule
 * that will later read it.
 */
export function sameTaskReference(reference: string | null | undefined, numberedTitle: string): boolean {
  const ref = norm(reference ?? "");
  return ref !== "" && ref === norm(numberedTitle);
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
export interface EirTaskReferenceMatch<T extends TaskRef = Task> {
  task: T | null;
  /** Two or more tasks the reference fits equally — never linked, offered instead. */
  ambiguous: T[];
}

/**
 * Resolve an EIR's Task Reference against the loaded tasks. `task` is null
 * when nothing matches, or when the reference fits several tasks — those are
 * in `ambiguous`, so the screen can offer them rather than guess.
 */
export function matchEirTaskReference<T extends TaskRef = Task>(
  raw: string | null | undefined,
  tasks: readonly T[],
): EirTaskReferenceMatch<T> {
  const none: EirTaskReferenceMatch<T> = { task: null, ambiguous: [] };
  const one = (task: T | undefined): EirTaskReferenceMatch<T> => ({ task: task ?? null, ambiguous: [] });
  const pick = (hits: T[]): EirTaskReferenceMatch<T> =>
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
export function resolveEirTaskReference<T extends TaskRef = Task>(
  raw: string | null | undefined,
  tasks: readonly T[],
): T | null {
  return matchEirTaskReference(raw, tasks).task;
}

// =============================================================================
// The other direction: a task's EIR Reference → the EIR it was promoted from.
//
// `EIRReference` is a Hyperlink column, and live it holds two shapes:
//
//   1. ARC's promotion writes `…/altronic-arc/eir/{id}`, labelled `EIR_2026-0245`.
//   2. The old Power App wrote the SharePoint form link —
//      `…/Lists/EIREngineering%20Information%20Request/DispForm.aspx?ID=768` —
//      as BOTH the url and the label. Every promotion before ARC (28 tasks,
//      2026-10-27) has this shape, and the task page didn't read it, so its
//      "From EIR" button opened SharePoint instead of the EIR.
//
// Some of those form links name an EIR id that no longer exists: the EIRs
// were re-created under new ids (EIR_2024-0396 is item 1492, not 396). The
// old app also put the EIR NUMBER in the task's title
// (`T40-0003-EIR_2024-0396 | …`), so when the id finds nothing the number
// does — but only when exactly one EIR carries it.
// =============================================================================

/** What the resolver needs from an EIR. */
type EirRef = Pick<Eir, "id" | "eirNo" | "taskReference">;
/** What the resolver needs from a task, for the EIR direction. */
type TaskWithEirRef = TaskRef & Pick<Task, "eirReference"> & { title?: string };

/**
 * Every EIR number written in a piece of text, canonicalised to
 * `EIR_YYYY-NNNN`. People write "EIR 2024-0371" and "EIR_2025-140" too.
 */
export function eirNumbersIn(text: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (text ?? "").matchAll(/EIR[_ ]?(\d{4})-(\d{3,4})(?!\d)/gi)) {
    out.add(`EIR_${m[1]}-${m[2].padStart(4, "0")}`);
  }
  return [...out];
}

/** The EIR item id a link carries — ARC `/eir/{id}` or a SharePoint form `?ID=`. */
export function eirIdFromLink(url: string | null | undefined): number | null {
  const text = url?.trim() ?? "";
  if (!/^https?:\/\//i.test(text)) return null;
  const m = /\/eir\/(\d+)(?:[/?#]|$)/i.exec(text) ?? /DispForm\.aspx\?(?:[^#]*&)?ID=(\d+)/i.exec(text);
  const n = parseInt(m?.[1] ?? "", 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

/**
 * The EIR a task's EIR Reference names: the id in the link if that EIR
 * exists, else the label as an EIR number, else an EIR number found in the
 * link or the task's title — each only when exactly one EIR matches.
 * Null when the task carries no EIR Reference at all: a title that merely
 * MENTIONS an EIR ("ECN for EIR_2025-0286") is not a promotion.
 */
export function eirForTask<E extends EirRef>(
  task: Pick<TaskWithEirRef, "eirReference" | "numberedTitle" | "title">,
  eirs: readonly E[],
): E | null {
  const ref: TaskEirReference | null = task.eirReference;
  if (!ref) return null;

  const id = eirIdFromLink(ref.url);
  if (id !== null) {
    const byId = eirs.find((e) => e.id === id);
    if (byId) return byId;
  }

  const byNumber = (no: string) => {
    const hits = eirs.filter((e) => norm(e.eirNo ?? "") === norm(no));
    return hits.length === 1 ? hits[0] : null;
  };
  const label = ref.label?.trim() ?? "";
  if (label && !/^https?:\/\//i.test(label)) {
    const hit = byNumber(label);
    if (hit) return hit;
  }

  const numbers = eirNumbersIn(`${ref.label ?? ""} ${task.numberedTitle ?? ""} ${task.title ?? ""}`);
  if (numbers.length === 1) return byNumber(numbers[0]);
  return null;
}

/**
 * The EIR a task is linked with, for mirroring comments — only when the two
 * records AGREE. The task's link names the EIR, and that EIR's own Task
 * Reference either names this task or is blank. When they disagree (two
 * "Test" tasks both claiming EIR_2025-0191, live) there is no link: copying a
 * comment onto the wrong record is worse than not copying it.
 *
 * A task with no usable EIR Reference falls back to the one EIR whose Task
 * Reference names it.
 */
export function linkedEirForTask<E extends EirRef, T extends TaskWithEirRef>(
  task: T,
  eirs: readonly E[],
  tasks: readonly T[],
): E | null {
  const named = eirForTask(task, eirs);
  if (named) {
    if (!named.taskReference?.trim()) return named;
    return resolveEirTaskReference(named.taskReference, tasks)?.id === task.id ? named : null;
  }
  const claiming = eirs.filter(
    (e) => e.taskReference?.trim() && resolveEirTaskReference(e.taskReference, tasks)?.id === task.id,
  );
  return claiming.length === 1 ? claiming[0] : null;
}

/**
 * The task an EIR is linked with, for mirroring comments — the same
 * agreement rule as `linkedEirForTask`, from the EIR's side.
 */
export function linkedTaskForEir<E extends EirRef, T extends TaskWithEirRef>(
  eir: E,
  tasks: readonly T[],
  eirs: readonly E[],
): T | null {
  const named = resolveEirTaskReference(eir.taskReference, tasks);
  if (named) {
    if (!named.eirReference) return named;
    return eirForTask(named, eirs)?.id === eir.id ? named : null;
  }
  const claiming = tasks.filter((t) => t.eirReference && eirForTask(t, eirs)?.id === eir.id);
  return claiming.length === 1 ? claiming[0] : null;
}
