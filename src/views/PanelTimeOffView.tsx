import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarOff, Gauge, Plus } from "lucide-react";
import type { PanelTimeOff } from "@/types/task";
import { usePanelTimeOff } from "@/hooks/usePanelTimeOff";
import { usePanelTeamAccess } from "@/hooks/usePanelRoles";
import { PANEL_TIME_OFF_CONFIGURED } from "@/api/panelTimeOff";
import { useSortableTable } from "@/hooks/useSortableTable";
import type { SortColumn } from "@/lib/tableSort";
import { formatSpDate } from "@/lib/spDates";
import { dayKeyOf, formatHours } from "@/lib/capacity";
import { toIsoDate } from "@/lib/dateInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { PanelTeamGate } from "@/components/PanelTeamGate";
import { PanelTimeOffFormModal } from "@/components/PanelTimeOffFormModal";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { isAccessDeniedError } from "@/lib/listAccess";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import { SearchInput } from "@/components/SearchInput";
import { CalendarDayPanel, MonthCalendar } from "@/components/MonthCalendar";
import { dayKey, monthKey, parseDayKey, parseMonthKey, shiftDay } from "@/lib/calendarGrid";
import {
  filterPanelTimeOff,
  panelTimeOffByDay,
  panelTimeOffLabel,
  panelTimeOffTitle,
} from "@/lib/panelTimeOff";
import { cn } from "@/lib/cn";

// =============================================================================
// Panel Time Off (BusinessIT#42) — the panel team's own "Where am I?". Who is
// out, when, and for how many hours a day; the Capacity view takes it out of
// that person's capacity.
//
// A month CALENDAR on desktop, like Engineering's Where Am I? (Tim,
// 2026-10-28) — the same shared components/MonthCalendar: click a day's date
// for the day panel (`?day=`), the "+" or the cell to add an entry starting
// that day, an entry to edit it. One entry shows on every day of its range.
// A phone gets the LIST, which opens on what's current and coming up; on
// desktop the list is one click away (`?view=list`), for past time off.
// Viewers see everything and add nothing.
// =============================================================================

const dateValue = (d: Date | null) => (d ? dayKeyOf(d) : "");

const COLUMNS: SortColumn<PanelTimeOff>[] = [
  { key: "person", label: "Who", value: (e) => (e.companyHoliday ? "Company holiday (everyone)" : e.person?.displayName ?? "") },
  { key: "reason", label: "Reason", value: (e) => e.reason, noFilter: true },
  {
    key: "start",
    label: "First day",
    kind: "date",
    value: (e) => formatSpDate(e.startDate),
    sortValue: (e) => e.startDate,
  },
  {
    key: "end",
    label: "Last day",
    kind: "date",
    value: (e) => formatSpDate(e.endDate),
    sortValue: (e) => e.endDate,
  },
  {
    key: "hours",
    label: "Off each day",
    value: (e) => (e.hoursPerDay === null ? "Whole day" : formatHours(e.hoursPerDay)),
  },
];

export function PanelTimeOffView() {
  return (
    <PanelTeamGate noun="panel time off">
      <TimeOffScreen />
    </PanelTeamGate>
  );
}

