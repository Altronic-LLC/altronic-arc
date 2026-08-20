import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, Loader2, X } from "lucide-react";
import type { ProjectReference } from "@/types/task";
import { useCreateProjectFolder } from "@/hooks/useProjectFolders";
import { ChoiceSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New project folder.
//
// Creates a top-level folder under "General/Project Folders" and tags it with
// its Project Reference — the metadata that makes task uploads route into it
// instead of falling through to Miscellaneous. Before this, the tag could only
// be set by hand in SharePoint, so a folder created in ARC was invisible to the
// router that needed it.
//
// The name defaults to the project's title, because that's the convention the
// existing folders follow ("0017-AMP-5000 Refresh"). It stays editable — the
// convention isn't enforced anywhere and older folders don't all match it.
// =============================================================================

interface ProjectFolderFormModalProps {
  projects: ProjectReference[];
  /** Projects that already have a folder — offered greyed out, not hidden. */
  takenLookupIds: Set<number>;
  onClose: () => void;
  onCreated?: (folderName: string) => void;
}

export function ProjectFolderFormModal({
  projects,
  takenLookupIds,
  onClose,
  onCreated,
}: ProjectFolderFormModalProps) {
  const create = useCreateProjectFolder();
  const busy = create.isPending;

  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  /** True once the name has been typed in, so it stops tracking the project. */
  const [nameEdited, setNameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const options = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
        .map((p) => ({
          value: String(p.lookupId),
          label: takenLookupIds.has(p.lookupId) ? `${p.title} — has a folder` : p.title,
        })),
    [projects, takenLookupIds],
  );

  const chosen = projects.find((p) => String(p.lookupId) === projectId) ?? null;
  const alreadyHasFolder = chosen ? takenLookupIds.has(chosen.lookupId) : false;

  // The name follows the project until someone types their own.
  useEffect(() => {
    if (!nameEdited && chosen) setName(chosen.title);
  }, [chosen, nameEdited]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return setError("Pick the project this folder is for.");
    if (!name.trim()) return setError("A folder name is required.");
    if (alreadyHasFolder) {
      return setError(
        "That project already has a folder. Two folders for one project would make task uploads ambiguous.",
      );
    }
    setError(null);
    try {
      await create.mutateAsync({ name, projectLookupId: parseInt(projectId, 10) });
      onClose();
      onCreated?.(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the folder.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New project folder"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <FolderPlus className="h-4 w-4 text-accent" />
            New project folder
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
          id="project-folder-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="mb-4">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Project<span className="ml-1 text-cooper-red">*</span>
            </span>
            <ChoiceSelect
              value={projectId}
              onChange={(v) => setProjectId(v)}
              options={options}
              emptyLabel="Pick a project"
              searchPlaceholder="Search projects…"
              disabled={busy}
              ariaLabel="Project"
            />
            <span className="mt-1 block text-[11px] text-fg-muted">
              Tags the folder so files uploaded from a task on this project land
              here.
            </span>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Folder name<span className="ml-1 text-cooper-red">*</span>
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
              placeholder="0017-AMP-5000 Refresh"
              className="input"
              disabled={busy}
            />
            <span className="mt-1 block text-[11px] text-fg-muted">
              Follows the project name by default, matching the folders already
              in the library.
            </span>
          </label>

          {alreadyHasFolder && !error && (
            <p className="mt-4 text-sm text-cooper-red">
              That project already has a folder.
            </p>
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
            form="project-folder-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create folder
          </button>
        </div>
      </div>
    </div>
  );
}
