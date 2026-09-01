import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMaintenanceTasks } from "@/hooks/useMaintenanceTasks";
import { useScheduledMaintenance } from "@/hooks/useScheduledMaintenance";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import { manageSchedulesGate } from "@/lib/maintenanceRoles";
import { useIsPhone } from "@/hooks/useIsPhone";
import {
  buildMaintenanceAgenda,
  buildMaintenanceCalendarMonth,
  maintenanceAssigneeOptions,
  maintenanceEquipmentOptions,
  MAINTENANCE_TYPE_OPTIONS,
  type MaintenanceCalendarEntry,
  type MaintenanceCalendarFilters,
} from "@/lib/maintenanceCalendar";
import {
  currentMonthStart,
  dayKey,
  dayLabel,
  monthKey,
  monthLabel,
  parseMonthKey,
  relativeDayLabel,
  shiftMonth,
  WEEKDAYS,
} from "@/lib/calendarGrid";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ChoicePills } from "@/components/ChoicePills";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { LogPmCompletionModal } from "@/components/LogPmCompletionModal";
import { ScheduledMaintenanceFormModal } from "@/components/ScheduledMaintenanceFormModal";
import { MaintenanceTaskFormModal } from "@/components/MaintenanceTaskFormModal";
import { MaintenanceViewSwitcher } from "@/components/MaintenanceViewSwitcher";
import {
  MaintenancePriorityFlag,
  MaintenanceStatusBadge,
  PROJECTED_OUTLINE_CLASS,
  ScheduledChip,
} from "@/components/maintenanceAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// The maintenance calendar — the CMMS module's flagship screen.
//
// It answers "what is due, and when", across BOTH things that can be due:
//
//   **Solid chips are real work orders.** A row on the list, with a status, an
//   assignee and a history. Clicking one opens it.
//   **Dashed chips are projected PM occurrences.** They exist only in this
//   browser tab — a date a schedule implies, with no record behind it. There
//   is nothing to open; clicking one offers to Start / Complete / Skip it,
//   which is what MAKES the work order.
//
// That distinction is the single thing this screen has to get across, so it is
// carried three ways at once: the dashed outline (`PROJECTED_OUTLINE_CLASS`),
// the "Scheduled" chip in the expanded renderings, and a legend above the grid
// that says it in words. One signal would be a guess; three is a rule.
//
// **Overdue work never leaves the screen.** A PM that was due in July is still
// outstanding in September, and paging the grid to September must not make it
// vanish — so it keeps its real place in the grid AND is listed in the overdue
// strip, which shows on every month. Nothing here re-dates an occurrence to
// today; that is the projection engine's rule and this view only renders it.
//
// **A phone gets an agenda, not a redirect.** Seven columns at 45px each is a
// rumour of a calendar (the same finding as "Where am I?"), and there is
// nowhere else to send someone — so the phone gets a rendering of the same
// filtered set, grouped Today / Tomorrow / Thu, Sep 3.
//
// Every date is handled in UTC terms, like every other calendar in ARC.
// =============================================================================

const FILTER_KEYS = ["type", "assigned", "equipment"] as const;

/** The filter params as a `?…` suffix, for links to the PM library and back. */
export function maintenanceCalendarFilterSearch(search: string): string {
  const from = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = from.get(key);
    if (value) out.set(key, value);
  }
  const query = out.toString();
  return query ? `?${query}` : "";
}

