import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderOpen,
  Loader2,
  Upload,
} from "lucide-react";
import { useProjectFolderEntries, useUploadToFolder } from "@/hooks/useProjectFolders";
import { useProjects } from "@/hooks/useTasks";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { DriveEntry } from "@/api/projectFiles";

// =============================================================================
// Project Folders — a nested browser over the site's "General/Project Folders"
// document library. Navigate into folders (breadcrumb to come back up), open
// files/folders in SharePoint, and upload files into the current folder.
// Read + open + upload only; deleting is done in SharePoint itself.
// =============================================================================

interface Crumb {
  /** Drive-item id, or null for the top level. */
  id: string | null;
  name: string;
}

export function ProjectFoldersView() {
  const navigate = useNavigate();
  const [path, setPath] = useState<Crumb[]>([{ id: null, name: "Project Folders" }]);
  const current = path[path.length - 1];
  const currentId = current.id ?? undefined;
  const atRoot = current.id === null;

  const { data: entries = [], isLoading, isError, error } = useProjectFolderEntries(currentId);
  const { data: projects = [] } = useProjects();
  const upload = useUploadToFolder();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectTitleById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of projects) m.set(p.lookupId, p.title);
    return m;
  }, [projects]);

  function openFolder(entry: DriveEntry) {
    setPath((prev) => [...prev, { id: entry.id, name: entry.name }]);
  }

  function goTo(index: number) {
    setPath((prev) => prev.slice(0, index + 1));
  }

  function openInSharePoint(entry: DriveEntry) {
    if (entry.webUrl && entry.webUrl !== "#") {
      window.open(entry.webUrl, "_blank", "noreferrer");
    }
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file || !currentId) return;
    upload.mutate({ folderId: currentId, file });
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-4 sm:px-6 sm:py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg sm:text-2xl">
            <FolderOpen className="h-5 w-5 text-accent" />
            Project Folders
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Browse the Engineering document library. Open files or folders in
            SharePoint, or upload into a folder.
          </p>
        </div>
        {!atRoot && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFilePicked}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {upload.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {upload.isPending ? "Uploading…" : "Upload file"}
            </button>
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        {path.map((crumb, i) => {
          const isLast = i === path.length - 1;
          return (
            <span key={`${crumb.id ?? "root"}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-fg-muted" />}
              {isLast ? (
                <span className="font-medium text-fg">{crumb.name}</span>
              ) : (
                <button
                  onClick={() => goTo(i)}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {crumb.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      {isLoading ? (
        <LoadingTasks noun="the folder" />
      ) : isError ? (
        <div className="rounded-lg border border-cooper-red/30 bg-cooper-red/10 px-4 py-3 text-sm text-cooper-red">
          Couldn't load this folder. {error instanceof Error ? error.message.slice(0, 200) : ""}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-fg-muted">
          This folder is empty.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map((entry) =>
            entry.isFolder ? (
              <div
                key={entry.id}
                className="group flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-fg-muted hover:bg-surface-2"
              >
                <button
                  onClick={() => openFolder(entry)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Folder className="h-4 w-4 shrink-0 text-superior-blue" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">
                      {entry.name}
                    </span>
                    {atRoot && entry.projectLookupId
                      ? projectTitleById.get(entry.projectLookupId) && (
                          <span className="block truncate text-[11px] text-fg-muted">
                            {projectTitleById.get(entry.projectLookupId)}
                          </span>
                        )
                      : null}
                  </span>
                </button>
                <button
                  onClick={() => openInSharePoint(entry)}
                  className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg group-hover:opacity-100"
                  title="Open folder in SharePoint"
                  aria-label="Open folder in SharePoint"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                key={entry.id}
                onClick={() => openInSharePoint(entry)}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-fg-muted hover:bg-surface-2"
                title="Open in SharePoint"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <FileIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                  <span className="truncate text-sm font-medium text-fg">{entry.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-[11px] text-fg-muted">
                  <span className="tabular-nums">{formatSize(entry.size)}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
