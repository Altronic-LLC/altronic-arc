import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Loader2, X } from "lucide-react";
import {
  FREQUENCY_UNITS,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  SCHEDULE_BASES,
  type MaintenanceCategory,
  type MaintenancePriority,
  type FrequencyUnit,
  type Person,
  type ScheduleBasis,
  type ScheduledMaintenance,
} from "@/types/task";
import {
  useCreateScheduledMaintenance,
  useScheduledMaintenance,
  useSetScheduleAssignedTo,
  useSetScheduleEquipment,
  useSetScheduleOperationsProject,
  useUpdateScheduleFields,
} from "@/hooks/useScheduledMaintenance";
import { useEquipment } from "@/hooks/useEquipment";
import { useOperationsProjects } from "@/hooks/useOperationsTasks";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import {
  useMaintenanceDepartments,
  useMaintenanceLocations,
} from "@/hooks/useMaintenanceReferenceLists";
import { referenceLabel, referenceOptions } from "@/lib/maintenanceReferences";
import { manageSchedulesGate } from "@/lib/maintenanceRoles";
import { collectScheduledMaintenancePeople } from "@/lib/scheduledMaintenanceMapper";
import { frequencyLabel, nextDueDates } from "@/lib/maintenanceSchedule";
import { assetPrefill, prefilledFromAsset } from "@/lib/maintenancePrefill";
import { mergePeople, personKey } from "@/lib/people";
import { fromDateInputValue, toDateInputValue, toSpDateOnly } from "@/lib/spDates";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { ChoicePills } from "./ChoicePills";
import { DateField } from "./DateField";
import { ChoiceSelect, SingleSelect } from "./SearchableSelect";
import { YesNoField } from "./YesNoField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New / Edit PM schedule.
//
// A schedule is a RULE, not a job: it says what has to happen, how often, and
// from when. Everything on this form feeds `lib/maintenanceSchedule.ts`, which
// is why the two fields people get wrong — the basis and the first due date —
// are given a live preview of the next three occurrences underneath. Fixed vs
// Floating is invisible until you see 1 Feb / 1 Mar / 1 Apr next to a date
// that moves.
//
// Two rules worth keeping:
//
//  - **Edits send only the columns that CHANGED.** Same house rule as Visit
//    Reports: a schedule's choice columns can drift outside their choice list,
//    and re-sending an unrelated stale value fails the whole PATCH.
//  - **Equipment, Assigned To and the Operations project go through their own
//    hooks**, never the generic field patch. They are two lookups and a
//    single-person column, and each needs the bare-integer write (or the
//    site's lookupId resolution) that those hooks already do.
//  - **Department and Location are the SCHEDULE's own columns**, pre-filled
//    from the asset when one is picked and editable afterwards. The pre-fill
//    never overwrites a value the user set — `prefilledFromAsset` in
//    lib/maintenancePrefill.ts, shared with the work-order modal.
// =============================================================================

interface ScheduledMaintenanceFormModalProps {
  /** Omit to create; pass one to edit it. */
  schedule?: ScheduledMaintenance;
  /** First due date to start from on a new schedule (the calendar's clicked day). */
  defaultDate?: Date | null;
  onClose: () => void;
  /** Called with the new schedule's id after a successful create. */
  onCreated?: (id: number) => void;
}

interface ScheduleDraft {
  title: string;
  instructions: string;
  category: string;
  priority: string;
  /** Equipment lookupId, as a string (the picker's value type). */
  equipment: string;
  /**
   * The schedule's OWN department / location — not an echo of the asset's.
   *
   * Reference-list lookupIds as strings (the picker's value type), NOT names:
   * both became single lookups on 2026-08-28, so a rename in Admin carries
   * every schedule pointing at the value with it.
   */
  department: string;
  location: string;
  /** Operations Projects lookupId, as a string. */
  operationsProject: string;
  frequencyInterval: string;
  frequencyUnit: string;
  scheduleBasis: string;
  /** `yyyy-mm-dd`, DateField's format. */
  firstDue: string;
  timeNeeded: string;
  graceDays: string;
  leadTimeDays: string;
  assignedTo: Person | null;
  active: boolean;
  requiresShutdown: boolean;
  lotoRequired: boolean;
}

/** A draft's `""`-or-numeric-string field as a lookupId. */
function numberOrNull(value: string): number | null {
  const n = Number(value);
  return value !== "" && Number.isFinite(n) ? n : null;
}

