import { useMemo, useRef, useState } from "react";
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
  Upload,
} from "lucide-react";
import type { DriveEntry } from "@/api/projectFiles";
import {
  SCN_DOCUMENTS_LIBRARY_URL,
  downloadScnDocument,
  scnFolderNameProblem,
} from "@/api/scnDocuments";
import {
  useCreateScnFolder,
  useScnDocumentPath,
  useScnDocuments,
  useUploadScnDocument,
} from "@/hooks/useScnDocuments";
import { useSortableTable } from "@/hooks/useSortableTable";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import type { SortColumn } from "@/lib/tableSort";
import { useFileDrop } from "@/components/useFileDrop";
import { DetailTopBar } from "@/components/DetailTopBar";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SortableHeader } from "@/components/SortableTableHeader";
import { pushToast } from "@/components/Toast";
import { cn } from "@/lib/cn";

// =============================================================================
// SCN Documents — a browser over the SCN subsite's Documents library (Ray,
// 2026-10-07: "create subfolders, see subfolders, edit files, add files
// directly in ARC").
//
// The current folder is `?folder=<driveItemId>` (absent = the library root),
// so Back, a refresh and a shared link all land where they should.
//
// "Edit" opens the file's webUrl in a new tab. For an Office file that IS
// Word / Excel / PowerPoint for the web, which edits the file in place in
// SharePoint — nothing to upload back. No delete and no rename, by choice:
// those are done in SharePoint ("Open in SharePoint" is one click away).
// =============================================================================

const OFFICE_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "doc", "xls", "ppt"]);

/** Does Edit open this file in Office for the web? */
export function isOfficeFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && OFFICE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
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

export function ScnDocumentsView() {
  const [params, setParams] = useSearchParams();
  const folderId = params.get("folder") || null;

  const { data: entries = [], isLoading, error, refetch } = useScnDocuments(folderId);
  const { data: path } = useScnDocumentPath(folderId);
  const createFolder = useCreateScnFolder();
  const upload = useUploadScnDocument();

  const crumbs = path ?? [{ id: null, name: "Documents", webUrl: SCN_DOCUMENTS_LIBRARY_URL }];
  const currentWebUrl = folderId
    ? (path?.[path.length - 1]?.webUrl ?? "")
    : SCN_DOCUMENTS_LIBRARY_URL;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

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
    return id ? `/supply-chain/scns/documents?folder=${encodeURIComponent(id)}` : "/supply-chain/scns/documents";
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
  const nameProblem = trimmedName ? scnFolderNameProblem(trimmedName) : null;

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
      const blob = await downloadScnDocument(entry.id);
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
      <DetailTopBar category="SCNs" listTo="/supply-chain/scns" />

      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <FolderOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">SCN Documents</h1>
            <p className="text-sm text-fg-muted">
              The SCN site's Documents library — browse folders, add files and folders,
              and edit Office files.
            </p>
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
            data-testid="scn-documents-file-input"
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
              list="The SCN Documents library"
              site="ALTRONICSALESTEAM/SCN"
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
                  {!entry.isFolder && fileActions(entry)}
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
                        <div className="flex justify-end">
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
    </div>
  );
}
