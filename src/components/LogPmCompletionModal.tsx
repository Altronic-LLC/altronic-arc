import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Loader2, X } from "lucide-react";
import type { ScheduledMaintenance } from "@/types/task";
import {
  useCompleteMaintenanceTask,
  useCreateMaintenanceTask,
  useUpdateMaintenanceTaskFields,
} from "@/hooks/useMaintenanceTasks";
import {
  useRecordScheduleCompletion,
  useUpdateScheduleFields,
} from "@/hooks/useScheduledMaintenance";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import { logPmGate } from "@/lib/maintenanceRoles";
import { advanceSchedule, frequencyLabel } from "@/lib/maintenanceSchedule";
import { autoWatchers } from "@/lib/people";
import { fromDateInputValue, toDateInputValue, toSpDateOnly } from "@/lib/spDates";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { ChoicePills } from "./ChoicePills";
import { DescriptionView } from "./DescriptionView";
import { DateField } from "./DateField";
import { ScheduleBasisChip } from "./maintenanceAtoms";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Turning a PROJECTED occurrence into a real record.
//
// Until this modal is used, a due occurrence exists only in the browser: it is
// a date a schedule implies, with nothing behind it. Start / Complete / Skip
// are the three ways it becomes a work order on the Altronic Maintenance Tasks
// list — and the two that close it out also roll the schedule forward.
//
// Five decisions worth knowing about:
//
//  - **Skip REQUIRES a reason**, and the reason is written into the work
//    order's `Resolution`. A skipped PM that says nothing is indistinguishable
//    from one nobody got to, and the whole value of recording a skip is the
//    sentence explaining it.
//  - **A skip does NOT record a completion.** It advances `NextDueDate` and
//    leaves `LastCompleted` alone — writing a completion date for work that
//    was explicitly not done would corrupt a Floating schedule's own history
//    and lie in every report that reads it.
//  - **The work order is assigned to whoever logs the action**, with the
//    schedule's owner kept as a watcher. That is who is accounting for it.
//  - **Logging is limited to maintenance techs and admins** (`logPmGate`) —
//    it creates a work order against a schedule and, on Complete, writes the
//    schedule's own completion history. Raising an ordinary work order stays
//    open to everyone; this doesn't.
//  - **The work order's due date is the OCCURRENCE date, not today.** That is
//    what makes the calendar suppress the projection it came from (see
//    `loggedOccurrences` in lib/maintenanceCalendar.ts) instead of showing the
//    prediction beside the record of it.
// =============================================================================

type LogAction = "start" | "complete" | "skip";

const ACTIONS = [
  { value: "start", label: "Start" },
  { value: "complete", label: "Complete" },
  { value: "skip", label: "Skip" },
] as const;

interface LogPmCompletionModalProps {
  schedule: ScheduledMaintenance;
  /** The occurrence being logged — the day the calendar chip sat on. */
  occurrence: Date;
  /** Which action the modal opens on. Defaults to Complete. */
  defaultAction?: LogAction;
  onClose: () => void;
  /** Called with the new work order's id once it exists. */
  onCreated?: (taskId: number) => void;
}

