import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, X } from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useOperationsProjects, useOperationsTasks } from "@/hooks/useOperationsTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCreateTaskFromQuote } from "@/hooks/useQuoteToTask";
import { computeNumberedTitle } from "@/lib/taskNumbering";
import { computeOperationsTaskNumber } from "@/lib/operationsTaskNumbering";
import {
  departmentLabel,
  quoteTaskRefusal,
  type QuoteTaskDepartment,
} from "@/lib/quoteToTask";
import type { Quote } from "@/types/quote";
import type { ProjectReference } from "@/types/task";
import { ChoicePills } from "./ChoicePills";
import { ChoiceSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// "Create task" from a WON quote — the Promote EIR dialog, for quotes. Pick
// Engineering or Operations, the parent project (defaulted from the quote's
// Linked work project, required: it sets the task's number), and the title.
// Rules in lib/quoteToTask.ts; the writes in hooks/useQuoteToTask.ts.
// =============================================================================

const DEPARTMENTS: QuoteTaskDepartment[] = ["engineering", "operations"];

function byTitle(a: ProjectReference, b: ProjectReference): number {
  return a.title.localeCompare(b.title, undefined, { numeric: true });
}

/** The quote's stored project title, matched to a project (case-insensitive). */
function defaultProjectId(projects: ProjectReference[], title: string): number | "" {
  const t = title.trim().toLowerCase();
  if (!t) return "";
  return projects.find((p) => p.title.trim().toLowerCase() === t)?.lookupId ?? "";
}

export function QuoteToTaskModal({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const create = useCreateTaskFromQuote();
  const { data: engProjects = [] } = useProjects();
  const { data: engTasks = [] } = useTasks();
  const { data: opsProjects = [] } = useOperationsProjects();
  const { data: opsTasks = [] } = useOperationsTasks();

  const open = DEPARTMENTS.filter((d) => quoteTaskRefusal(quote, d) === null);
  const [department, setDepartment] = useState<QuoteTaskDepartment>(open[0] ?? "engineering");
  const [title, setTitle] = useState(quote.customerReference.trim() || `Quote ${quote.quoteNumber}`);
  // A pick per department, so switching back keeps it; null = not touched yet.
  const [picked, setPicked] = useState<Record<QuoteTaskDepartment, number | "" | null>>({
    engineering: null,
    operations: null,
  });
  const [error, setError] = useState<string | null>(null);

  const projects = useMemo(
    () => [...(department === "engineering" ? engProjects : opsProjects)].sort(byTitle),
    [department, engProjects, opsProjects],
  );
  const storedTitle = department === "engineering" ? quote.engineeringProjectRef : quote.operationsProjectRef;
  const projectId = picked[department] ?? defaultProjectId(projects, storedTitle);
  const project = projectId === "" ? null : projects.find((p) => p.lookupId === projectId) ?? null;

  const trimmedTitle = title.trim();
  const preview = project
    ? department === "engineering"
      ? computeNumberedTitle(trimmedTitle || quote.quoteNumber, project, engTasks)
      : computeOperationsTaskNumber(project, opsTasks)
    : "Pick a project";
  const refusal = quoteTaskRefusal(quote, department);
  const busy = create.isPending;
  const comments = quote.comments.length;

  async function handleConfirm() {
    if (refusal) return setError(refusal);
    if (!trimmedTitle) return setError("Task title is required.");
    if (!project) return setError("Parent project is required — it sets the task's number.");
    setError(null);
    try {
      const result = await create.mutateAsync({
        quote,
        department,
        title: trimmedTitle,
        project,
        numberedTitle: department === "engineering" ? preview : undefined,
        createdBy: currentUser,
      });
      onClose();
      navigate(department === "engineering" ? `/task/${result.taskId}` : `/operations/task/${result.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the task.");
    }
  }

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quote-to-task-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-xs sm:items-center sm:p-4"
      {...overlayDismiss}
    >
      <div className="flex w-full max-w-lg flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 id="quote-to-task-heading" className="font-display text-base font-semibold text-fg sm:text-lg">
            Create task from quote
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
            <div role="alert" className="mb-3 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <p className="mb-4 text-sm text-fg-muted">
            This creates a task from won quote{" "}
            <span className="font-mono font-semibold text-fg">{quote.quoteNumber}</span>. Its discussion, watchers
            and attachments carry over, the quote records the task under Linked work, and from then on comments on
            either one are copied to the other.
          </p>

          <div className="mb-4 flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Department</span>
            <ChoicePills
              name="quote-task-department"
              label="Department"
              value={department === "engineering" ? "Engineering" : "Operations"}
              options={DEPARTMENTS.map(departmentLabel)}
              onChange={(v) => {
                if (v) setDepartment(v === "Engineering" ? "engineering" : "operations");
              }}
              disabled={busy}
            />
            {refusal && <span className="text-xs text-cooper-red">{refusal}</span>}
          </div>

          <label className="mb-4 flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Task title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              maxLength={255}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            />
          </label>

          <div className="mb-4 flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Parent project<span className="ml-1 text-cooper-red">*</span>
            </span>
            <ChoiceSelect
              ariaLabel="Parent project"
              value={projectId === "" ? "" : String(projectId)}
              onChange={(v) => setPicked((p) => ({ ...p, [department]: v === "" ? "" : parseInt(v, 10) }))}
              options={projects.map((p) => ({ value: String(p.lookupId), label: p.title }))}
              emptyLabel="Select a project…"
              clearable={false}
              searchPlaceholder="Search projects…"
              disabled={busy}
            />
            <span className="text-xs text-fg-muted">
              Sets the task's project and its number, and is saved on the quote under Linked work.
            </span>
          </div>

          <div className="grid gap-2 rounded-md border border-border bg-surface p-3 text-sm">
            <Row
              label="Numbered as"
              value={project ? <span className="font-mono">{preview}</span> : <span className="text-fg-muted">{preview}</span>}
            />
            <Row
              label="Carrying over"
              value={`${comments} comment${comments === 1 ? "" : "s"}, ${quote.watchers.length} watcher${
                quote.watchers.length === 1 ? "" : "s"
              }${quote.hasAttachments ? ", attachments" : ""}`}
            />
          </div>
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
            onClick={() => void handleConfirm()}
            disabled={busy || !trimmedTitle || !project || refusal !== null}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-50"
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
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <span className="min-w-0 wrap-break-word text-right text-fg">{value}</span>
    </div>
  );
}
