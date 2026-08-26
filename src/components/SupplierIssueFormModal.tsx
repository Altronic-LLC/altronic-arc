import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { SUPPLIER_ISSUE_SEVERITIES, SUPPLIER_ISSUE_STATUSES } from "@/types/task";
import { useCreateSupplierIssue } from "@/hooks/useSupplierIssues";
import { ChoiceSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Log a Supplier Issue — always scoped to the supplier whose detail page it
// was opened from. `Status` and `Severity` currently offer only the
// UNCONFIGURED placeholder choices SharePoint holds ("Choice 1/2/3") — see
// the note on the consts in types/task.ts.
// =============================================================================

export function SupplierIssueFormModal({
  supplierId,
  onClose,
}: {
  supplierId: number;
  onClose: () => void;
}) {
  const create = useCreateSupplierIssue();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !create.isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [create.isPending, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, create.isPending);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("A title is required.");
    setError(null);
    try {
      await create.mutateAsync({
        title,
        supplierId,
        description,
        status: (status || null) as (typeof SUPPLIER_ISSUE_STATUSES)[number] | null,
        severity: (severity || null) as (typeof SUPPLIER_ISSUE_SEVERITIES)[number] | null,
        watchers: [],
      });
      onClose();
    } catch {
      setError("Couldn't log the issue — please retry.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log issue"
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <AlertTriangle className="h-4 w-4 text-accent" />
            Log issue
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FieldLabel label="Title *">
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} className="input" disabled={create.isPending} />
          </FieldLabel>
          <FieldLabel label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input resize-y"
              disabled={create.isPending}
            />
          </FieldLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Status">
              <ChoiceSelect
                value={status}
                onChange={setStatus}
                options={SUPPLIER_ISSUE_STATUSES}
                emptyLabel="Not set"
                disabled={create.isPending}
              />
            </FieldLabel>
            <FieldLabel label="Severity">
              <ChoiceSelect
                value={severity}
                onChange={setSeverity}
                options={SUPPLIER_ISSUE_SEVERITIES}
                emptyLabel="Not set"
                disabled={create.isPending}
              />
            </FieldLabel>
          </div>

          {error && <p className="text-sm text-cooper-red">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={create.isPending}
              className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Log issue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
