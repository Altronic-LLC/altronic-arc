import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, ClipboardCheck, ListChecks, Pencil, Plus } from "lucide-react";
import type { ScheduledMaintenance } from "@/types/task";
import {
  useScheduledMaintenance,
  useSetScheduleActive,
} from "@/hooks/useScheduledMaintenance";
import {
  anchorDueDate,
  daysUntilDue,
  frequencyLabel,
} from "@/lib/maintenanceSchedule";
import {
  compareScheduledMaintenance,
  scheduledMaintenanceLabel,
} from "@/lib/scheduledMaintenanceMapper";
import { maintenanceAssigneeOptions, maintenanceEquipmentOptions } from "@/lib/maintenanceCalendar";
import { matchesTokens } from "@/lib/itemSearch";
import { personKey } from "@/lib/people";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoicePills } from "@/components/ChoicePills";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { LogPmCompletionModal } from "@/components/LogPmCompletionModal";
import { ScheduledMaintenanceFormModal } from "@/components/ScheduledMaintenanceFormModal";
import {
  DueInLabel,
  MaintenancePriorityFlag,
  ScheduleBasisChip,
} from "@/components/maintenanceAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// The PM library — every maintenance schedule, and what each one is doing.
//
// The calendar answers "what is due"; this answers "what rules produce it".
// It is where a schedule is created, corrected, retired and — when somebody
// does a job off the back of a paper round rather than the calendar — logged.
//
// Three things worth knowing:
//
//  - **A schedule is never deleted, only retired.** `Active` is a toggle, and
//    an inactive schedule projects nothing at all while every work order it
//    ever produced still points at something real. That is why there is no
//    delete here and no delete in the API (see useScheduledMaintenance.ts).
//  - **The due date shown is `anchorDueDate`**, not the stored `NextDueDate` —
//    a Floating schedule derives it from its last completion, so reading the
//    column directly would disagree with the calendar for exactly the
//    schedules people most often check.
//  - **An overdue schedule stays at the top and says how late it is.** It does
//    not roll forward on its own, and nothing here hides it.
// =============================================================================

/** Render cap, same as every other big list in ARC. Filtering is never capped. */
const INITIAL_ROWS = 150;

const ACTIVE_OPTIONS = [
  { value: "", label: "Active" },
  { value: "retired", label: "Retired" },
  { value: "all", label: "All" },
] as const;