function TimeOffScreen() {
  const { data: entries = [], isLoading, error, refetch } = usePanelTimeOff();
  const access = usePanelTeamAccess();
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState<PanelTimeOff | "new" | null>(null);
  const [adding, setAdding] = useState<Date | null>(null);
  const [params, setParams] = useSearchParams();
  const gridAvailable = useKanbanAvailable();
  const calendar = gridAvailable && params.get("view") !== "list";
  const q = params.get("q") ?? "";
  const monthStart = parseMonthKey(params.get("month"));
  const selectedDay = calendar ? parseDayKey(params.get("day")) : null;
  const canAdd = access.canEdit && PANEL_TIME_OFF_CONFIGURED;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  /** Open (or move) the day panel, following the grid to that day's month. */
  function selectDay(day: Date | null) {
    const next = new URLSearchParams(params);
    if (day) {
      next.set("day", dayKey(day));
      if (monthKey(day) !== monthKey(monthStart)) next.set("month", monthKey(day));
    } else {
      next.delete("day");
    }
    setParams(next, { replace: true });
  }

  // Escape closes the day panel — not while the form is open over it, which
  // handles its own Escape (one thing at a time).
  const formOpen = editing !== null || adding !== null;
  useEffect(() => {
    if (!selectedDay || formOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") selectDay(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const filtered = useMemo(() => filterPanelTimeOff(entries, q), [entries, q]);
  const byDay = useMemo(() => panelTimeOffByDay(filtered), [filtered]);

  const today = toIsoDate(new Date());
  const current = useMemo(
    () => (showPast ? filtered : filtered.filter((e) => dateValue(e.endDate) >= today)),
    [filtered, showPast, today],
  );
  const pastCount = filtered.length - filtered.filter((e) => dateValue(e.endDate) >= today).length;

  const table = useSortableTable({
    rows: current,
    columns: COLUMNS,
    stableKey: (e) => e.id,
    initialKey: "start",
  });

  if (isLoading) return <LoadingTasks noun="panel time off" />;

  return (
    <div
      className={cn(
        "mx-auto flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6",
        calendar ? "max-w-[1600px]" : "max-w-[1100px]",
      )}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <CalendarOff className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Panel Time Off</h1>
          <p className="text-sm text-fg-muted">
            Who on the panel team is out, and when — the Capacity view lowers their hours to match.
          </p>
        </div>
        {gridAvailable && (
          <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="group" aria-label="Show">
            {(["calendar", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={(v === "calendar") === calendar}
                onClick={() => setParam("view", v === "list" ? "list" : "")}
                className={cn(
                  "rounded px-3 py-1 text-sm font-medium transition-colors",
                  (v === "calendar") === calendar ? "bg-accent text-white" : "text-fg-muted hover:text-fg",
                )}
              >
                {v === "calendar" ? "Calendar" : "List"}
              </button>
            ))}
          </div>
        )}
        <Link
          to="/panels/capacity"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          <Gauge className="h-4 w-4" />
          Capacity
        </Link>
        <button
          type="button"
          onClick={() => setEditing("new")}
          disabled={!canAdd}
          title={!access.canEdit ? access.hint : undefined}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add time off
        </button>
      </header>

      {!PANEL_TIME_OFF_CONFIGURED ? (
        <div className="rounded-md border border-ajax-yellow/50 bg-ajax-yellow/10 px-3 py-2 text-sm text-fg">
          Panel Time Off isn't set up yet: VITE_SP_PANEL_TIME_OFF_LIST_ID is not set. Until it is,
          the Capacity view assumes nobody is off.
        </div>
      ) : error ? (
        isAccessDeniedError(error) ? (
          <ListAccessNotice list="Panel Time Off" site="ALTRONICPANELTEAM" onRetry={() => refetch()} />
        ) : (
          <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-sm text-cooper-red">
            Couldn't load time off.{" "}
            <button type="button" onClick={() => refetch()} className="underline">
              Try again
            </button>
          </div>
        )
      ) : calendar ? (
        <>
          <SearchInput value={q} onChange={(v) => setParam("q", v)} placeholder="Search names and reasons…" />
          <div className={cn("grid items-start gap-4", selectedDay && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
            <MonthCalendar
              monthStart={monthStart}
              byDay={byDay}
              selectedKey={selectedDay ? dayKey(selectedDay) : null}
              onMonth={(next) => setParam("month", monthKey(next))}
              onSelectDay={selectDay}
              onAdd={canAdd ? setAdding : undefined}
              onEdit={setEditing}
              entryKey={(e) => e.id}
              entryLabel={panelTimeOffLabel}
              entryTitle={panelTimeOffTitle}
            />
            {selectedDay && (
              <CalendarDayPanel
                day={selectedDay}
                entries={byDay.get(dayKey(selectedDay)) ?? []}
                onStep={(by) => selectDay(shiftDay(selectedDay, by))}
                onClose={() => selectDay(null)}
                onAdd={canAdd ? () => setAdding(selectedDay) : undefined}
                onEdit={setEditing}
                entryKey={(e) => e.id}
                entryLabel={panelTimeOffLabel}
                renderEntry={(e) => (
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {e.companyHoliday ? "Company holiday (everyone)" : e.person?.displayName ?? "Someone"}
                    </span>
                    {e.reason && <span className="text-fg-muted">{e.reason}</span>}
                    <span className="text-xs text-fg-muted">
                      {e.hoursPerDay === null ? "Whole day" : `${formatHours(e.hoursPerDay)} off`}
                      {" · "}
                      {formatSpDate(e.startDate)}
                      {dateValue(e.endDate) !== dateValue(e.startDate) && ` – ${formatSpDate(e.endDate)}`}
                    </span>
                  </span>
                )}
                emptyText="Nobody on the panel team is off this day."
              />
            )}
          </div>
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
            <h2 className="text-sm font-medium text-fg">
              {table.rows.length} {showPast ? "entr" : "current or coming up"}
              {showPast ? (table.rows.length === 1 ? "y" : "ies") : ""}
            </h2>
            {pastCount > 0 && (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
                Show past ({pastCount})
              </label>
            )}
          </div>
          {table.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">
              {entries.length === 0 ? "No time off recorded." : "Nothing current or coming up."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-muted">
                    {COLUMNS.map((c) => (
                      <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setEditing(e)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-3 py-2 font-medium text-fg">
                        <button type="button" className="text-left hover:underline" onClick={() => setEditing(e)}>
                          {e.companyHoliday ? "Company holiday (everyone)" : e.person?.displayName ?? "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{e.reason || "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{formatSpDate(e.startDate)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatSpDate(e.endDate)}</td>
                      <td className="px-3 py-2">
                        {e.hoursPerDay === null ? "Whole day" : formatHours(e.hoursPerDay)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(editing || adding) && (
        <PanelTimeOffFormModal
          entry={editing && editing !== "new" ? editing : undefined}
          canEdit={access.canEdit}
          canManageHolidays={access.canManageCapacity}
          defaultDate={adding}
          onClose={() => {
            setEditing(null);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}
