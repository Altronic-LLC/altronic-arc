import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { useCreateFeatureRequest } from "@/hooks/useFeatureRequests";
import {
  FEATURE_REQUEST_DEPARTMENTS,
  FEATURE_REQUEST_PRIORITIES,
  type FeatureRequestDepartment,
  type FeatureRequestPriority,
} from "@/types/task";
import { ChoiceSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface FeatureRequestFormModalProps {
  onClose: () => void;
}

/**
 * "Suggest a feature" create form. Title, Description, Department and
 * Priority only — RequestedBy, Status and Watchers are set by the API
 * (auto-filled to the submitter, defaulted to Pending Review, see
 * api/featureRequests.ts) and never appear here.
 */
export function FeatureRequestFormModal({ onClose }: FeatureRequestFormModalProps) {
  const navigate = useNavigate();
  const createRequest = useCreateFeatureRequest();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState<FeatureRequestDepartment | "">("");
  const [priority, setPriority] = useState<FeatureRequestPriority | "">("");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("A short summary is required.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const created = await createRequest.mutateAsync({
        title: trimmedTitle,
        description: description.trim(),
        department: department || null,
        priority: priority || null,
      });
      onClose();
      navigate(`/feature-request/${created.id}`);
    } catch {
      setError("Couldn't submit the request — please retry.");
      setBusy(false);
    }
  }

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" /> Suggest a Feature
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FieldLabel label="Summary *">
            <input
              ref={titleInputRef}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Bulk status change on the EIR board"
              className="input h-[38px]"
              disabled={busy}
            />
          </FieldLabel>

          <FieldLabel label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What's needed, and why"
              className="input resize-y"
              disabled={busy}
            />
          </FieldLabel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Department">
              <ChoiceSelect
                value={department}
                onChange={(v) => setDepartment((v as FeatureRequestDepartment) || "")}
                options={FEATURE_REQUEST_DEPARTMENTS}
                emptyLabel="Not set"
                searchPlaceholder="Search departments…"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Priority">
              <ChoiceSelect
                value={priority}
                onChange={(v) => setPriority((v as FeatureRequestPriority) || "")}
                options={FEATURE_REQUEST_PRIORITIES}
                emptyLabel="Not set"
                searchPlaceholder="Search priorities…"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          {error && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-fg-muted">
              Starts as <span className="font-semibold">Pending Review</span>. You'll be added
              as a watcher.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !title.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
