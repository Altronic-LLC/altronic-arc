import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  TextCursorInput,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import type { DriveEntry } from "@/api/projectFiles";
import { driveItemNameProblem } from "@/api/driveLibrary";
import type { DriveLibraryHooks } from "@/hooks/driveLibraryHooks";
import { useSortableTable } from "@/hooks/useSortableTable";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import type { SortColumn } from "@/lib/tableSort";
import { useFileDrop } from "@/components/useFileDrop";
import { DetailTopBar } from "@/components/DetailTopBar";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SortableHeader } from "@/components/SortableTableHeader";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import { pushToast } from "@/components/Toast";
import { cn } from "@/lib/cn";

// =============================================================================
// A folder-library browser — shared by SCN Documents (Ray, 2026-10-07: "create
// subfolders, see subfolders, edit files, add files directly in ARC") and Supply
// Chain Files (BusinessIT#36). Each passes its own hooks, wording and route.
//
// The current folder is `?folder=<driveItemId>` (absent = the library root),
// so Back, a refresh and a shared link all land where they should.
//
// "Edit" opens the file's webUrl in a new tab. For an Office file that IS
// Word / Excel / PowerPoint for the web, which edits the file in place in
// SharePoint — nothing to upload back.
//
// Rename and Delete sit on every row (Ray, 2026-10-07), open to anyone signed
// in. Delete sends the item to the site's recycle bin (93 days); a folder
// that still holds items needs its name typed back first.
// =============================================================================

const OFFICE_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "doc", "xls", "ppt"]);