export default function PmLibraryView() {
  const [params, setParams] = useSearchParams();
  const { data: schedules = [], isLoading } = useScheduledMaintenance();
  const setActive = useSetScheduleActive();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScheduledMaintenance | null>(null);
  const [logging, setLogging] = useState<ScheduledMaintenance | null>(null);
  const [showAll, setShowAll] = useState(false);

  const q = params.get("q") ?? "";
  const state = params.get("state") ?? "";
  const assigned = (params.get("assigned") ?? "").toLowerCase();
  const equipment = params.get("equipment") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  // The cap exists for the unfiltered case; once somebody has narrowed down,
  // re-hiding rows they just filtered to would be perverse.
  useEffect(() => {
    setShowAll(false);
  }, [q, state, assigned, equipment]);

  const now = new Date();

  const filtered = useMemo(() => {
    return schedules
      .filter((s) => {
        if (state === "" && !s.active) return false;
        if (state === "retired" && s.active) return false;
        if (assigned && (!s.assignedTo || personKey(s.assignedTo) !== assigned)) return false;
        if (equipment && String(s.equipment?.lookupId ?? "") !== equipment) return false;
        if (!q.trim()) return true;
        const haystack = [
          s.title,
          s.instructions,
          s.equipment?.title ?? "",
          s.assignedTo?.displayName ?? "",
          s.category ?? "",
          frequencyLabel(s.frequencyInterval, s.frequencyUnit),
        ].join(" ");
        return matchesTokens(haystack, q);
      })
      .sort(compareScheduledMaintenance);
  }, [schedules, q, state, assigned, equipment]);

  const shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  const assigneeOptions = useMemo(
    () => maintenanceAssigneeOptions([], schedules),
    [schedules],
  );
  const equipmentOptions = useMemo(
    () => maintenanceEquipmentOptions([], schedules),
    [schedules],
  );

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <ListChecks className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">PM Library</h1>
          <p className="text-sm text-fg-muted">
            Every maintenance schedule — what it covers, how often, and when it's next due.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/operations/maintenance/calendar"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <CalendarDays className="h-4 w-4" />
            Calendar
          </Link>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New schedule
          </button>
        </div>
      </header>

      <div
        role="search"
        aria-label="PM schedule filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Showing
          </span>
          <ChoicePills
            label="Showing"
            name="pm-library-state"
            options={ACTIVE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={state}
            onChange={(v) => setParam("state", v)}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Owner
          </span>
          <ChoiceSelect
            value={assigned}
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
            value={equipment}
            onChange={(v) => setParam("equipment", v)}
            options={equipmentOptions}
            emptyLabel="Any asset"
            searchPlaceholder="Search assets…"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Search
          </span>
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Name, asset, instructions…"
          />
        </label>
      </div>

      {isLoading ? (
        <LoadingTasks noun="the PM library" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-fg-muted">
          No schedules match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <Th>Schedule</Th>
                  <Th>Equipment</Th>
                  <Th>Frequency</Th>
                  <Th>Next due</Th>
                  <Th>Owner</Th>
                  <Th>Active</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((schedule) => (
                  <ScheduleRow
                    key={schedule.id}
                    schedule={schedule}
                    now={now}
                    onEdit={() => setEditing(schedule)}
                    onLog={() => setLogging(schedule)}
                    onToggleActive={() =>
                      setActive.mutate({ id: schedule.id, active: !schedule.active })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
            <span>
              Showing {shown.length} of {filtered.length}
            </span>
            {shown.length < filtered.length && (
              <button
                onClick={() => setShowAll(true)}
                className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-fg transition-colors hover:bg-surface-2"
              >
                Show all
              </button>
            )}
          </div>
        </div>
      )}

      {(creating || editing) && (
        <ScheduledMaintenanceFormModal
          schedule={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {logging && (
        <LogPmCompletionModal
          schedule={logging}
          occurrence={anchorDueDate(logging) ?? new Date()}
          onClose={() => setLogging(null)}
        />
      )}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      scope="col"
      className={cn("px-3 py-2 font-semibold", align === "right" ? "text-right" : "text-left")}
    >
      {children}
    </th>
  );
}

function ScheduleRow({
  schedule,
  now,
  onEdit,
  onLog,
  onToggleActive,
}: {
  schedule: ScheduledMaintenance;
  now: Date;
  onEdit: () => void;
  onLog: () => void;
  onToggleActive: () => void;
}) {
  // The OUTSTANDING occurrence, not the stored column: a Floating schedule
  // derives it from its last completion.
  const due = anchorDueDate(schedule);
  const days = schedule.active ? daysUntilDue(schedule, now) : null;

  return (
    <tr className={cn("align-top", !schedule.active && "opacity-60")}>
      <td className="px-3 py-2">
        <div className="font-medium text-fg">{schedule.title || scheduledMaintenanceLabel(schedule)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <MaintenancePriorityFlag priority={schedule.priority} />
          {schedule.category && (
            <span className="text-xs text-fg-muted">{schedule.category}</span>
          )}
          {schedule.requiresShutdown && (
            <span className="rounded bg-ajax-yellow/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ajax-yellow">
              Shutdown
            </span>
          )}
          {schedule.lotoRequired && (
            <span className="rounded bg-cooper-red/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cooper-red">
              LOTO
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-fg-muted">{schedule.equipment?.title || "—"}</td>
      <td className="px-3 py-2">
        <div className="text-fg">
          {frequencyLabel(schedule.frequencyInterval, schedule.frequencyUnit)}
        </div>
        <div className="mt-1">
          <ScheduleBasisChip basis={schedule.scheduleBasis} />
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="tabular-nums text-fg">
          {due
            ? due.toLocaleDateString(undefined, {
                timeZone: "UTC",
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "Not scheduled"}
        </div>
        <div className="mt-0.5">
          <DueInLabel days={days} />
        </div>
      </td>
      <td className="px-3 py-2 text-fg-muted">{schedule.assignedTo?.displayName || "Not set"}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          role="switch"
          aria-checked={schedule.active}
          onClick={onToggleActive}
          title={
            schedule.active
              ? "Retire this schedule — it stops projecting occurrences and keeps its work orders."
              : "Reinstate this schedule so it starts projecting again."
          }
          className={cn(
            "inline-flex h-5 w-9 items-center rounded-full border transition-colors",
            schedule.active ? "border-cooper-green bg-cooper-green/30" : "border-border bg-surface-2",
          )}
        >
          <span className="sr-only">{schedule.active ? "Active" : "Retired"}</span>
          <span
            aria-hidden="true"
            className={cn(
              "h-3.5 w-3.5 rounded-full transition-transform",
              schedule.active
                ? "translate-x-[1.15rem] bg-cooper-green"
                : "translate-x-[0.15rem] bg-fg-muted",
            )}
          />
        </button>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onLog}
            disabled={!schedule.active}
            title={
              schedule.active
                ? "Log this occurrence — start, complete or skip it. Creates the work order."
                : "A retired schedule has nothing outstanding to log."
            }
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Log completion
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${schedule.title}`}
            title="Edit this schedule"
            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
