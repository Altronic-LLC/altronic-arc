import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import {
  useCreateMaintenanceTask,
  useMaintenanceTasks,
  useSetMaintenanceTaskAssigned,
  useSetMaintenanceTaskEquipment,
  useSetMaintenanceTaskOperationsProject,
  useSetMaintenanceTaskWatchers,
  useUpdateMaintenanceTaskFields,
} from "@/hooks/useMaintenanceTasks";
import { useEquipment } from "@/hooks/useEquipment";
import { useOperationsProjects } from "@/hooks/useOperationsTasks";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import {
  useMaintenanceDepartments,
  useMaintenanceLocations,
} from "@/hooks/useMaintenanceReferenceLists";
import { referenceOptions } from "@/lib/maintenanceReferences";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
  type MaintenanceTask,
  type Person,
} from "@/types/task";
import { maintenanceCompletionAccess } from "@/lib/maintenanceRoles";
import { collectMaintenancePeople } from "@/lib/maintenanceFilters";
import { assetPrefill, prefilledFromAsset } from "@/lib/maintenancePrefill";
import { mergePeople } from "@/lib/people";
import { fromDateInputValue, toDateInputValue, toSpDateOnly } from "@/lib/spDates";
import { ChoiceSelect, MultiSelect, SingleSelect } from "./SearchableSelect";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Raise / edit a work order.
//
// Three columns are deliberately ABSENT from this form, and each absence is a
// rule rather than an oversight:
//
//   - **WONumber** is read-only. ARC generates `WO-YYYY-####` on create
//     (nextWorkOrderNumber); a typed one would collide the first time two
//     people raised a job in the same minute. Edit mode SHOWS it, greyed.
//   - **TaskType** is derived, never picked — "Regular Maintenance" when the
//     work order came off a PM schedule, "Request" when it didn't. Offering it
//     would let somebody produce a combination the real list can't.
//   - **DueStatus** belongs to a Power Automate flow. ARC reads it and shows
//     it; there is no picker for it anywhere in the app.
//
// Everything else follows OperationsTaskFormModal exactly, including the
// parallel-writes-on-edit shape and the searchable dropdowns (never a native
// <select>). No field here has three or fewer choices, so nothing is
// ChoicePills — Status has seven, Category eight, Priority four, Department
// nine and Location sixty-four.
//
// **Department and Location are the work order's OWN columns.** Picking an
// asset pre-fills them; they stay editable, and a work order raised against
// something the register has never heard of (a light, a door, a leaking pipe)
// can carry them on its own. The pre-fill NEVER overwrites a value the user
// set — see `prefilledFromAsset` in lib/maintenancePrefill.ts and the
// `deptTouched` / `locTouched` flags below.
//
// **Both became single LOOKUPS on 2026-08-28**, into the two Maintenance
// reference lists admins maintain at /admin/maintenance-reference-lists. So the
// state here is a lookupId, the write is a bare integer, and the options come
// from `referenceOptions` — every ACTIVE value, plus whatever this work order
// already points at even when that has since been retired. A picker that
// dropped the current value would clear it on the next save.
// =============================================================================

interface MaintenanceTaskFormModalProps {
  mode: "create" | "edit";
  task?: MaintenanceTask | null;
  onClose: () => void;
}

