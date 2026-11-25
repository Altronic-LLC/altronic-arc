import { useEffect, useRef, useState } from "react";
import { ChevronRight, ExternalLink, FileText, Folder, FolderOpen, Link2, Loader2, Upload, X } from "lucide-react";
import type { DriveEntry } from "@/api/projectFiles";
import { useProjectFolderEntries, useUploadToFolder } from "@/hooks/useProjectFolders";
import { folderPathText, type PickedLibraryFile } from "@/lib/linkedFiles";
import { cn } from "@/lib/cn";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Pick files from the Engineering project-folder library (BusinessIT#62).
//
// Opens AT the task's project folder, and can go up to General / Project
// Folders and into any folder from there — a file filed under another project
// can be linked too. Files are ticked across folders; nothing is copied:
// `onPick` hands back which files, and the caller links them.
//
// "Upload here" covers a file that isn't in SharePoint yet: it goes into the
// folder on screen (never the project folder's top level by default) and is
// ticked, ready to link. That is the "ask where the file should go" half of
// the request.
// =============================================================================

interface Crumb {
  /** Drive item id; `undefined` is General / Project Folders itself. */
  id: string | undefined;
  name: string;
}

const ROOT: Crumb = { id: undefined, name: "Project Folders" };

interface Props {
  /** The folder to open at — the task's project folder. `null` opens at Project Folders. */
  startFolder: { id: string; name: string } | null;
  /** The dialog's heading. */
  title?: string;
  /** The confirm button's verb, "Link" by default. */
  confirmVerb?: string;
  /** Files already linked here — shown ticked and not pickable again. */
  alreadyLinked?: ReadonlySet<string>;
  onPick: (files: PickedLibraryFile[]) => void;
  onClose: () => void;
}

export function LibraryFilePicker({
  startFolder,
  title = "Attach from library",
  confirmVerb = "Link",
  alreadyLinked,
  onPick,
  onClose,
}: Props) {
  const [stack, setStack] = useState<Crumb[]>(() =>
    startFolder ? [ROOT, { id: startFolder.id, name: startFolder.name }] : [ROOT],
  );
  const here = stack[stack.length - 1];
  const listing = useProjectFolderEntries(here.id);
  const upload = useUploadToFolder();
  const [picked, setPicked] = useState<Map<string, PickedLibraryFile>>(new Map());
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const overlayDismiss = useOverlayDismiss(onClose);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  /** The folders below Project Folders down to the one on screen. */
  const folderNames = stack.slice(1).map((c) => c.name);

  function toPicked(e: DriveEntry): PickedLibraryFile {
    return { id: e.id, name: e.name, webUrl: e.webUrl, folderPath: folderPathText(folderNames) };
  }

  function toggle(e: DriveEntry) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(e.id)) next.delete(e.id);
      else next.set(e.id, toPicked(e));
      return next;
    });
  }

  async function uploadHere(files: File[]) {
    if (!here.id || files.length === 0) return;
    // One at a time: several large uploads in parallel over a VPN are what
    // fails. Each one that lands is ticked, ready to link.
    for (const file of files) {
      setUploading(file.name);
      try {
        // eslint-disable-next-line no-await-in-loop
        const entry = await upload.mutateAsync({ folderId: here.id, file });
        setPicked((prev) => new Map(prev).set(entry.id, toPicked(entry)));
      } catch {
        // useUploadToFolder has already said why in a toast.
      }
    }
    setUploading(null);
  }

  const entries = listing.data ?? [];
  const count = picked.size;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-picker-heading"
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/40 backdrop-blur-xs sm:p-4"
      {...overlayDismiss}
    >
      <div className="my-auto flex max-h-full w-full max-w-2xl flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 id="library-picker-heading" className="font-display text-base font-semibold text-fg sm:text-lg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5">
          <p className="text-xs text-fg-muted">
            Tick the files to link. They stay where they are in SharePoint — nothing is copied. A file
            that isn't in SharePoint yet can be uploaded into the folder it belongs in, then linked.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Folder path" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
              {stack.map((c, i) => (
                <span key={c.id ?? "root"} className="inline-flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-fg-muted" />}
                  {i === stack.length - 1 ? (
                    <span className="inline-flex items-center gap-1 font-medium text-fg">
                      <FolderOpen className="h-4 w-4 text-ajax-yellow" />
                      {c.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStack((s) => s.slice(0, i + 1))}
                      className="text-accent hover:underline"
                    >
                      {c.name}
                    </button>
                  )}
                </span>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={!here.id || uploading !== null}
              title={here.id ? `Upload into ${here.name}` : "Open a project folder to upload into it"}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload here
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              data-testid="library-picker-file-input"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void uploadHere(files);
              }}
            />
          </div>

          {uploading && (
            <p className="text-xs text-fg-muted" role="status">
              Uploading {uploading} to {here.name}…
            </p>
          )}

          {listing.isLoading ? (
            <p className="text-sm text-fg-muted">Loading the folder…</p>
          ) : listing.error ? (
            <p className="text-sm text-cooper-red" role="alert">
              Couldn't open this folder:{" "}
              {listing.error instanceof Error ? listing.error.message : "unknown error"}
            </p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-fg-muted">This folder is empty.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label={`Contents of ${here.name}`}>
              {entries.map((e) => {
                if (e.isFolder) {
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setStack((s) => [...s, { id: e.id, name: e.name }])}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-2 hover:text-accent"
                      >
                        <Folder className="h-4 w-4 shrink-0 text-ajax-yellow" />
                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" />
                      </button>
                    </li>
                  );
                }
                const linked = alreadyLinked?.has(e.id) ?? false;
                const ticked = linked || picked.has(e.id);
                return (
                  <li key={e.id} className={cn("flex items-center gap-2 px-3 py-2 text-sm", ticked && "bg-accent/5")}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ticked}
                        disabled={linked}
                        onChange={() => toggle(e)}
                        className="h-4 w-4 shrink-0 accent-accent"
                      />
                      <FileText className="h-4 w-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1 truncate text-fg" title={e.name}>
                        {e.name}
                      </span>
                      {linked && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                          Linked
                        </span>
                      )}
                    </label>
                    <a
                      href={e.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-fg-muted hover:text-fg"
                      aria-label={`Open ${e.name}`}
                      title="Open in SharePoint"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          {count > 0 && (
            <span className="mr-auto text-xs text-fg-muted">
              {count} file{count === 1 ? "" : "s"} ticked
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={count === 0 || uploading !== null}
            onClick={() => onPick([...picked.values()])}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Link2 className="h-4 w-4" />
            {confirmVerb} {count > 0 ? `${count} file${count === 1 ? "" : "s"}` : "files"}
          </button>
        </div>
      </div>
    </div>
  );
}