/** …and back, for the draft. */
function idAsDraftValue(lookupId: number | null): string {
  return lookupId === null ? "" : String(lookupId);
}

function emptyDraft(defaultDate?: Date | null): ScheduleDraft {
  return {
    title: "",
    instructions: "",
    category: "Preventive",
    priority: "Med",
    equipment: "",
    department: "",
    location: "",
    operationsProject: "",
    frequencyInterval: "",
    frequencyUnit: "",
    // Fixed is the sane default: most PMs are calendar jobs ("the first of the
    // month"), and Floating is the deliberate choice for a wear-clock job.
    scheduleBasis: "Fixed",
    firstDue: defaultDate ? toDateInputValue(defaultDate) : "",
    timeNeeded: "",
    graceDays: "",
    leadTimeDays: "",
    assignedTo: null,
    active: true,
    requiresShutdown: false,
    lotoRequired: false,
  };
}

function draftFrom(schedule: ScheduledMaintenance): ScheduleDraft {
  return {
    title: schedule.title,
    instructions: schedule.instructions,
    category: schedule.category ?? "",
    priority: schedule.priority ?? "",
    equipment: schedule.equipment ? String(schedule.equipment.lookupId) : "",
    department: schedule.department ? String(schedule.department.lookupId) : "",
    location: schedule.location ? String(schedule.location.lookupId) : "",
    operationsProject: schedule.operationsProject
      ? String(schedule.operationsProject.lookupId)
      : "",
    frequencyInterval: schedule.frequencyInterval != null ? String(schedule.frequencyInterval) : "",
    frequencyUnit: schedule.frequencyUnit ?? "",
    scheduleBasis: schedule.scheduleBasis ?? "Fixed",
    firstDue: toDateInputValue(schedule.firstDueDate),
    timeNeeded: schedule.timeNeeded != null ? String(schedule.timeNeeded) : "",
    graceDays: schedule.graceDays != null ? String(schedule.graceDays) : "",
    leadTimeDays: schedule.leadTimeDays != null ? String(schedule.leadTimeDays) : "",
    assignedTo: schedule.assignedTo,
    active: schedule.active,
    requiresShutdown: schedule.requiresShutdown,
    lotoRequired: schedule.lotoRequired,
  };
}