export default function MaintenanceCalendarView() {
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const { data: tasks = [], isLoading: tasksLoading } = useMaintenanceTasks();
  const { data: schedules = [], isLoading: schedulesLoading } = useScheduledMaintenance();
  /**
   * Adding a schedule from a day cell is maintenance-admin only.
   *
   * When they can't, the cell stops being clickable and the "+" is gone —
   * rather than opening a form whose Create button is dead. Clicking a
   * dashed PM chip still opens the log modal for everyone: that modal
   * explains the tech gate itself, and a chip that silently does nothing
   * is worse than one that tells you why.
   */
  const canAddSchedule = manageSchedulesGate(useMyMaintenanceRoles()).allowed;

  /** The projected occurrence being logged — schedule plus the day it fell on. */
  const [logging, setLogging] = useState<MaintenanceCalendarEntry | null>(null);
  /** The day whose "add" affordance was used — seeds a new schedule's first due. */
  const [addingOn, setAddingOn] = useState<Date | null>(null);
  const [addingWorkOrder, setAddingWorkOrder] = useState(false);

  const filters: MaintenanceCalendarFilters = useMemo(
    () => ({
      type: params.get("type") ?? "",
      assigned: (params.get("assigned") ?? "").toLowerCase(),
      equipment: params.get("equipment") ?? "",
    }),
    [params],
  );

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const monthStart = parseMonthKey(params.get("month"));
  // "Now" is read once per render and passed down, never called inside the
  // maths — the same rule the projection engine follows.
  const now = new Date();

  const month = useMemo(
    () => buildMaintenanceCalendarMonth({ monthStart, tasks, schedules, now, filters }),
    // `now` is deliberately not a dependency: it changes every render and the
    // day it lands on is what matters, which the other inputs already imply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthStart, tasks, schedules, filters],
  );
  const agenda = useMemo(
    () => buildMaintenanceAgenda({ tasks, schedules, now, filters }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, schedules, filters],
  );

  const assigneeOptions = useMemo(
    () => maintenanceAssigneeOptions(tasks, schedules),
    [tasks, schedules],
  );
  const equipmentOptions = useMemo(
    () => maintenanceEquipmentOptions(tasks, schedules),
    [tasks, schedules],
  );

  const isLoading = tasksLoading || schedulesLoading;

  function openEntry(entry: MaintenanceCalendarEntry) {
    // A real work order has a page. A projection has nothing to open — it is
    // not a record yet — so it offers the three ways of making it one.
    if (entry.kind === "work-order" && entry.task) {
      navigate(`/operations/maintenance-task/${entry.task.id}`);
      return;
    }
    if (entry.schedule) setLogging(entry);
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Maintenance Calendar
          </h1>
          <p className="text-sm text-fg-muted">
            {isPhone
              ? "Everything outstanding and coming up."
              : canAddSchedule
                ? "Work orders and every PM the schedules say is due. Click a day to add a schedule for it."
                : "Work orders and every PM the schedules say is due."}
          </p>
        </div>
        {/* Raising a one-off job is the single most common thing anyone does
            here, and the calendar is where people land from the dashboard —
            so it needs its own button. The day "+" seeds a SCHEDULE from that
            date, which is a different (and much rarer) action. */}
        <button
          type="button"
          onClick={() => setAddingWorkOrder(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New work order
        </button>
      </header>

      <MaintenanceViewSwitcher />

      <div
        role="search"
        aria-label="Maintenance calendar filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3"
      >
        {/* Three options — pills, not a dropdown. */}
        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Type
          </span>
          <ChoicePills
            label="Type"
            name="maintenance-calendar-type"
            options={MAINTENANCE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={filters.type}
            onChange={(v) => setParam("type", v)}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Assigned
          </span>
          <ChoiceSelect
            value={filters.assigned}
            onChange={(v) => setParam("assigned", v)}
            options={assigneeOptions}
            emptyLabel="Anyone"
            searchPlaceholder="Search people…"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Equipment
          </span>
          <ChoiceSelect
            value={filters.equipment}
            onChange={(v) => setParam("equipment", v)}
            options={equipmentOptions}
            emptyLabel="Any asset"
            searchPlaceholder="Search assets…"
          />
        </label>
      </div>

      {isLoading ? (
        <LoadingTasks noun="the maintenance calendar" />
      ) : (
        <>
          <OverdueStrip entries={month.overdue} onOpen={openEntry} />

          {isPhone ? (
            <Agenda groups={agenda} now={now} onOpen={openEntry} />
          ) : (
            <>
              <Legend />
              <MonthGrid
                monthStart={monthStart}
                days={month.days}
                byDay={month.byDay}
                count={month.entries.length}
                onMonth={(next) => setParam("month", monthKey(next))}
                onAdd={canAddSchedule ? setAddingOn : null}
                onOpen={openEntry}
              />
            </>
          )}
        </>
      )}

      {logging?.schedule && (
        <LogPmCompletionModal
          schedule={logging.schedule}
          occurrence={logging.date}
          onClose={() => setLogging(null)}
          onCreated={(id) => navigate(`/operations/maintenance-task/${id}`)}
        />
      )}

      {addingOn && (
        <ScheduledMaintenanceFormModal
          defaultDate={addingOn}
          onClose={() => setAddingOn(null)}
        />
      )}

      {addingWorkOrder && (
        <MaintenanceTaskFormModal mode="create" onClose={() => setAddingWorkOrder(false)} />
      )}
    </div>
  );
}

/** Says in words what the dashed outline means. */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-6 rounded border border-border bg-surface" aria-hidden="true" />
        Work order — a real, logged job
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-3 w-6 rounded", PROJECTED_OUTLINE_CLASS)} aria-hidden="true" />
        Scheduled — projected from a PM schedule, nothing logged yet
      </span>
    </div>
  );
}

/**
 * Everything late, on every month.
 *
 * The grid keeps an overdue occurrence on the day it was actually due, which
 * is right — and means it is off-screen the moment somebody pages forward.
 * This strip is the other half of "an overdue occurrence never disappears".
 */
function OverdueStrip({
  entries,
  onOpen,
}: {
  entries: MaintenanceCalendarEntry[];
  onOpen: (entry: MaintenanceCalendarEntry) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section
      aria-label="Overdue maintenance"
      className="rounded-xl border border-cooper-red/40 bg-cooper-red/[0.04] p-3"
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-cooper-red">
        Overdue — {entries.length} outstanding
      </h2>
      <p className="mt-0.5 text-[11px] text-fg-muted">
        Still due on the date below. Nothing rolls forward on its own — close it out to clear it.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.key}>
            <button
              type="button"
              onClick={() => onOpen(entry)}
              className={cn(
                "flex w-full flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2",
                entry.kind === "projected"
                  ? PROJECTED_OUTLINE_CLASS
                  : "border border-border bg-surface",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-fg">{entry.title}</span>
              {entry.kind === "projected" ? (
                <ScheduledChip />
              ) : (
                entry.status && <MaintenanceStatusBadge status={entry.status} />
              )}
              <MaintenancePriorityFlag priority={entry.priority} />
              <span className="text-xs font-semibold text-cooper-red">
                Due {entry.date.toLocaleDateString(undefined, {
                  timeZone: "UTC",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MonthGrid({
  monthStart,
  days,
  byDay,
  count,
  onMonth,
  onAdd,
  onOpen,
}: {
  monthStart: Date;
  days: Date[];
  byDay: Map<string, MaintenanceCalendarEntry[]>;
  count: number;
  onMonth: (next: Date) => void;
  /**
   * Seed a new schedule from a day. **`null` when the viewer isn't a
   * maintenance admin** — the day cell then isn't clickable and the "+" isn't
   * rendered at all, rather than offering a form they can't submit.
   */
  onAdd: ((day: Date) => void) | null;
  onOpen: (entry: MaintenanceCalendarEntry) => void;
}) {
  const todayKey = dayKey(new Date());
  const thisMonth = monthKey(monthStart);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMonth(shiftMonth(monthStart, -1))}
            aria-label="Previous month"
            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => onMonth(shiftMonth(monthStart, 1))}
            aria-label="Next month"
            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="ml-2 font-display text-base font-semibold text-fg">
            {monthLabel(monthStart)}
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span>
            {count} due this view
          </span>
          <button
            onClick={() => onMonth(currentMonthStart())}
            className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-fg transition-colors hover:bg-surface-2"
          >
            Today
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-1.5 text-center">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const entries = byDay.get(key) ?? [];
          const otherMonth = monthKey(day) !== thisMonth;
          return (
            <div
              key={key}
              // A div, not a button: it CONTAINS buttons (the chips), and
              // nesting those inside a button is invalid. The labelled "Add"
              // button below is what a screen reader gets.
              onClick={onAdd ? () => onAdd(day) : undefined}
              className={cn(
                "group flex min-h-[7rem] flex-col gap-1 border-b border-r border-border p-1.5 transition-colors last:border-r-0 hover:bg-surface-2",
                onAdd && "cursor-pointer",
                otherMonth && "bg-surface-2/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                    key === todayKey && "bg-accent font-semibold text-white",
                    key !== todayKey && otherMonth && "text-fg-muted/60",
                    key !== todayKey && !otherMonth && "text-fg-muted",
                  )}
                >
                  {day.getUTCDate()}
                </span>
                {onAdd && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(day);
                    }}
                    aria-label={`Add a maintenance schedule starting ${dayLabel(day)}`}
                    title={`Add a maintenance schedule starting ${dayLabel(day)}`}
                    className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Scrolls rather than truncating to "+3 more": a busy day is
                  exactly the day whose jobs you want to read. */}
              <div className="flex max-h-[6rem] flex-col gap-1 overflow-y-auto">
                {entries.map((entry) => (
                  <DayChip key={entry.key} entry={entry} onOpen={onOpen} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function chipTitle(entry: MaintenanceCalendarEntry): string {
  const bits = [entry.title];
  if (entry.kind === "projected") {
    bits.push("Scheduled — nothing logged yet. Start, complete or skip it to create the work order.");
  } else if (entry.status) {
    bits.push(entry.status);
  }
  if (entry.equipment?.title) bits.push(entry.equipment.title);
  if (entry.assigned?.displayName) bits.push(entry.assigned.displayName);
  if (entry.overdue) bits.push("Overdue");
  return bits.join(" · ");
}

/** One chip in a day cell. Solid = real; dashed = projected. */
function DayChip({
  entry,
  onOpen,
}: {
  entry: MaintenanceCalendarEntry;
  onOpen: (entry: MaintenanceCalendarEntry) => void;
}) {
  const projected = entry.kind === "projected";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(entry);
      }}
      title={chipTitle(entry)}
      className={cn(
        "flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] transition-colors hover:border-accent",
        projected ? PROJECTED_OUTLINE_CLASS : "border border-border bg-surface",
        entry.overdue ? "text-cooper-red" : "text-fg",
      )}
    >
      {/* The screen-reader half of the solid/dashed distinction — the outline
          alone says nothing to anyone not looking at it. */}
      <span className="sr-only">{projected ? "Scheduled — " : "Work order — "}</span>
      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
      {entry.overdue && <span className="sr-only">Overdue</span>}
    </button>
  );
}

/**
 * The phone rendering: outstanding and upcoming work, grouped by day.
 *
 * Not a redirect — there is nowhere else to send someone, and this answers the
 * question people open the calendar on a phone to ask.
 */
function Agenda({
  groups,
  now,
  onOpen,
}: {
  groups: Array<{ day: string; date: Date; entries: MaintenanceCalendarEntry[] }>;
  now: Date;
  onOpen: (entry: MaintenanceCalendarEntry) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-fg-muted">
        Nothing due in the next two months.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <section
          key={group.day}
          className="overflow-hidden rounded-xl border border-border bg-surface"
        >
          <h2 className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-semibold text-fg">
            {relativeDayLabel(group.date, now)}
          </h2>
          <ul className="divide-y divide-border">
            {group.entries.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      "block truncate text-sm",
                      entry.overdue ? "font-semibold text-cooper-red" : "text-fg",
                    )}
                  >
                    {entry.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    {entry.kind === "projected" ? (
                      <ScheduledChip />
                    ) : (
                      entry.status && <MaintenanceStatusBadge status={entry.status} />
                    )}
                    <MaintenancePriorityFlag priority={entry.priority} />
                    {entry.equipment?.title && (
                      <span className="truncate text-xs text-fg-muted">
                        {entry.equipment.title}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