export function MaintenanceTaskFormModal({ mode, task, onClose }: MaintenanceTaskFormModalProps) {
  const navigate = useNavigate();
  const { data: allTasks = [] } = useMaintenanceTasks();
  const { data: equipment = [] } = useEquipment();
  const createTask = useCreateMaintenanceTask();
  const updateFields = useUpdateMaintenanceTaskFields();
  const setEquipment = useSetMaintenanceTaskEquipment();
  const setAssigned = useSetMaintenanceTaskAssigned();
  const setWatchers = useSetMaintenanceTaskWatchers();
  const setOperationsProject = useSetMaintenanceTaskOperationsProject();
  const { data: operationsProjects = [] } = useOperationsProjects();
  const directory = useDirectoryPeople();
  const maintenanceAccess = useMyMaintenanceRoles();
  const { data: departments = [] } = useMaintenanceDepartments();
  const { data: locations = [] } = useMaintenanceLocations();

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<MaintenanceStatus>(task?.status ?? "Backlog");
  const [priority, setPriority] = useState<MaintenancePriority | "">(task?.priority ?? "");
  const [category, setCategory] = useState<MaintenanceCategory | "">(task?.category ?? "");
  const [startDate, setStartDate] = useState(toDateInputValue(task?.startDate ?? null));
  const [dueDate, setDueDate] = useState(toDateInputValue(task?.dueDate ?? null));
  const [equipmentId, setEquipmentId] = useState<number | "">(task?.equipment?.lookupId ?? "");
  const [department, setDepartment] = useState<number | null>(task?.department?.lookupId ?? null);
  const [location, setLocation] = useState<number | null>(task?.location?.lookupId ?? null);
  const [operationsProjectId, setOperationsProjectId] = useState<number | "">(
    task?.operationsProject?.lookupId ?? "",
  );
  /**
   * Has the user set this field THEMSELVES?
   *
   * A stored value on an existing work order counts as theirs: somebody
   * committed to it, whether by typing it or by accepting a pre-fill and
   * saving. Changing the equipment on that work order must not rewrite it.
   * On a create both start false, so the first asset pick fills them in.
   */
  const [deptTouched, setDeptTouched] = useState(!!task?.department);
  const [locTouched, setLocTouched] = useState(!!task?.location);
  const [assigned, setAssignedState] = useState<Person | null>(task?.assigned ?? null);
  const [watchers, setWatchersState] = useState<Person[]>(task?.watchers ?? []);
  const [techNotes, setTechNotes] = useState(task?.techNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  // Everyone already on a work order, folded into the whole staff directory so
  // any Altronic person is assignable — lookupId-less directory entries are
  // resolved on write.
  const allPeople: Person[] = mergePeople(collectMaintenancePeople(allTasks), directory);

  /**
   * The completion guard, made visible.
   *
   * `useUpdateMaintenanceTaskFields` refuses a Complete write from anyone
   * without the maintenance `tech` or `admin` role, so offering the option
   * here would be offering an action the mutation rejects. It is dropped from
   * the picker instead, with the reason stated underneath — a silently shorter
   * list is its own kind of confusing.
   */
  const completion = task ? maintenanceCompletionAccess(task, maintenanceAccess) : null;
  const blockedFromCompleting = mode === "edit" && completion !== null && !completion.allowed;
  const statusOptions = blockedFromCompleting
    ? MAINTENANCE_STATUSES.filter((s) => s !== "Complete")
    : MAINTENANCE_STATUSES;

  /**
   * Pick an asset, and pre-fill Department and Location from it.
   *
   * Only into fields the user hasn't set themselves, and only from an asset
   * that actually carries a value — the rule lives in `prefilledFromAsset`
   * (lib/maintenancePrefill.ts) so this modal and the schedule one can't
   * drift apart on it.
   */
  function pickEquipment(nextId: number | "") {
    setEquipmentId(nextId);
    const asset = assetPrefill(equipment, nextId === "" ? null : nextId);
    setDepartment((current) => prefilledFromAsset(current, deptTouched, asset.department));
    setLocation((current) => prefilledFromAsset(current, locTouched, asset.location));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      if (mode === "create") {
        const created = await createTask.mutateAsync({
          title: trimmedTitle,
          description: description.trim() || undefined,
          status,
          priority: priority || null,
          category: category || null,
          startDate: fromDateInputValue(startDate),
          dueDate: fromDateInputValue(dueDate),
          equipmentLookupId: equipmentId === "" ? null : equipmentId,
          departmentLookupId: department,
          locationLookupId: location,
          operationsProjectLookupId: operationsProjectId === "" ? null : operationsProjectId,
          assigned,
          watchers,
          techNotes: techNotes.trim() || undefined,
        });
        onClose();
        navigate(`/operations/maintenance-task/${created.id}`);
        return;
      }

      if (!task) throw new Error("Edit mode requires a work order");

      const baseFields: Record<string, unknown> = {};
      if (trimmedTitle !== task.title) baseFields.Title = trimmedTitle;
      if (description !== task.description) baseFields.Description = description;
      if (status !== task.status) baseFields.Status = status;
      if ((priority || null) !== task.priority) baseFields.Priority = priority || null;
      if ((category || null) !== task.category) baseFields.Category = category || null;
      if (techNotes !== task.techNotes) baseFields.TechNotes = techNotes;
      // The work order's own department / location. Single lookups: a BARE
      // integer, and `null` clears. Both are optional and neither blocks
      // saving.
      if (department !== (task.department?.lookupId ?? null)) {
        baseFields.DepartmentRefLookupId = department;
      }
      if (location !== (task.location?.lookupId ?? null)) {
        baseFields.LocationRefLookupId = location;
      }
      if (startDate !== toDateInputValue(task.startDate)) {
        baseFields.StartDate = toSpDateOnly(fromDateInputValue(startDate));
      }
      if (dueDate !== toDateInputValue(task.dueDate)) {
        baseFields.DueDate = toSpDateOnly(fromDateInputValue(dueDate));
      }

      if (Object.keys(baseFields).length > 0) {
        await updateFields.mutateAsync({ id: task.id, fields: baseFields });
      }

      const nextEquipmentId = equipmentId === "" ? null : equipmentId;
      if (nextEquipmentId !== (task.equipment?.lookupId ?? null)) {
        await setEquipment.mutateAsync({ id: task.id, equipmentLookupId: nextEquipmentId });
      }

      // A single lookup, through its own hook — the same treatment the
      // equipment reference gets, since both write a bare integer.
      const nextProjectId = operationsProjectId === "" ? null : operationsProjectId;
      if (nextProjectId !== (task.operationsProject?.lookupId ?? null)) {
        await setOperationsProject.mutateAsync({
          id: task.id,
          operationsProjectLookupId: nextProjectId,
        });
      }

      const assignedKey = (p: Person | null) => (p ? p.email ?? p.displayName : null);
      if (assignedKey(assigned) !== assignedKey(task.assigned)) {
        await setAssigned.mutateAsync({ id: task.id, person: assigned });
      }

      const currentWatcherKeys = new Set(
        task.watchers.map((p) => (p.email ?? p.displayName).toLowerCase()),
      );
      const nextWatcherKeys = new Set(watchers.map((p) => (p.email ?? p.displayName).toLowerCase()));
      const watchersSame =
        currentWatcherKeys.size === nextWatcherKeys.size &&
        [...currentWatcherKeys].every((k) => nextWatcherKeys.has(k));
      if (!watchersSame) {
        await setWatchers.mutateAsync({ id: task.id, people: watchers });
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the work order.");
    } finally {
      setBusy(false);
    }
  }

  // Dismiss on a genuine backdrop click only — never when a text-selection
  // drag merely happens to end out here (see useOverlayDismiss).
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="maintenance-task-form-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      {...overlayDismiss}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-2xl flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2
            id="maintenance-task-form-heading"
            className="font-display text-base font-semibold text-fg sm:text-lg"
          >
            {mode === "create" ? "New work order" : `Edit ${task?.woNumber ?? "work order"}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="scroll-elegant flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {error && (
            <div className="mb-3 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="grid gap-4">
            {mode === "edit" && (
              <Field label="WO Number">
                <div
                  title="Generated by ARC when the work order is raised — it isn't editable."
                  className="rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-fg-muted"
                >
                  {task?.woNumber || "—"}
                </div>
              </Field>
            )}

            <Field label="Title" required>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What is wrong, or what needs doing"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                required
                maxLength={255}
              />
            </Field>

            <Field label="Description">
              <AutoGrowTextarea
                style={{ minHeight: "6.5rem" }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Symptoms, when it started, anything already tried"
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <ChoiceSelect
                  value={status}
                  onChange={(v) => setStatus(v as MaintenanceStatus)}
                  options={statusOptions}
                  emptyLabel="Select a status…"
                  searchPlaceholder="Search statuses…"
                  clearable={false}
                />
                {blockedFromCompleting && completion && (
                  <p className="mt-1 text-[11px] leading-snug text-fg-muted">{completion.hint}</p>
                )}
              </Field>

              <Field label="Priority">
                <ChoiceSelect
                  value={priority}
                  onChange={(v) => setPriority(v as MaintenancePriority | "")}
                  options={MAINTENANCE_PRIORITIES}
                  emptyLabel="Not set"
                  searchPlaceholder="Search priorities…"
                />
              </Field>
            </div>

            <Field label="Category">
              <ChoiceSelect
                value={category}
                onChange={(v) => setCategory(v as MaintenanceCategory | "")}
                options={MAINTENANCE_CATEGORIES}
                emptyLabel="Not set"
                searchPlaceholder="Search categories…"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start Date">
                <DateField
                  value={startDate}
                  onChange={setStartDate}
                  aria-label="Start Date"
                  className="bg-surface px-3 py-2 text-base sm:text-sm"
                />
              </Field>

              <Field label="Due Date">
                <DateField
                  value={dueDate}
                  onChange={setDueDate}
                  aria-label="Due Date"
                  className="bg-surface px-3 py-2 text-base sm:text-sm"
                />
              </Field>
            </div>

            <Field label="Equipment">
              <SingleSelect
                allLabel="No asset"
                searchPlaceholder="Search equipment…"
                options={equipment.map((e) => ({
                  value: String(e.lookupId),
                  label: e.name || `Asset #${e.lookupId}`,
                }))}
                selected={equipmentId === "" ? null : String(equipmentId)}
                onChange={(v) => pickEquipment(v === null ? "" : parseInt(v, 10))}
              />
              <p className="mt-1 text-[11px] leading-snug text-fg-muted">
                Optional. Plenty of jobs — a light, a door, a leaking pipe — aren't against a
                listed asset; fill in Department and Location below instead.
              </p>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department">
                <SingleSelect
                  allLabel="Not set"
                  searchPlaceholder="Search departments…"
                  // Active values, plus whatever this work order already
                  // points at — see the note at the top of this file.
                  options={referenceOptions(departments, task?.department ?? null)}
                  selected={department === null ? null : String(department)}
                  onChange={(v) => {
                    setDeptTouched(true);
                    setDepartment(v === null ? null : parseInt(v, 10));
                  }}
                />
              </Field>

              <Field label="Location">
                <SingleSelect
                  allLabel="Not set"
                  searchPlaceholder="Search locations…"
                  options={referenceOptions(locations, task?.location ?? null)}
                  selected={location === null ? null : String(location)}
                  onChange={(v) => {
                    setLocTouched(true);
                    setLocation(v === null ? null : parseInt(v, 10));
                  }}
                />
              </Field>
            </div>

            <Field label="Operations Project">
              <SingleSelect
                allLabel="No project"
                searchPlaceholder="Search Operations projects…"
                options={operationsProjects.map((p) => ({
                  value: String(p.lookupId),
                  label: p.title,
                }))}
                selected={operationsProjectId === "" ? null : String(operationsProjectId)}
                onChange={(v) => setOperationsProjectId(v === null ? "" : parseInt(v, 10))}
              />
            </Field>

            <Field label="Assigned">
              <SingleSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={assigned ? assigned.email ?? assigned.displayName : null}
                onChange={(key) => {
                  const person = key
                    ? allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null
                    : null;
                  setAssignedState(person);
                }}
              />
            </Field>

            <Field label="Watchers">
              <PersonMultiSelect
                allPeople={allPeople}
                selected={watchers}
                onChange={setWatchersState}
              />
            </Field>

            <Field label="Tech Notes">
              <AutoGrowTextarea
                value={techNotes}
                onChange={(e) => setTechNotes(e.target.value)}
                rows={3}
                placeholder="Running notes while the job is open"
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              />
            </Field>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 sm:rounded-b-lg sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-bg px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === "create" ? (
              <Plus className="h-4 w-4" />
            ) : null}
            {busy ? "Saving…" : mode === "create" ? "Raise work order" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </label>
  );
}

/** Adapter from MultiSelect (string-key based) to Person[] state. */
function PersonMultiSelect({
  allPeople,
  selected,
  onChange,
}: {
  allPeople: Person[];
  selected: Person[];
  onChange: (next: Person[]) => void;
}) {
  const keyOf = (p: Person) => p.email ?? p.displayName;
  return (
    <MultiSelect
      allLabel="No watchers"
      searchPlaceholder="Search people…"
      options={allPeople.map((p) => ({ value: keyOf(p), label: p.displayName }))}
      selected={selected.map(keyOf)}
      onChange={(keys) => {
        const next: Person[] = [];
        for (const k of keys) {
          const person = allPeople.find((p) => keyOf(p) === k);
          if (person) next.push(person);
        }
        onChange(next);
      }}
    />
  );
}