function formatDay(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LogPmCompletionModal({
  schedule,
  occurrence,
  defaultAction = "complete",
  onClose,
  onCreated,
}: LogPmCompletionModalProps) {
  const actor = useCurrentUser();
  // Tech or admin. Every mutation below re-checks it; this is the visible
  // half, so nobody types a write-up in and is then refused.
  const logGate = logPmGate(useMyMaintenanceRoles());
  const createTask = useCreateMaintenanceTask();
  const completeTask = useCompleteMaintenanceTask();
  const updateTask = useUpdateMaintenanceTaskFields();
  const recordCompletion = useRecordScheduleCompletion();
  const updateSchedule = useUpdateScheduleFields();

  const busy =
    createTask.isPending ||
    completeTask.isPending ||
    updateTask.isPending ||
    recordCompletion.isPending ||
    updateSchedule.isPending;

  const [action, setAction] = useState<LogAction>(defaultAction);
  const [on, setOn] = useState(() => toDateInputValue(new Date()));
  const [notes, setNotes] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);
  const when = fromDateInputValue(on);

  const nextDue = useMemo(
    () => (when ? advanceSchedule(schedule, when) : null),
    [schedule, when],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Belt and braces with the disabled button — Enter in a field submits too.
    if (!logGate.allowed) return setError(logGate.hint);
    if (!when) return setError("Pick the date this happened.");
    // The one hard validation in this modal, and it's deliberate.
    if (action === "skip" && !notes.trim()) {
      return setError("Say why this is being skipped — the reason is kept on the work order.");
    }
    const hours = laborHours.trim() ? Number(laborHours) : null;
    if (laborHours.trim() && (!Number.isFinite(hours) || (hours as number) < 0)) {
      return setError("Labour hours has to be a number.");
    }
    setError(null);

    try {
      const task = await createTask.mutateAsync({
        title: schedule.title,
        // The schedule's instructions ARE the work order's checklist.
        description: schedule.instructions,
        status: action === "skip" ? "Backlog" : "Started",
        priority: schedule.priority,
        category: schedule.category,
        startDate: action === "skip" ? null : when,
        // Not today: the occurrence's own date, so the calendar can tell that
        // this projection has been logged.
        dueDate: occurrence,
        equipmentLookupId: schedule.equipment?.lookupId ?? null,
        scheduleLookupId: schedule.id,
        assigned: actor,
        watchers: autoWatchers(schedule.watchers, schedule.assignedTo),
        techNotes: action === "start" ? notes : "",
      });

      if (action === "complete") {
        await completeTask.mutateAsync({
          id: task.id,
          completedOn: when,
          resolution: notes.trim(),
          laborHours: hours,
        });
        // Records LastCompleted / LastCompletedBy and rolls NextDueDate on.
        await recordCompletion.mutateAsync({ id: schedule.id, completedOn: when });
      } else if (action === "skip") {
        await updateTask.mutateAsync({
          id: task.id,
          fields: { Status: "Canceled", Resolution: `Skipped — ${notes.trim()}` },
        });
        // Advance the DUE DATE only. No completion is recorded: the job was
        // deliberately not done, and `LastCompleted` means what it says.
        if (nextDue) {
          await updateSchedule.mutateAsync({
            id: schedule.id,
            fields: { NextDueDate: toSpDateOnly(nextDue) },
          });
        }
      }

      onClose();
      onCreated?.(task.id);
    } catch {
      // The hooks toast the reason; keep the modal open so nothing is lost.
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  const notesLabel =
    action === "skip"
      ? "Why is this being skipped?"
      : action === "complete"
        ? "What was done"
        : "Notes";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log maintenance"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <ClipboardCheck className="h-4 w-4 text-accent" />
            Log maintenance
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          id="log-pm-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <p className="font-medium text-fg">{schedule.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span>Due {formatDay(occurrence)}</span>
              {schedule.equipment?.title && <span>· {schedule.equipment.title}</span>}
              <span>· {frequencyLabel(schedule.frequencyInterval, schedule.frequencyUnit)}</span>
              <ScheduleBasisChip basis={schedule.scheduleBasis} />
            </p>
            <p className="mt-1 text-[11px] text-fg-muted">
              Nothing has been logged for this occurrence yet — saving creates the work order.
            </p>
          </div>

          {/* Stated on the page, not only in the disabled button's tooltip.
              Held back while the roles list is loading rather than shown as a
              refusal that is about to be withdrawn. */}
          {!logGate.allowed && !logGate.resolving && (
            <p className="mt-3 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-3 py-2 text-xs text-fg">
              {logGate.hint}
            </p>
          )}

          {/* The procedure, shown READ-ONLY.
              It was already being carried onto the work order this creates
              (see `description: schedule.instructions` above) — but it wasn't
              rendered here, so at the moment somebody is deciding Start /
              Complete / Skip, the steps they are deciding about were
              invisible. Reported on the first walkthrough.

              Deliberately NOT tickable here. A tick records who did it and
              when, and it belongs on the work order — the permanent record —
              not on a modal that might be cancelled. Starting the job takes
              you to the work order, where the same list IS tickable. */}
          {schedule.instructions.trim() && (
            <section
              aria-label="What this maintenance involves"
              className="mt-3 rounded-md border border-border px-3 py-2"
            >
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                What this involves
              </p>
              <div className="text-sm">
                {/* No `onToggle` — that is what makes the boxes read-only here. */}
                <DescriptionView text={schedule.instructions} />
              </div>
              <p className="mt-2 text-[11px] text-fg-muted">
                Carried onto the work order this creates, where the steps can be ticked off.
              </p>
            </section>
          )}

          <div className="mt-4 flex flex-col gap-4">
            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Action
              </span>
              <ChoicePills
                label="What happened"
                name="log-pm-action"
                options={ACTIONS.map((a) => ({ value: a.value, label: a.label }))}
                value={action}
                onChange={(v) => setAction(v as LogAction)}
                disabled={busy}
              />
            </div>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                {action === "start" ? "Date started" : action === "complete" ? "Date completed" : "Date skipped"}
              </span>
              <DateField
                value={on}
                onChange={setOn}
                disabled={busy}
                aria-label="Date"
              />
            </label>

            {action === "complete" && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  Labour hours
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  inputMode="decimal"
                  value={laborHours}
                  onChange={(e) => setLaborHours(e.target.value)}
                  placeholder="0"
                  className="input"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                {notesLabel}
                {action === "skip" && <span className="ml-1 text-cooper-red">*</span>}
              </span>
              <AutoGrowTextarea
                ref={notesRef}
                style={{ minHeight: "5rem" }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={
                  action === "skip"
                    ? "e.g. Machine down for a rebuild — inspection not possible this cycle."
                    : "What was found, what was done, anything the next person needs."
                }
                className="input resize-y"
              />
              {action === "skip" && (
                <p className="mt-1 text-[11px] text-fg-muted">
                  Kept on the work order as its Resolution, and the work order is closed as
                  Canceled. The schedule moves on to {formatDay(nextDue)}; no completion is
                  recorded against it.
                </p>
              )}
              {action === "complete" && (
                <p className="mt-1 text-[11px] text-fg-muted">
                  Recorded against the schedule too — next due {formatDay(nextDue)}.
                </p>
              )}
              {action === "start" && (
                <p className="mt-1 text-[11px] text-fg-muted">
                  Creates the work order and leaves it Started. The schedule stays where it is
                  until the job is completed.
                </p>
              )}
            </label>
          </div>

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="log-pm-form"
            disabled={busy || !logGate.allowed}
            title={logGate.allowed ? undefined : logGate.hint}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {action === "start"
              ? "Start work order"
              : action === "complete"
                ? "Log completion"
                : "Log skip"}
          </button>
        </div>
      </div>
    </div>
  );
}
