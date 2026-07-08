import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, X } from "lucide-react";
import { usePromoteEirToTask } from "@/hooks/useEirs";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { computeNumberedTitle } from "@/lib/taskNumbering";
import type { Eir, ProjectReference } from "@/types/task";

/**
 * Modal shown when an EIR's Resolution is set to "Promoted to Task".
 * Confirms the promotion: lets the user pick the target project (defaulted
 * from the EIR's Project Reference — required so task numbering resolves a
 * code prefix), previews what carries across, and on confirm creates the
 * task and navigates to it.
 *
 * Cancelling does NOT commit the Resolution change — the caller only opens
 * this modal and never mutates the field itself, so the dropdown snaps back
 * to its previous value on close.
 */
export function PromoteEirModal({ eir, onClose }: { eir: Eir; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const { data: allTasks = [] } = useTasks();
  const currentUser = useCurrentUser();
  const promote = usePromoteEirToTask();

  // Editable task title, defaulted to the EIR's title.
  const [title, setTitle] = useState(eir.title);
  // Default the target project to the EIR's first Project Reference.
  const [projectId, setProjectId] = useState<number | "">(
    eir.parentProjects[0]?.lookupId ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  // Merge the projects catalogue with any of the EIR's own project refs that
  // aren't in it (archived / not yet loaded) so the default never vanishes.
  const projectOptions = useMemo<ProjectReference[]>(() => {
    const byId = new Map<number, ProjectReference>();
    for (const p of projects) byId.set(p.lookupId, p);
    for (const p of eir.parentProjects) {
      if (p.lookupId > 0 && !byId.has(p.lookupId)) {
        byId.set(p.lookupId, { lookupId: p.lookupId, title: p.title || `Project #${p.lookupId}` });
      }
    }
    return [...byId.values()].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
  }, [projects, eir.parentProjects]);

  const chosenProject =
    projectId === "" ? null : projectOptions.find((p) => p.lookupId === projectId) ?? null;

  const trimmedTitle = title.trim();
  const previewNumberedTitle = computeNumberedTitle(
    trimmedTitle || eir.title,
    chosenProject,
    allTasks,
  );
  const carriedComments = eir.comments.length;

  const busy = promote.isPending;

  async function handleConfirm() {
    if (!trimmedTitle) {
      setError("Task title is required.");
      return;
    }
    setError(null);
    try {
      const task = await promote.mutateAsync({
        eir,
        title: trimmedTitle,
        project: chosenProject,
        watchers: eir.watchers,
        numberedTitle: previewNumberedTitle,
        promotedBy: {
          displayName: currentUser.displayName,
          email: currentUser.email ?? "",
        },
      });
      onClose();
      navigate(`/task/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote EIR.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promote-eir-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2
            id="promote-eir-heading"
            className="font-display text-base font-semibold text-fg sm:text-lg"
          >
            Promote EIR to Task
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

          <p className="mb-4 text-sm text-fg-muted">
            This creates a new task from{" "}
            <span className="font-mono font-semibold text-fg">
              {eir.eirNo || `EIR #${eir.id}`}
            </span>
            . The EIR's title, description, watchers, and comment thread carry
            over; the task links back to this EIR.
          </p>

          {/* Editable task title (defaults to the EIR title). */}
          <label className="mb-4 flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Task title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              maxLength={255}
              placeholder="Title for the new task"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            />
          </label>

          {/* What carries over */}
          <div className="mb-4 grid gap-2 rounded-md border border-border bg-surface p-3 text-sm">
            <Row
              label="Numbered as"
              value={<span className="font-mono">{previewNumberedTitle}</span>}
            />
            <Row
              label="Carrying over"
              value={`${carriedComments} comment${carriedComments === 1 ? "" : "s"}, ${
                eir.watchers.length
              } watcher${eir.watchers.length === 1 ? "" : "s"}`}
            />
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Parent project
            </span>
            <select
              value={projectId}
              onChange={(e) =>
                setProjectId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
              }
              disabled={busy}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            >
              <option value="">No project (numbers under 0000)</option>
              {projectOptions.map((p) => (
                <option key={p.lookupId} value={p.lookupId}>
                  {p.title}
                </option>
              ))}
            </select>
            <span className="text-xs text-fg-muted">
              Sets the task's Parent Project and its number prefix.
            </span>
          </label>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !trimmedTitle}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <span className="min-w-0 break-words text-right text-fg">{value}</span>
    </div>
  );
}
