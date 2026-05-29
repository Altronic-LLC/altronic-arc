import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useCreateTestSheet, useUpdateTestSheetFields } from "@/hooks/useTestSheets";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Person, Task, TestSheet } from "@/types/task";
import { SingleSelect } from "./SearchableSelect";

interface TestSheetFormModalProps {
  /** "create" opens an empty form; "edit" pre-fills from `sheet` and PATCHes. */
  mode: "create" | "edit";
  /** Required when mode === "edit". */
  sheet?: TestSheet | null;
  /**
   * When creating from a task's detail page, pass the task. The project
   * and task references are pre-filled and shown as read-only — the user
   * doesn't need to repeat what we already know.
   */
  fromTask?: Task | null;
  onClose: () => void;
}

export function TestSheetFormModal({ mode, sheet, fromTask, onClose }: TestSheetFormModalProps) {
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const currentUser = useCurrentUser();
  const createSheet = useCreateTestSheet();
  const updateFields = useUpdateTestSheetFields();

  const lockReferences = mode === "create" && !!fromTask;

  const [title, setTitle] = useState<string>(
    sheet?.title ?? (fromTask ? `${fromTask.numberedTitle} — Test Sheet` : ""),
  );
  const [product, setProduct] = useState<string>(sheet?.product ?? "");
  const [serialNumber, setSerialNumber] = useState<string>(sheet?.serialNumber ?? "");
  const [purpose, setPurpose] = useState<string>(sheet?.purpose ?? "");
  const [results, setResults] = useState<string>(sheet?.results ?? "");
  const [testDate, setTestDate] = useState<string>(
    sheet?.testDate
      ? sheet.testDate.toISOString().slice(0, 10)
      : mode === "create"
        ? new Date().toISOString().slice(0, 10)
        : "",
  );
  const [projectId, setProjectId] = useState<number | null>(
    sheet?.parentProject?.lookupId ?? fromTask?.parentProject?.lookupId ?? null,
  );
  const [taskId, setTaskId] = useState<number | null>(
    sheet?.parentTask?.id ?? fromTask?.id ?? null,
  );
  const [tester, setTester] = useState<Person | null>(
    sheet?.tester ?? (mode === "create" ? currentUser : null),
  );
  const [testingSteps, setTestingSteps] = useState<string>(sheet?.testingSteps ?? "");
  const [firmwareVersion, setFirmwareVersion] = useState<string>(sheet?.firmwareVersion ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unique people set drawn from assignees + watchers across all tasks.
  // Same approach as FilterBar so the Tester dropdown shows the same people
  // the user already sees elsewhere in the app.
  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const t of tasks) {
      for (const p of [...t.assigned, ...t.watchers]) {
        const key = (p.email ?? p.displayName).toLowerCase();
        if (!map.has(key)) map.set(key, p);
      }
    }
    // Always include the current user (they may not be on any task yet).
    if (currentUser.email) {
      const k = currentUser.email.toLowerCase();
      if (!map.has(k)) map.set(k, currentUser);
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [tasks, currentUser]);

  const projectOptions = projects.map((p) => ({
    value: String(p.lookupId),
    label: p.title,
  }));
  const taskOptions = tasks
    .map((t) => ({ value: String(t.id), label: t.numberedTitle }))
    // Natural-sort: T2 before T10. The default lexical sort would put T10
    // ahead of T2 — confusing for engineers who think in number order.
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const peopleOptions = people.map((p) => ({
    value: p.email ?? p.displayName,
    label: p.displayName,
  }));

  function findPerson(key: string | null): Person | null {
    if (!key) return null;
    return people.find((p) => (p.email ?? p.displayName) === key) ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (mode === "create") {
        const created = await createSheet.mutateAsync({
          title: title.trim(),
          product,
          serialNumber,
          purpose,
          results,
          testDate: testDate ? new Date(testDate) : null,
          parentProjectLookupId: projectId,
          parentTaskLookupId: taskId,
          tester,
          testingSteps,
          firmwareVersion,
        });
        onClose();
        navigate(`/test-sheet/${created.id}`);
      } else if (sheet) {
        // Edit mode: send only the changed fields. Compares are simple
        // since these are all primitives or nullable foreign keys.
        const fields: Record<string, unknown> = {};
        if (title !== sheet.title) fields.Title = title;
        if (product !== sheet.product) fields.Product = product;
        if (serialNumber !== sheet.serialNumber) fields.SerialNumber = serialNumber;
        if (purpose !== sheet.purpose) fields.Purpose = purpose;
        if (results !== sheet.results) fields.Results = results;
        const newDateIso = testDate ? new Date(testDate).toISOString() : null;
        const oldDateIso = sheet.testDate ? sheet.testDate.toISOString() : null;
        if (newDateIso !== oldDateIso) fields.TestDate = newDateIso;
        if (projectId !== (sheet.parentProject?.lookupId ?? null)) {
          fields.ProjectReferenceLookupId = projectId;
        }
        if (taskId !== (sheet.parentTask?.id ?? null)) {
          fields.TaskReferenceLookupId = taskId;
        }
        const oldTesterKey = sheet.tester ? sheet.tester.email ?? sheet.tester.displayName : null;
        const newTesterKey = tester ? tester.email ?? tester.displayName : null;
        if (oldTesterKey !== newTesterKey) {
          fields.Tester = tester;
        }
        if (testingSteps !== sheet.testingSteps) fields.TestingSteps = testingSteps;
        if (firmwareVersion !== sheet.firmwareVersion) {
          fields.FirmwareVersion = firmwareVersion;
        }
        if (Object.keys(fields).length > 0) {
          await updateFields.mutateAsync({ id: sheet.id, fields });
        }
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save test sheet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ts-form-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-2xl flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 id="ts-form-heading" className="font-display text-base font-semibold text-fg sm:text-lg">
            {mode === "create" ? "New test sheet" : "Edit test sheet"}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldShell label="Title" required className="sm:col-span-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
                className="input"
              />
            </FieldShell>

            <FieldShell label="Product">
              <input
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                className="input"
              />
            </FieldShell>

            <FieldShell label="Serial Number">
              <input
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="input"
              />
            </FieldShell>

            <FieldShell label="Test Date">
              <input
                type="date"
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
                className="input"
              />
            </FieldShell>

            <FieldShell label="Firmware Version">
              <input
                value={firmwareVersion}
                onChange={(e) => setFirmwareVersion(e.target.value)}
                className="input"
              />
            </FieldShell>

            <FieldShell label="Project Reference">
              {lockReferences ? (
                <LockedPill text={fromTask?.parentProject?.title ?? "—"} />
              ) : (
                <SingleSelect
                  allLabel="None"
                  searchPlaceholder="Search projects…"
                  options={projectOptions}
                  selected={projectId != null ? String(projectId) : null}
                  onChange={(v) => setProjectId(v ? parseInt(v, 10) : null)}
                />
              )}
            </FieldShell>

            <FieldShell label="Task Reference">
              {lockReferences ? (
                <LockedPill text={fromTask?.numberedTitle ?? "—"} />
              ) : (
                <SingleSelect
                  allLabel="None"
                  searchPlaceholder="Search tasks…"
                  options={taskOptions}
                  selected={taskId != null ? String(taskId) : null}
                  onChange={(v) => setTaskId(v ? parseInt(v, 10) : null)}
                />
              )}
            </FieldShell>

            <FieldShell label="Tester" className="sm:col-span-2">
              <SingleSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={peopleOptions}
                selected={tester ? tester.email ?? tester.displayName : null}
                onChange={(v) => setTester(findPerson(v))}
              />
            </FieldShell>

            <FieldShell label="Purpose" className="sm:col-span-2">
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                className="input resize-y"
              />
            </FieldShell>

            <FieldShell label="Testing Steps" className="sm:col-span-2">
              <textarea
                value={testingSteps}
                onChange={(e) => setTestingSteps(e.target.value)}
                rows={5}
                className="input resize-y"
              />
            </FieldShell>

            <FieldShell label="Results" className="sm:col-span-2">
              <textarea
                value={results}
                onChange={(e) => setResults(e.target.value)}
                rows={4}
                className="input resize-y"
              />
            </FieldShell>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-black shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "create" ? (busy ? "Creating…" : "Create") : busy ? "Saving…" : "Save"}
          </button>
        </div>

        <style>{`
          .input {
            width: 100%;
            min-height: 38px;
            padding: 0.5rem 0.75rem;
            background: rgb(var(--surface));
            color: rgb(var(--fg));
            border: 1px solid rgb(var(--border));
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 120ms ease, box-shadow 120ms ease;
          }
          @media (min-width: 640px) {
            .input { font-size: 0.875rem; }
          }
          .input:focus {
            outline: none;
            border-color: rgb(var(--accent));
            box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
          }
        `}</style>
      </form>
    </div>
  );
}

function FieldShell({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </label>
  );
}

function LockedPill({ text }: { text: string }) {
  return (
    <div className="flex h-[38px] items-center rounded-md border border-dashed border-border bg-surface-2 px-3 text-sm text-fg">
      <span className="truncate">{text || "—"}</span>
    </div>
  );
}