/** A whole non-negative number, or null when the box is empty. */
function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function ScheduledMaintenanceFormModal({
  schedule,
  defaultDate,
  onClose,
  onCreated,
}: ScheduledMaintenanceFormModalProps) {
  const mode = schedule ? "edit" : "create";
  const create = useCreateScheduledMaintenance();
  const update = useUpdateScheduleFields();
  const setEquipment = useSetScheduleEquipment();
  const setAssignedTo = useSetScheduleAssignedTo();
  const setOperationsProject = useSetScheduleOperationsProject();
  const { data: equipment = [] } = useEquipment();
  const { data: operationsProjects = [] } = useOperationsProjects();
  const { data: schedules = [] } = useScheduledMaintenance();
  const directory = useDirectoryPeople();
  /**
   * Creating or editing a schedule is maintenance-admin only.
   *
   * Every mutation this modal fires re-checks the same gate, so this is
   * the visible half rather than the enforcement: the submit button is
   * disabled with the reason in its `title` and stated in a notice, so
   * nobody fills a long form in and then gets refused.
   */
  const manageGate = manageSchedulesGate(useMyMaintenanceRoles());

  const busy =
    create.isPending ||
    update.isPending ||
    setEquipment.isPending ||
    setAssignedTo.isPending ||
    setOperationsProject.isPending;

  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    schedule ? draftFrom(schedule) : emptyDraft(defaultDate),
  );
  const [error, setError] = useState<string | null>(null);
  /**
   * Has the user set Department / Location themselves?
   *
   * A stored value on an existing schedule counts as theirs — somebody
   * committed to it — so changing its equipment must not rewrite it. On a new
   * schedule both start false, and the first asset pick fills them in.
   */
  const [deptTouched, setDeptTouched] = useState(!!schedule?.department);
  const [locTouched, setLocTouched] = useState(!!schedule?.location);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  const { data: departments = [] } = useMaintenanceDepartments();
  const { data: locations = [] } = useMaintenanceLocations();

  const equipmentOptions = useMemo(
    () =>
      equipment
        .map((asset) => ({
          value: String(asset.lookupId),
          label: asset.location ? `${asset.name} · ${referenceLabel(asset.location)}` : asset.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [equipment],
  );

  // The tenant directory plus anyone already owning a schedule — so a leaver
  // who still owns one stays pickable rather than silently dropping off.
  const people = useMemo(
    () => mergePeople(directory, collectScheduledMaintenancePeople(schedules), draft.assignedTo ? [draft.assignedTo] : []),
    [directory, schedules, draft.assignedTo],
  );

  function set<K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const projectOptions = useMemo(
    () => operationsProjects.map((p) => ({ value: String(p.lookupId), label: p.title })),
    [operationsProjects],
  );

  /**
   * Pick an asset, and pre-fill Department and Location from it.
   *
   * Only into fields the user hasn't set themselves, and only from an asset
   * that carries a value — `prefilledFromAsset` owns that rule, shared with
   * the work-order modal so the two can't drift.
   */
  function pickEquipment(next: string) {
    const asset = assetPrefill(equipment, next ? Number(next) : null);
    setDraft((prev) => ({
      ...prev,
      equipment: next,
      // `prefilledFromAsset` speaks lookupIds; the draft holds them as
      // strings, which is what every picker in this modal uses.
      department: idAsDraftValue(
        prefilledFromAsset(numberOrNull(prev.department), deptTouched, asset.department),
      ),
      location: idAsDraftValue(
        prefilledFromAsset(numberOrNull(prev.location), locTouched, asset.location),
      ),
    }));
  }

  /**
   * The next three occurrences this draft would produce.
   *
   * Rendered live under the frequency fields, straight from the projection
   * engine — never re-derived here, so the preview cannot disagree with the
   * calendar it is previewing.
   */
  const preview = useMemo(() => {
    const firstDue = fromDateInputValue(draft.firstDue);
    if (!firstDue || !draft.active) return [];
    const interval = wholeNumber(draft.frequencyInterval);
    return nextDueDates(
      {
        frequencyInterval: interval,
        frequencyUnit: (draft.frequencyUnit || null) as FrequencyUnit | null,
        scheduleBasis: (draft.scheduleBasis || null) as ScheduleBasis | null,
        firstDueDate: firstDue,
        nextDueDate: schedule?.nextDueDate ?? firstDue,
        lastCompleted: schedule?.lastCompleted ?? null,
        graceDays: wholeNumber(draft.graceDays),
        leadTimeDays: wholeNumber(draft.leadTimeDays),
        active: true,
      },
      firstDue,
      3,
    );
  }, [draft, schedule]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Belt and braces with the disabled button: a form can still be submitted
    // by Enter in a field, and the gate's wording is better than the toast the
    // refused mutation would raise.
    if (!manageGate.allowed) return setError(manageGate.hint);
    if (!draft.title.trim()) return setError("Give the schedule a name.");
    if (!draft.scheduleBasis) return setError("Pick Fixed or Floating.");
    const firstDue = fromDateInputValue(draft.firstDue);
    if (!firstDue) {
      return setError("Set the first due date — a schedule with no date is never due.");
    }
    const interval = wholeNumber(draft.frequencyInterval);
    if (draft.frequencyInterval.trim() && (interval === null || interval <= 0)) {
      return setError("The frequency interval has to be a whole number above zero.");
    }
    if (!!interval !== !!draft.frequencyUnit) {
      return setError("Set both the interval and its unit, or neither for a one-off.");
    }
    for (const [label, raw] of [
      ["Grace days", draft.graceDays],
      ["Lead time days", draft.leadTimeDays],
    ] as const) {
      const n = wholeNumber(raw);
      if (raw.trim() && (n === null || n < 0)) return setError(`${label} can't be negative.`);
    }
    setError(null);

    try {
      if (schedule) await saveEdit(schedule, firstDue);
      else await saveNew(firstDue);
    } catch {
      // The hooks toast the reason; keep the modal open so nothing is lost.
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  async function saveNew(firstDue: Date) {
    const created = await create.mutateAsync({
      title: draft.title.trim(),
      instructions: draft.instructions,
      category: (draft.category || null) as MaintenanceCategory | null,
      priority: (draft.priority || null) as MaintenancePriority | null,
      equipmentLookupId: draft.equipment ? Number(draft.equipment) : null,
      // All three optional — none of them blocks creating a schedule. Single
      // lookups, so a bare integer on the wire.
      departmentLookupId: numberOrNull(draft.department),
      locationLookupId: numberOrNull(draft.location),
      operationsProjectLookupId: draft.operationsProject ? Number(draft.operationsProject) : null,
      frequencyInterval: wholeNumber(draft.frequencyInterval),
      frequencyUnit: (draft.frequencyUnit || null) as FrequencyUnit | null,
      scheduleBasis: draft.scheduleBasis as ScheduleBasis,
      firstDueDate: firstDue,
      // A brand-new schedule is first due when it says it is.
      nextDueDate: firstDue,
      assignedTo: draft.assignedTo,
      timeNeeded: wholeNumber(draft.timeNeeded),
      graceDays: wholeNumber(draft.graceDays),
      leadTimeDays: wholeNumber(draft.leadTimeDays),
      active: draft.active,
      requiresShutdown: draft.requiresShutdown,
      lotoRequired: draft.lotoRequired,
    });
    onClose();
    onCreated?.(created.id);
  }

  async function saveEdit(current: ScheduledMaintenance, firstDue: Date) {
    const fields: Record<string, unknown> = {};
    const put = (key: string, next: unknown, prev: unknown) => {
      if (next !== prev) fields[key] = next;
    };

    put("Title", draft.title.trim(), current.title);
    put("Instructions", draft.instructions, current.instructions);
    put("Category", draft.category || null, current.category);
    put("Priority", draft.priority || null, current.priority);
    put("FrequencyInterval", wholeNumber(draft.frequencyInterval), current.frequencyInterval);
    put("FrequencyUnit", draft.frequencyUnit || null, current.frequencyUnit);
    put("ScheduleBasis", draft.scheduleBasis, current.scheduleBasis);
    put("TimeNeeded", wholeNumber(draft.timeNeeded), current.timeNeeded);
    put("GraceDays", wholeNumber(draft.graceDays), current.graceDays);
    put("LeadTimeDays", wholeNumber(draft.leadTimeDays), current.leadTimeDays);
    // The schedule's own department / location. Single lookups: a BARE
    // integer, and `null` clears.
    put("DepartmentRefLookupId", numberOrNull(draft.department), current.department?.lookupId ?? null);
    put("LocationRefLookupId", numberOrNull(draft.location), current.location?.lookupId ?? null);
    put("Active", draft.active, current.active);
    put("RequiresShutdown", draft.requiresShutdown, current.requiresShutdown);
    put("LOTORequired", draft.lotoRequired, current.lotoRequired);

    const firstDueChanged = toDateInputValue(current.firstDueDate) !== draft.firstDue;
    if (firstDueChanged) {
      fields.FirstDueDate = toSpDateOnly(firstDue);
      // Moving the first due date on a schedule nothing has been logged
      // against yet moves the outstanding occurrence with it — that is what
      // the user just asked for. Once there IS a completion, the next due date
      // belongs to `advanceSchedule`, and rewriting it here would undo a
      // completion somebody recorded.
      if (!current.lastCompleted) fields.NextDueDate = toSpDateOnly(firstDue);
    }

    if (Object.keys(fields).length > 0) {
      await update.mutateAsync({ id: current.id, fields });
    }

    const nextEquipment = draft.equipment ? Number(draft.equipment) : null;
    if (nextEquipment !== (current.equipment?.lookupId ?? null)) {
      await setEquipment.mutateAsync({ id: current.id, equipmentLookupId: nextEquipment });
    }

    const nextProject = draft.operationsProject ? Number(draft.operationsProject) : null;
    if (nextProject !== (current.operationsProject?.lookupId ?? null)) {
      await setOperationsProject.mutateAsync({
        id: current.id,
        operationsProjectLookupId: nextProject,
      });
    }

    const prevOwner = current.assignedTo ? personKey(current.assignedTo) : "";
    const nextOwner = draft.assignedTo ? personKey(draft.assignedTo) : "";
    if (prevOwner !== nextOwner) {
      await setAssignedTo.mutateAsync({ id: current.id, person: draft.assignedTo });
    }

    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "New maintenance schedule" : "Edit maintenance schedule"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <CalendarClock className="h-4 w-4 text-accent" />
            {mode === "create" ? "New Maintenance Schedule" : "Edit Maintenance Schedule"}
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
          id="schedule-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          {/* Said out loud, not only in a tooltip on a disabled button — which
              a touch user can never read. Suppressed while the roles list is
              still loading: a denial taken back a moment later is worse than
              a beat of silence. */}
          {!manageGate.allowed && !manageGate.resolving && (
            <p className="mb-4 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-3 py-2 text-xs text-fg">
              {manageGate.hint}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2">
              <input
                ref={firstFieldRef}
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="What has to happen, e.g. “Weekly compressor walkaround”"
                className="input"
              />
            </Field>

            <Field label="Equipment">
              <ChoiceSelect
                value={draft.equipment}
                onChange={pickEquipment}
                options={equipmentOptions}
                emptyLabel="No asset"
                searchPlaceholder="Search the equipment register…"
                disabled={busy}
              />
              <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-fg-muted">
                Optional — picking one fills in Department and Location below, and you can change
                them afterwards.
              </p>
            </Field>

            <Field label="Owner">
              <SingleSelect
                allLabel="Not set"
                ariaLabel="Owner"
                searchPlaceholder="Search people…"
                disabled={busy}
                options={people.map((p) => ({
                  value: personKey(p),
                  label: p.displayName || p.email || "Unknown",
                }))}
                selected={draft.assignedTo ? personKey(draft.assignedTo) : null}
                onChange={(key) =>
                  set("assignedTo", key ? people.find((p) => personKey(p) === key) ?? null : null)
                }
              />
            </Field>

            <Field label="Department">
              <SingleSelect
                allLabel="Not set"
                searchPlaceholder="Search departments…"
                // Active values, plus whatever this schedule already points
                // at even if that has since been retired — a picker that
                // dropped it would clear the field on the next save.
                options={referenceOptions(departments, schedule?.department ?? null)}
                selected={draft.department || null}
                onChange={(v) => {
                  setDeptTouched(true);
                  set("department", v ?? "");
                }}
                disabled={busy}
              />
            </Field>

            <Field label="Location">
              <SingleSelect
                allLabel="Not set"
                searchPlaceholder="Search locations…"
                options={referenceOptions(locations, schedule?.location ?? null)}
                selected={draft.location || null}
                onChange={(v) => {
                  setLocTouched(true);
                  set("location", v ?? "");
                }}
                disabled={busy}
              />
            </Field>

            <Field label="Operations Project" className="sm:col-span-2">
              <ChoiceSelect
                value={draft.operationsProject}
                onChange={(v) => set("operationsProject", v)}
                options={projectOptions}
                emptyLabel="No project"
                searchPlaceholder="Search Operations projects…"
                disabled={busy}
              />
            </Field>

            <Field label="Category">
              <ChoiceSelect
                value={draft.category}
                onChange={(v) => set("category", v)}
                options={MAINTENANCE_CATEGORIES}
                emptyLabel="No category"
                disabled={busy}
              />
            </Field>

            <Field label="Priority">
              <ChoiceSelect
                value={draft.priority}
                onChange={(v) => set("priority", v)}
                options={MAINTENANCE_PRIORITIES}
                emptyLabel="No priority"
                disabled={busy}
              />
            </Field>

            <Field label="Every">
              <div className="flex items-center gap-2">
                {/* The width lives on a WRAPPER, not on the input. `.input` in
                    globals.css sets `width: 100%` as a plain rule, which has
                    the same specificity as a Tailwind `w-20` utility and wins
                    on source order — so sizing the input directly did nothing
                    and the number field ate the row, collapsing the unit
                    dropdown beside it to a sliver. */}
                <div className="w-20 shrink-0">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    aria-label="Frequency interval"
                    value={draft.frequencyInterval}
                    onChange={(e) => set("frequencyInterval", e.target.value)}
                    placeholder="1"
                    className="input"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <ChoiceSelect
                    value={draft.frequencyUnit}
                    onChange={(v) => set("frequencyUnit", v)}
                    options={FREQUENCY_UNITS}
                    emptyLabel="One-off"
                    ariaLabel="Frequency unit"
                    disabled={busy}
                  />
                </div>
              </div>
            </Field>

            <Field label="First due" required>
              <DateField
                value={draft.firstDue}
                onChange={(v) => set("firstDue", v)}
                disabled={busy}
                aria-label="First due"
              />
            </Field>

            {/* Two options — pills, never a dropdown. The hint is the whole
                point: Fixed vs Floating is the thing people get wrong. */}
            <Field label="Basis" plain className="sm:col-span-2">
              <ChoicePills
                label="Schedule basis"
                name="schedule-basis"
                options={SCHEDULE_BASES}
                value={draft.scheduleBasis}
                onChange={(v) => set("scheduleBasis", v)}
                disabled={busy}
              />
              <p className="mt-1 text-[11px] text-fg-muted">
                {draft.scheduleBasis === "Floating"
                  ? "Floating — the clock restarts when the job is actually done, so it's next due this long after the last completion."
                  : "Fixed — the next date comes off the DUE date, so a monthly job stays on the same day of the month however late it was done."}
              </p>
            </Field>

            <Field label="Grace days">
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={draft.graceDays}
                onChange={(e) => set("graceDays", e.target.value)}
                placeholder="0"
                className="input"
              />
              <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-fg-muted">
                Days past due before it counts as late.
              </p>
            </Field>

            <Field label="Lead time days">
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={draft.leadTimeDays}
                onChange={(e) => set("leadTimeDays", e.target.value)}
                placeholder="0"
                className="input"
              />
              <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-fg-muted">
                Days ahead of the due date it starts showing up — time to order a part.
              </p>
            </Field>

            <Field label="Time needed (hours)">
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={draft.timeNeeded}
                onChange={(e) => set("timeNeeded", e.target.value)}
                placeholder="0"
                className="input"
              />
            </Field>

            <Field label="Active" plain>
              <YesNoField
                label="Active"
                name="schedule-active"
                value={draft.active ? "Yes" : ""}
                onChange={(v) => set("active", v === "Yes")}
                disabled={busy}
              />
              <p className="mt-1 text-[11px] text-fg-muted">
                A retired schedule projects nothing — it drops off every calendar and work list,
                and keeps the work orders it already produced.
              </p>
            </Field>

            <Field label="Requires shutdown" plain>
              <YesNoField
                label="Requires shutdown"
                name="schedule-shutdown"
                value={draft.requiresShutdown ? "Yes" : ""}
                onChange={(v) => set("requiresShutdown", v === "Yes")}
                disabled={busy}
              />
            </Field>

            <Field label="LOTO required" plain>
              <YesNoField
                label="LOTO required"
                name="schedule-loto"
                value={draft.lotoRequired ? "Yes" : ""}
                onChange={(v) => set("lotoRequired", v === "Yes")}
                disabled={busy}
              />
            </Field>

            <Field label="Instructions" className="sm:col-span-2">
              <AutoGrowTextarea
                style={{ minHeight: "8rem" }}
                value={draft.instructions}
                onChange={(e) => set("instructions", e.target.value)}
                rows={5}
                placeholder={"- [ ] Isolate and lock out\n- [ ] Drain the sump\n- [ ] Refill and log the level"}
                className="input resize-y font-mono text-[13px]"
              />
              <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-fg-muted">
                This is a <strong>checklist</strong>. Start a line with <code>- [ ]</code> and it
                becomes a tickable step on every work order this schedule produces; indent a line
                to make it a sub-step. Plain lines are shown as ordinary text.
              </p>
            </Field>
          </div>

          {preview.length > 0 && (
            <div className="mt-4 rounded-md border border-border bg-surface-2 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Next occurrences
              </p>
              <p className="mt-1 text-sm text-fg">
                {preview
                  .map((d) =>
                    d.toLocaleDateString(undefined, {
                      timeZone: "UTC",
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }),
                  )
                  .join("  ·  ")}
              </p>
              <p className="mt-1 text-[11px] text-fg-muted">
                {frequencyLabel(wholeNumber(draft.frequencyInterval), (draft.frequencyUnit || null) as FrequencyUnit | null)}
                {draft.frequencyUnit
                  ? ""
                  : " — this one is due once and will not repeat."}
              </p>
            </div>
          )}

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
            form="schedule-form"
            disabled={busy || !manageGate.allowed}
            title={manageGate.allowed ? undefined : manageGate.hint}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "create" ? "Create schedule" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  plain,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  /**
   * Render as a <div> rather than a <label>.
   *
   * A pill group carries its own labels, and nesting those inside a <label>
   * makes the outer one steal the click — the rule ChoicePills documents.
   */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Tag = plain ? "div" : "label";
  return (
    <Tag className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </Tag>
  );
}
