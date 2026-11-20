import type { Eir, EirStatus, Person, Task } from "@/types/task";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { toIsoDate } from "@/lib/dateInput";

// =============================================================================
// My agenda — every Engineering task and EIR with a date coming up, for the
// signed-in person (BusinessIT#13, Thomas Terhune; built 2026-10-13, Tim).
//
// The request was reminder EMAILS as a due date gets close. ARC has no server
// or scheduler, so an email needs a Power Automate flow; this is the half that
// needs nothing new — the lists are already in the browser — and the email,
// when it comes, can link straight here.
//
// Pure: no React, no clock (`now` is passed in), no URL.
//
// **Days are LOCAL, not UTC.** Task DueDate and EIR Requested Completion are
// read as instants and every other screen shows them with local getters
// (`DueDateBadge`, the detail pages). `lib/calendarGrid.ts` is UTC because the
// date-only lists it serves are normalised to midday UTC; these two aren't, so
// borrowing it would put an item due today under yesterday for half the day.
// =============================================================================

/** The window choices the agenda offers, in days from today. */
export const AGENDA_DAY_OPTIONS = [7, 14, 30, 90] as const;
export type AgendaDays = (typeof AGENDA_DAY_OPTIONS)[number];
export const DEFAULT_AGENDA_DAYS: AgendaDays = 14;

/**
 * EIR statuses with nothing left for the ASSIGNED ENGINEER to do.
 *
 * Not just Closed (`isOpenEir`'s rule, which is right for a list of every
 * EIR): "EIR Not Accepted" was rejected outright, and "Response Accepted" is
 * waiting on Sheila or Ray to close it, not on the engineer. Listing either as
 * overdue nags somebody about finished work, which is how people learn to
 * ignore a reminder. "Response Not Accepted" stays — the engineer is asked to
 * revisit it.
 */
export const EIR_STATUSES_OFF_AGENDA: readonly EirStatus[] = [
  "Closed",
  "EIR Not Accepted",
  "Response Accepted",
];

export type AgendaKind = "task" | "eir";

export interface AgendaItem {
  /** `task:12` / `eir:34` — unique across both lists. */
  key: string;
  kind: AgendaKind;
  id: number;
  /** "T3-0017-Title" for a task, "EIR_2026-0042" for an EIR. */
  reference: string;
  title: string;
  status: string;
  /** Project titles, parent first. */
  projects: string[];
  date: Date;
  /** What the date IS — a task's due date or an EIR's requested completion. */
  dateLabel: "Due" | "Requested completion";
  /** Local `yyyy-mm-dd` of `date`. */
  dayKey: string;
  /** Before today. */
  overdue: boolean;
  /** True when the item is on the agenda only because the person watches it. */
  watchingOnly: boolean;
  /** Router path to the item. */
  path: string;
}

export interface AgendaOptions {
  /** Every address the signed-in person answers to (`useCurrentUserEmails`). */
  emails: string[];
  days: number;
  /** Also include items the person only watches. */
  includeWatching: boolean;
  now: Date;
}

export interface AgendaGroup {
  /** `overdue`, or a local `yyyy-mm-dd`. */
  key: string;
  label: string;
  items: AgendaItem[];
}

/**
 * Read `?days=` (or a remembered value). Anything that isn't one of the
 * offered choices falls back to the default rather than producing a window
 * the picker can't show.
 */
export function parseAgendaDays(raw: string | null | undefined): AgendaDays {
  const n = Number(raw);
  return (AGENDA_DAY_OPTIONS as readonly number[]).includes(n)
    ? (n as AgendaDays)
    : DEFAULT_AGENDA_DAYS;
}

/** Local midnight of `now`'s day. */
function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Local midnight `n` days after `day`. */
function addLocalDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

function involves(people: Person[], emails: string[]): boolean {
  return people.some((p) => matchesAnyEmail(emails, p.email));
}

function relation(
  assigned: Person[],
  watchers: Person[],
  opts: AgendaOptions,
): "assigned" | "watching" | null {
  if (opts.emails.length === 0) return null;
  if (involves(assigned, opts.emails)) return "assigned";
  if (opts.includeWatching && involves(watchers, opts.emails)) return "watching";
  return null;
}

/**
 * Inside the window: anything overdue (however long ago — an overdue item
 * never ages off the agenda, it stays until it's done or re-dated), plus
 * today through `days` days from today.
 */