/** Does Edit open this file in Office for the web? */
export function isOfficeFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && OFFICE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** The lower-cased extension ("docx"), or "" when there isn't one. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Where a file name's stem ends — what Rename pre-selects. */
export function stemLength(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

function hasDate(d: Date): boolean {
  return d.getTime() > 0;
}

function modifiedLabel(entry: DriveEntry): string {
  return hasDate(entry.lastModified)
    ? entry.lastModified.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";
}

function sizeLabel(entry: DriveEntry): string {
  if (entry.isFolder) {
    return entry.childCount === undefined
      ? ""
      : `${entry.childCount} item${entry.childCount === 1 ? "" : "s"}`;
  }
  const bytes = entry.size;
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const COLUMNS: SortColumn<DriveEntry>[] = [
  { key: "name", label: "Name", value: (e) => e.name, noFilter: true },
  {
    key: "modified",
    label: "Modified",
    kind: "date",
    value: modifiedLabel,
    sortValue: (e) => (hasDate(e.lastModified) ? e.lastModified : null),
  },
  {
    key: "size",
    label: "Size",
    kind: "number",
    value: sizeLabel,
    sortValue: (e) => (e.isFolder ? null : e.size),
    noFilter: true,
  },
];

function openExternal(url: string) {
  if (url && url !== "#") window.open(url, "_blank", "noopener,noreferrer");
}

export interface DriveLibraryViewProps {
  /** Page heading ("SCN Documents"). */
  title: string;
  /** One sentence under the heading. */
  description: string;
  /** The back-bar category + its list route. */
  category: string;
  listTo: string;
  /** This screen's route — breadcrumb links are `${basePath}?folder=…`. */
  basePath: string;
  rootName: string;
  rootWebUrl: string;
  /** For the refused-library notice. */
  accessList: string;
  accessSite: string;
  /** "the SCN site's" — completes "goes to ___ recycle bin". */
  recycleBinOwner: string;
  /** What the file input is called in tests. */
  fileInputTestId: string;
  hooks: DriveLibraryHooks;
  download: (itemId: string) => Promise<Blob>;
}

export function DriveLibraryView({
  title,
  description,
  category,
  listTo,
  basePath,
  rootName,
  rootWebUrl,
  accessList,
  accessSite,
  recycleBinOwner,
  fileInputTestId,
  hooks,
  download,
}: DriveLibraryViewProps) {
  const [params, setParams] = useSearchParams();
  const folderId = params.get("folder") || null;

  const { data: entries = [], isLoading, error, refetch } = hooks.useFolder(folderId);
  const { data: path } = hooks.usePath(folderId);
  const createFolder = hooks.useCreateFolder();
  const upload = hooks.useUpload();

  const crumbs = path ?? [{ id: null, name: rootName, webUrl: rootWebUrl }];
  const currentWebUrl = folderId ? (path?.[path.length - 1]?.webUrl ?? "") : rootWebUrl;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DriveEntry | null>(null);
  const [deleting, setDeleting] = useState<DriveEntry | null>(null);

  const order = useMemo(() => new Map(entries.map((e, i) => [e.id, i])), [entries]);
  const table = useSortableTable({
    rows: entries,
    columns: COLUMNS,
    // Ties break on the listing's own order (folders first, alphabetical).
    stableKey: (e) => -(order.get(e.id) ?? 0),
    initialKey: "name",
  });
  // Folders always lead, whatever the sort — what a file browser does.
  const rows = useMemo(
    () => [...table.rows.filter((e) => e.isFolder), ...table.rows.filter((e) => !e.isFolder)],
    [table.rows],
  );

  const accessDenied = !!error && isPermissionDenied(error);
  const busy = upload.isPending;

  function openFolder(entry: DriveEntry) {
    setParams({ folder: entry.id });
  }

  function crumbTo(id: string | null): string {
    return id ? `${basePath}?folder=${encodeURIComponent(id)}` : basePath;
  }

  function startUpload(files: File[]) {
    if (files.length === 0 || busy) return;
    upload.mutate({ folderId, files });
  }

  const { dragging, dropProps } = useFileDrop(startUpload, busy || !!error);

  function handlePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    startUpload(files);
  }

  const trimmedName = newFolderName.trim();
  const nameProblem = trimmedName ? driveItemNameProblem(trimmedName, "folder") : null;

  function submitNewFolder(e?: React.FormEvent) {
    e?.preventDefault();
    if (!trimmedName || nameProblem || createFolder.isPending) return;
    createFolder.mutate(
      { parentId: folderId, name: trimmedName },
      {
        onSuccess: () => {
          setNewFolderOpen(false);
          setNewFolderName("");
        },
      },
    );
  }

  function cancelNewFolder() {
    setNewFolderOpen(false);
    setNewFolderName("");
  }

  async function handleDownload(entry: DriveEntry) {
    setDownloading(entry.id);
    try {
      const blob = await download(entry.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = entry.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Not revoked immediately — some browsers start the save asynchronously.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      pushToast({
        message: `Couldn't download "${entry.name}". ${(err as Error).message}`,
        variant: "error",
      });
    } finally {
      setDownloading(null);
    }
  }

  /** Rename + Delete, on every row (table AND phone card). */
  function itemActions(entry: DriveEntry) {
    const kind = entry.isFolder ? "folder" : "file";
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRenaming(entry);
          }}
          aria-label={`Rename ${entry.name}`}
          title={`Rename this ${kind}`}
          className="inline-flex items-center rounded-md border border-border p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <TextCursorInput className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDeleting(entry);
          }}
          aria-label={`Delete ${entry.name}`}
          title={`Delete this ${kind} (it goes to the recycle bin)`}
          className="inline-flex items-center rounded-md border border-border p-1 text-fg-muted hover:border-cooper-red/40 hover:bg-cooper-red/10 hover:text-cooper-red"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  function fileActions(entry: DriveEntry) {
    const office = isOfficeFile(entry.name);
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <a
          href={entry.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-surface-2"
        >
          {office ? <Pencil className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
          {office ? "Edit in Office" : "Open"}
        </a>
        <button
          type="button"
          onClick={() => void handleDownload(entry)}
          disabled={downloading === entry.id}
          aria-label={`Download ${entry.name}`}
          title="Download"
          className="inline-flex items-center rounded-md border border-border p-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          {downloading === entry.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
      </span>
    );
  }

  function entryName(entry: DriveEntry) {
    return entry.isFolder ? (
      <button
        type="button"
        onClick={() => openFolder(entry)}
        className="flex min-w-0 items-center gap-2 text-left font-medium text-fg hover:text-accent"
      >
        <Folder className="h-4 w-4 shrink-0 text-superior-blue" />
        <span className="truncate">{entry.name}</span>
      </button>
    ) : (
      <span className="flex min-w-0 items-center gap-2 text-fg">
        <FileIcon className="h-4 w-4 shrink-0 text-fg-muted" />
        <span className="truncate">{entry.name}</span>
      </span>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category={category} listTo={listTo} />

      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <FolderOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">{title}</h1>
            <p className="text-sm text-fg-muted">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setNewFolderOpen(true)}
            disabled={!!error}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid={fileInputTestId}
            onChange={handlePicked}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || !!error}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Uploading…" : "Upload files"}
          </button>
          {currentWebUrl && (
            <a
              href={currentWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              <ExternalLink className="h-4 w-4" />
              Open in SharePoint
            </a>
          )}
        </div>
        <p className="text-xs text-fg-muted">
          Edit opens the file in Word / Excel for the web — changes save straight back to
          this folder.
        </p>
      </header>

      {newFolderOpen && (
        <form
          onSubmit={submitNewFolder}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-start"
        >
          <div className="min-w-0 flex-1">
            <input
              autoFocus
              aria-label="New folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                // Escape closes THIS form and nothing behind it.
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelNewFolder();
                }
              }}
              placeholder="Folder name"
              className="input w-full"
            />
            {nameProblem && <p className="mt-1 text-xs text-cooper-red">{nameProblem}</p>}
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!trimmedName || !!nameProblem || createFolder.isPending}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {createFolder.isPending ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={cancelNewFolder}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={`${crumb.id ?? "root"}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-fg-muted" />}
              {isLast ? (
                <span className="font-medium text-fg" aria-current="page">
                  {crumb.name}
                </span>
              ) : (
                <Link to={crumbTo(crumb.id)} className="text-accent underline-offset-2 hover:underline">
                  {crumb.name}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      {upload.progress && (
        <div className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm" role="status">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">
              Uploading {upload.progress.index} of {upload.progress.total}: {upload.progress.name}
            </span>
            <span className="tabular-nums text-fg-muted">
              {Math.round(upload.progress.fraction * 100)}%
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${Math.round(upload.progress.fraction * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div
        {...dropProps}
        className={cn(
          "overflow-hidden rounded-xl border bg-surface",
          dragging ? "border-accent ring-2 ring-accent/30" : "border-border",
        )}
      >
        {isLoading ? (
          <LoadingTasks noun="documents" />
        ) : accessDenied ? (
          <div className="p-4">
            <ListAccessNotice
              list={accessList}
              site={accessSite}
              onRetry={() => void refetch()}
            />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load this folder.</p>
            <p className="mt-1">{error instanceof Error ? error.message.slice(0, 300) : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          // The read SUCCEEDED and the folder really is empty.
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">This folder is empty.</p>
            <p className="mt-1">Drop files here, or use Upload files or New folder.</p>
          </div>
        ) : (
          <>
            {/* Phone: cards. */}
            <ul className="divide-y divide-border sm:hidden">
              {rows.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    {entryName(entry)}
                    <div className="mt-0.5 text-xs text-fg-muted">
                      {[modifiedLabel(entry), sizeLabel(entry)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {!entry.isFolder && fileActions(entry)}
                    {itemActions(entry)}
                  </div>
                </li>
              ))}
            </ul>

            {/* Wider screens: the sortable table. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-fg-muted">
                  <tr>
                    {COLUMNS.map((column) => (
                      <SortableHeader
                        key={column.key}
                        label={column.label}
                        {...table.headerProps(column.key)}
                      />
                    ))}
                    <th className="px-4 py-2 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((entry) => (
                    <tr key={entry.id} className="hover:bg-surface-2/50">
                      <td className="max-w-[28rem] px-4 py-2">
                        {entryName(entry)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{modifiedLabel(entry)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
                        {sizeLabel(entry)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          {entry.isFolder ? (
                            <button
                              type="button"
                              onClick={() => openExternal(entry.webUrl)}
                              title="Open folder in SharePoint"
                              aria-label={`Open ${entry.name} in SharePoint`}
                              className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            fileActions(entry)
                          )}
                          {itemActions(entry)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {renaming && (
        <RenameDialog entry={renaming} hooks={hooks} onClose={() => setRenaming(null)} />
      )}
      {deleting && (
        <DeleteDialog
          entry={deleting}
          hooks={hooks}
          recycleBinOwner={recycleBinOwner}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** Escape closes THIS dialog and nothing behind it (the house rule). */
function escapeCloses(onClose: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
}

function RenameDialog({
  entry,
  hooks,
  onClose,
}: {
  entry: DriveEntry;
  hooks: DriveLibraryHooks;
  onClose: () => void;
}) {
  const rename = hooks.useRename();
  const [name, setName] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const kind = entry.isFolder ? "folder" : "file";
  const overlay = useOverlayDismiss(onClose, rename.isPending);

  // A FILE pre-selects only its stem, so typing replaces "Report" and keeps ".docx".
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, entry.isFolder ? entry.name.length : stemLength(entry.name));
  }, [entry]);

  const problem = driveItemNameProblem(name, kind);
  const oldExt = entry.isFolder ? "" : extensionOf(entry.name);
  const extensionChanged = !entry.isFolder && !problem && extensionOf(name) !== oldExt;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (problem || rename.isPending) return;
    if (name === entry.name) {
      onClose();
      return;
    }
    rename.mutate({ item: entry, newName: name }, { onSuccess: onClose });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlay}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Rename ${entry.name}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={escapeCloses(onClose)}
        className="mt-16 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <h2 className="font-display text-base font-semibold text-fg">Rename {kind}</h2>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">New name</span>
            <input
              ref={inputRef}
              aria-label="New name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input w-full"
            />
          </label>
          {problem && <p className="text-xs text-cooper-red">{problem}</p>}
          {extensionChanged && (
            <p className="flex items-start gap-1.5 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-2.5 py-1.5 text-xs text-fg">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ajax-yellow" />
              {oldExt
                ? `Changing the extension can stop the file opening (it was .${oldExt}).`
                : "Changing the extension can stop the file opening."}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!!problem || rename.isPending}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {rename.isPending ? "Renaming…" : "Rename"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteDialog({
  entry,
  hooks,
  recycleBinOwner,
  onClose,
}: {
  entry: DriveEntry;
  hooks: DriveLibraryHooks;
  recycleBinOwner: string;
  onClose: () => void;
}) {
  const del = hooks.useDelete();
  const [typed, setTyped] = useState("");
  const overlay = useOverlayDismiss(onClose, del.isPending);
  const count = entry.isFolder ? (entry.childCount ?? 0) : 0;
  // A folder that still holds items needs its name typed back — the Parts List pattern.
  const needsTyped = entry.isFolder && count > 0;
  const confirmed = !needsTyped || typed === entry.name;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (needsTyped ? typedRef.current : cancelRef.current)?.focus();
  }, [needsTyped]);

  const question = entry.isFolder
    ? count > 0
      ? `Delete "${entry.name}" and the ${count} item${count === 1 ? "" : "s"} in it?`
      : `Delete the empty folder "${entry.name}"?`
    : `Delete "${entry.name}"?`;

  function confirm(e?: React.FormEvent) {
    e?.preventDefault();
    if (!confirmed || del.isPending) return;
    del.mutate({ item: entry }, { onSuccess: onClose });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlay}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Delete ${entry.name}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={escapeCloses(onClose)}
        className="mt-16 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <form onSubmit={confirm} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Trash2 className="h-4 w-4 shrink-0 text-cooper-red" />
            <span className="min-w-0 break-words">{question}</span>
          </h2>
          <p className="text-sm text-fg-muted">
            {needsTyped ? "The folder and everything in it go" : "It goes"} to {recycleBinOwner}
            recycle bin in SharePoint, where it can be restored for 93 days.
          </p>
          {needsTyped && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">
                Type <span className="font-semibold text-fg">{entry.name}</span> to confirm
              </span>
              <input
                ref={typedRef}
                aria-label="Type the folder name to confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="input w-full"
              />
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!confirmed || del.isPending}
              className="rounded-md bg-cooper-red px-3 py-1.5 text-sm font-medium text-white hover:bg-cooper-red/90 disabled:opacity-50"
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
