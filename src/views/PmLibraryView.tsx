import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, ClipboardCheck, ListChecks, Pencil, Plus } from "lucide-react";
import type { ScheduledMaintenance } from "@/types/task";
import {
  useScheduledMaintenance,
  useSetScheduleActive,
} from "@/hooks/useScheduledMaintenance";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import {
  type MaintenanceGate,
  logPmGate,
  manageSchedulesGate,
} from "@/lib/maintenanceRoles";
import {
  type MeterAsset,
  anchorDueDate,
  daysUntilDue,
  frequencyLabel,
  isMeterSchedule,
  meterAssetIndex,
  meterReadingFor,
  meterStatus,
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
import { MaintenanceViewSwitcher } from "@/components/MaintenanceViewSwitcher";
import {
  DueInLabel,
  MaintenancePriorityFlag,
  MeterReadingAsOf,
  MeterStatusLine,
  ScheduleBasisChip,
} from "@/components/maintenanceAtoms";
import { useEquipment } from "@/hooks/useEquipment";
import { cn } from "@/lib/cn";

// =============================================================================
// The PM library — every maintenance schedule, and what each one is doing.
//
// The calendar answers "what is due"; this answers "what rules produce it".
// It is where a schedule is created, corrected, retired and — when somebody
// does a job off the back of a paper round rather than the calendar — logged.
//
// Four things worth knowing:
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
//  - **This is a run-hours schedule's PRIMARY home.** An Hourmeter PM has no
//    date, so it appears on the calendar only on the day it actually comes due
//    (see lib/maintenanceCalendar.ts) — this is the screen somebody checks to
//    see one coming. Its Next due cell reads "Due at 5,200 hrs · now 5,043 hrs
//    · 157 to go" instead of a date, plus the asset's last-edit date, and it
//    says out loud when the state CAN'T BE TOLD: no hourmeter reading, or no
//    asset linked at all. Those are faults, not blanks — a meter PM with no
//    reading behind it can never come due, and this row is the only place that
//    would ever say so.
//  - **Creating, editing and retiring a schedule is maintenance-ADMIN only;
//    logging one is tech-or-admin.** Reading the library is open to everyone —
//    knowing what is due is not a privilege. Every gated control is disabled
//    with the reason in its `title`, and the mutation behind it re-checks the
//    same gate (lib/maintenanceRoles.ts), so nothing here can offer an action
//    the write will reject.
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
  // The equipment register, for the run-hours schedules' readings. Cached for
  // five minutes and already loaded by every other CMMS screen, so this costs
  // nothing — and without it a meter schedule can only ever report "no asset
  // linked", which would be a lie about the data rather than about the load.
  // Named `assetRows`, not `equipment`: the filter param a few lines below is
  // already called `equipment` and holds a lookupId string.
  const { data: assetRows = [], isLoading: equipmentLoading } = useEquipment();
  const setActive = useSetScheduleActive();
  const access = useMyMaintenanceRoles();
  const manageGate = manageSchedulesGate(access);
  const logGate = logPmGate(access);

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
  const assets = useMemo(() => meterAssetIndex(assetRows as MeterAsset[]), [assetRows]);

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
            disabled={!manageGate.allowed}
            title={manageGate.allowed ? undefined : manageGate.hint}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            New schedule
          </button>
        </div>
      </header>

      <MaintenanceViewSwitcher />

      {/* Said in words. A row of greyed buttons with no explanation reads as a
          bug, and a touch user can't reach a `title`. Suppressed while the
          roles list is still loading — see MaintenanceGate.resolving. */}
      {!manageGate.allowed && !manageGate.resolving && (
        <p className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-3 py-2 text-xs text-fg">
          {manageGate.hint}
        </p>
      )}

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

      {isLoading || equipmentLoading ? (
        /* Held until the equipment register has landed as well. A meter row
           rendered against an empty register reports "No asset linked — this
           schedule can never come due", which is a real fault when it's true
           and an alarming lie for the second it isn't. */
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
                    assets={assets}
                    onEdit={() => setEditing(schedule)}
                    onLog={() => setLogging(schedule)}
                    onToggleActive={() =>
                      setActive.mutate({ id: schedule.id, active: !schedule.active })
                    }
                    manageGate={manageGate}
                    logGate={logGate}
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
  assets,
  onEdit,
  onLog,
  onToggleActive,
  manageGate,
  logGate,
}: {
  schedule: ScheduledMaintenance;
  now: Date;
  /** The equipment register by lookupId — for a run-hours schedule's reading. */
  assets: Map<number, MeterAsset>;
  onEdit: () => void;
  onLog: () => void;
  onToggleActive: () => void;
  /** May they create / edit / retire a schedule? (Maintenance admin.) */
  manageGate: MaintenanceGate;
  /** May they log an occurrence? (Tech or admin.) */
  logGate: MaintenanceGate;
}) {
  // The OUTSTANDING occurrence, not the stored column: a Floating schedule
  // derives it from its last completion. Null for a run-hours schedule — it
  // has no date, and the meter status below is what that row shows instead.
  const due = anchorDueDate(schedule);
  const days = schedule.active ? daysUntilDue(schedule, now) : null;
  const meter = isMeterSchedule(schedule);
  // `meterStatus` reports `applies: false` for a RETIRED meter schedule rather
  // than returning null, so the cell below checks `.applies` — otherwise a
  // retired row renders the (empty) status atoms and looks blank.
  const meterState = meter
    ? meterStatus(schedule, meterReadingFor(schedule.equipment, assets), now)
    : null;

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
      <td className="px-3 py-2 text-fg-muted">
        {schedule.equipment?.title || (
          /* A missing asset is a plain dash on a calendar schedule and a FAULT
             on a meter one — that schedule has no hourmeter to count against,
             so it can never come due. Said here as well as in the Next due
             cell, because this is the cell somebody scans for the cause. */
          <span className={meter ? "font-medium text-cooper-red" : undefined}>
            {meter ? "No asset — can't be evaluated" : "—"}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="text-fg">
          {frequencyLabel(schedule.frequencyInterval, schedule.frequencyUnit)}
        </div>
        <div className="mt-1">
          <ScheduleBasisChip basis={schedule.scheduleBasis} />
        </div>
      </td>
      <td className="px-3 py-2">
        {meterState?.applies ? (
          /* A reading, a gap and a verdict — never a date, and never a blank.
             `MeterStatusLine` renders "can't tell" as its own red state. */
          <div className="flex flex-col gap-0.5">
            <MeterStatusLine status={meterState} />
            <MeterReadingAsOf status={meterState} />
            {meterState.anchoredOnCurrentReading && (
              <span
                title="Nothing has been completed against this schedule and no due reading is stored, so the target is assumed from the asset's reading now plus the interval. Log a completion — or set a due reading — to fix it in place."
                className="text-[11px] italic text-fg-muted"
              >
                Target assumed from today's reading
              </span>
            )}
          </div>
        ) : meter ? (
          /* A meter schedule on a RETIRED row: `meterStatus` reports
             `applies: false` and the atoms render nothing, so say why the cell
             is empty rather than leaving it blank. */
          <span className="text-xs text-fg-muted">Retired — not counting hours.</span>
        ) : (
          <>
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
          </>
        )}
      </td>
      <td className="px-3 py-2 text-fg-muted">{schedule.assignedTo?.displayName || "Not set"}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          role="switch"
          aria-checked={schedule.active}
          onClick={onToggleActive}
          disabled={!manageGate.allowed}
          title={
            !manageGate.allowed
              ? manageGate.hint
              : schedule.active
                ? "Retire this schedule — it stops projecting occurrences and keeps its work orders."
                : "Reinstate this schedule so it starts projecting again."
          }
          className={cn(
            "inline-flex h-5 w-9 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
            disabled={!schedule.active || !logGate.allowed}
            title={
              !schedule.active
                ? "A retired schedule has nothing outstanding to log."
                : !logGate.allowed
                  ? logGate.hint
                  : "Log this occurrence — start, complete or skip it. Creates the work order."
            }
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Log completion
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={!manageGate.allowed}
            aria-label={`Edit ${schedule.title}`}
            title={manageGate.allowed ? "Edit this schedule" : manageGate.hint}
            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