function inWindow(date: Date, opts: AgendaOptions): boolean {
  const end = addLocalDays(startOfLocalDay(opts.now), opts.days + 1);
  return date.getTime() < end.getTime();
}

function toItem(
  base: Omit<AgendaItem, "dayKey" | "overdue">,
  now: Date,
): AgendaItem {
  return {
    ...base,
    dayKey: toIsoDate(base.date),
    overdue: base.date.getTime() < startOfLocalDay(now).getTime(),
  };
}

/**
 * Every task and EIR on the person's agenda, soonest first.
 *
 * A task counts when they're in Assigned (or Watchers, with `includeWatching`)
 * and it isn't Complete. An EIR counts when they're an assigned engineer (or
 * a watcher) and it isn't in `EIR_STATUSES_OFF_AGENDA`. Undated items are
 * left out — there's no honest place to put them on an agenda.
 */
export function buildAgenda(tasks: Task[], eirs: Eir[], opts: AgendaOptions): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const task of tasks) {
    if (!task.dueDate || task.status === "Complete") continue;
    const rel = relation(task.assigned, task.watchers, opts);
    if (!rel || !inWindow(task.dueDate, opts)) continue;
    const projects = [task.parentProject, ...task.relatedProjects]
      .filter((p): p is NonNullable<typeof p> => !!p && !!p.title)
      .map((p) => p.title);
    items.push(
      toItem(
        {
          key: `task:${task.id}`,
          kind: "task",
          id: task.id,
          reference: task.numberedTitle || `Task ${task.id}`,
          title: task.title,
          status: task.status,
          projects: [...new Set(projects)],
          date: task.dueDate,
          dateLabel: "Due",
          watchingOnly: rel === "watching",
          path: `/task/${task.id}`,
        },
        opts.now,
      ),
    );
  }

  for (const eir of eirs) {
    const date = eir.requestedCompletionDate;
    if (!date || EIR_STATUSES_OFF_AGENDA.includes(eir.status)) continue;
    const rel = relation(eir.assignedEngineers, eir.watchers, opts);
    if (!rel || !inWindow(date, opts)) continue;
    items.push(
      toItem(
        {
          key: `eir:${eir.id}`,
          kind: "eir",
          id: eir.id,
          reference: eir.eirNo || `EIR ${eir.id}`,
          title: eir.title,
          status: eir.status,
          projects: eir.parentProjects.map((p) => p.title).filter(Boolean),
          date,
          dateLabel: "Requested completion",
          watchingOnly: rel === "watching",
          path: `/eir/${eir.id}`,
        },
        opts.now,
      ),
    );
  }

  // Soonest first; same instant → tasks before EIRs, then by reference, so
  // the order is stable and doesn't reshuffle on a refetch.
  return items.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.kind.localeCompare(b.kind) ||
      a.reference.localeCompare(b.reference),
  );
}

/** "Today" / "Tomorrow" / "Thu, Oct 15" for a local `yyyy-mm-dd`. */
export function agendaDayLabel(dayKey: string, now: Date): string {
  const today = startOfLocalDay(now);
  if (dayKey === toIsoDate(today)) return "Today";
  if (dayKey === toIsoDate(addLocalDays(today, 1))) return "Tomorrow";
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Overdue first, as ONE group (oldest at the top — it's been waiting
 * longest), then one group per day. Expects `buildAgenda`'s sorted output.
 */
export function groupAgenda(items: AgendaItem[], now: Date): AgendaGroup[] {
  const groups: AgendaGroup[] = [];
  const overdue = items.filter((i) => i.overdue);
  if (overdue.length > 0) groups.push({ key: "overdue", label: "Overdue", items: overdue });

  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    if (item.overdue) continue;
    const list = byDay.get(item.dayKey) ?? [];
    list.push(item);
    byDay.set(item.dayKey, list);
  }
  for (const [key, dayItems] of byDay) {
    groups.push({ key, label: agendaDayLabel(key, now), items: dayItems });
  }
  return groups;
}

/**
 * The header badge's number: overdue plus due today, ASSIGNED only. Watching
 * is deliberately not counted — a badge on every page for work that isn't
 * yours trains people to ignore it.
 */
export function agendaAttentionCount(
  tasks: Task[],
  eirs: Eir[],
  emails: string[],
  now: Date,
): number {
  return buildAgenda(tasks, eirs, { emails, days: 0, includeWatching: false, now }).length;
}
