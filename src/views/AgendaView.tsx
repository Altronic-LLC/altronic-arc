import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarClock, Eye, RotateCw } from "lucide-react";
import { useAgenda } from "@/hooks/useAgenda";
import {
  AGENDA_DAY_OPTIONS,
  groupAgenda,
  parseAgendaDays,
  type AgendaItem,
} from "@/lib/agenda";
import { isAccessDeniedError } from "@/lib/listAccess";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { cn } from "@/lib/cn";

// =============================================================================
// My agenda (`/agenda`) — BusinessIT#13. Every task and EIR with a date in the
// chosen window, for the signed-in person: Overdue first, then one group per
// day. Rules in `lib/agenda.ts`.
//
// The window and the Watching toggle live in the URL (`?days=`, `?watching=1`)
// so a view is shareable, and are REMEMBERED in this browser so the next visit
// opens the way the person left it. The URL wins when it says anything.
// localStorage is wrapped in try/catch: it throws outright in a private window
// or with site data blocked, and the page must still render.
// =============================================================================

const PREFS_KEY = "arc-agenda-prefs";

interface AgendaPrefs {
  days?: number;
  watching?: boolean;
}

function readPrefs(): AgendaPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as AgendaPrefs) : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: AgendaPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered — the status quo, and not worth telling anyone about.
  }
}

export function AgendaView() {
  const [params, setParams] = useSearchParams();
  const remembered = readPrefs();

  const days = parseAgendaDays(params.get("days") ?? String(remembered.days ?? ""));
  const includeWatching = params.has("watching")
    ? params.get("watching") === "1"
    : remembered.watching === true;

  useEffect(() => {
    writePrefs({ days, watching: includeWatching });
  }, [days, includeWatching]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  }

  const { items, now, isLoading, taskError, eirError, refetch } = useAgenda({
    days,
    includeWatching,
  });
  const groups = groupAgenda(items, now);

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">My Agenda</h1>
          <p className="text-sm text-fg-muted">
            Your Engineering tasks and EIRs that are overdue or coming due.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          role="group"
          aria-label="How far ahead"
          className="flex items-center gap-1 rounded-lg bg-surface-2 p-1"
        >
          {AGENDA_DAY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === days}
              onClick={() => setParam("days", String(option))}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                option === days
                  ? "bg-surface text-fg shadow-xs"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              Next {option} days
            </button>
          ))}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={includeWatching}
            onChange={(e) => setParam("watching", e.target.checked ? "1" : "0")}
            className="h-4 w-4 accent-accent"
          />
          Include items I'm watching
        </label>
      </div>

      {taskError != null && (
        <ReadFailure list="Project Task List" error={taskError} onRetry={refetch} />
      )}
      {eirError != null && <ReadFailure list="EIRs" error={eirError} onRetry={refetch} />}

      {isLoading ? (
        <LoadingTasks noun="your agenda" />
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-fg-muted">
          Nothing overdue or due in the next {days} days
          {includeWatching ? " on anything you're assigned to or watching." : " that's assigned to you."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <section
              key={group.key}
              aria-label={group.label}
              className={cn(
                "overflow-hidden rounded-xl border bg-surface",
                group.key === "overdue" ? "border-cooper-red/40" : "border-border",
              )}
            >
              <h2
                className={cn(
                  "flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold",
                  group.key === "overdue"
                    ? "border-cooper-red/40 bg-cooper-red/10 text-cooper-red"
                    : "border-border bg-surface-2 text-fg",
                )}
              >
                {group.key === "overdue" && <AlertTriangle className="h-4 w-4" />}
                {group.label}
                <span className="font-normal text-fg-muted">({group.items.length})</span>
              </h2>
              <ul className="divide-y divide-border">
                {group.items.map((item) => (
                  <AgendaRow key={item.key} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const date = item.date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <li>
      <Link
        to={item.path}
        className="flex flex-col gap-1 px-3 py-2.5 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-3"
      >
        <span
          className={cn(
            "w-fit shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            item.kind === "task"
              ? "bg-superior-blue/10 text-superior-blue"
              : "bg-cooper-green/10 text-cooper-green",
          )}
        >
          {item.kind === "task" ? "Task" : "EIR"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">
            {item.kind === "eir" ? `${item.reference} — ${item.title}` : item.reference}
          </span>
          <span className="block truncate text-xs text-fg-muted">
            {[item.status, ...item.projects].join(" · ")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs">
          {item.watchingOnly && (
            <span
              className="inline-flex items-center gap-1 text-fg-muted"
              title="On your agenda because you watch it"
            >
              <Eye className="h-3 w-3" />
              Watching
            </span>
          )}
          <span className={item.overdue ? "font-semibold text-cooper-red" : "text-fg-muted"}>
            {item.dateLabel} {date}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * A list that failed to load is SAID, never shown as an empty agenda — the
 * one thing an agenda must not do is tell somebody they have nothing due
 * because it couldn't look.
 */
function ReadFailure({
  list,
  error,
  onRetry,
}: {
  list: string;
  error: unknown;
  onRetry: () => void;
}) {
  if (isAccessDeniedError(error)) {
    return <ListAccessNotice list={list} site="Altronic_Engineering" onRetry={onRetry} />;
  }
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-cooper-red/40 bg-cooper-red/5 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cooper-red" />
      <div className="min-w-0">
        <div className="font-medium text-fg">Couldn't load the {list}</div>
        <div className="mt-0.5 text-fg-muted">
          Anything on it is missing from your agenda below.
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    </div>
  );
}

export default AgendaView;
