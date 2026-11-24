import { useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  Folder,
  ImageOff,
  Loader2,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import { isImageFile } from "@/api/driveLibrary";
import type { DriveEntry } from "@/api/projectFiles";
import { useDrivePhoto, useNearScreen, type PhotoLoader } from "@/hooks/useDrivePhoto";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { cn } from "@/lib/cn";

// =============================================================================
// The photo gallery (Application Photos, Ray 2026-11-24: "a photo gallery a
// user can preview before clicking to open the image").
//
// Folders lead as tiles, then a tile per file with its picture. A tile asks
// for its picture only once it comes near the screen. Clicking a file opens a
// PREVIEW over the page — a larger picture, previous / next (← →), and the
// file's actions: Open (the full image in SharePoint), Download, Rename,
// Delete. Escape closes the preview and nothing behind it.
// =============================================================================

export interface PhotoGalleryActions {
  onOpenFolder: (entry: DriveEntry) => void;
  onDownload: (entry: DriveEntry) => void;
  downloadingId: string | null;
  onRename: (entry: DriveEntry) => void;
  onDelete: (entry: DriveEntry) => void;
}

function dateLabel(d: Date): string {
  return d.getTime() > 0
    ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
}

function sizeLabel(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PhotoGrid({
  entries,
  keyPrefix,
  loader,
  onPreview,
  onOpenFolder,
}: {
  /** Folders first, then files, in the order to show. */
  entries: DriveEntry[];
  keyPrefix: string;
  loader: PhotoLoader;
  onPreview: (entry: DriveEntry) => void;
  onOpenFolder: (entry: DriveEntry) => void;
}) {
  return (
    <ul
      aria-label="Photos"
      className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
    >
      {entries.map((entry) =>
        entry.isFolder ? (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpenFolder(entry)}
              className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-2/40 p-3 text-center hover:border-fg-muted hover:bg-surface-2"
            >
              <Folder className="h-10 w-10 text-superior-blue" aria-hidden />
              <span className="line-clamp-2 text-sm font-medium break-words text-fg">{entry.name}</span>
              {entry.childCount !== undefined && (
                <span className="text-xs text-fg-muted">
                  {entry.childCount} item{entry.childCount === 1 ? "" : "s"}
                </span>
              )}
            </button>
          </li>
        ) : (
          <li key={entry.id}>
            <PhotoTile entry={entry} keyPrefix={keyPrefix} loader={loader} onPreview={onPreview} />
          </li>
        ),
      )}
    </ul>
  );
}

function PhotoTile({
  entry,
  keyPrefix,
  loader,
  onPreview,
}: {
  entry: DriveEntry;
  keyPrefix: string;
  loader: PhotoLoader;
  onPreview: (entry: DriveEntry) => void;
}) {
  const image = isImageFile(entry.name);
  const [ref, near] = useNearScreen<HTMLButtonElement>();
  const photo = useDrivePhoto(keyPrefix, loader, entry, "medium", image && near);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onPreview(entry)}
      aria-label={`Preview ${entry.name}`}
      className="group flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface text-left hover:border-fg-muted hover:shadow-md"
    >
      <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-surface-2">
        {photo.url ? (
          <img
            src={photo.url}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
          />
        ) : photo.loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-fg-muted" aria-hidden />
        ) : image ? (
          <ImageOff className="h-8 w-8 text-fg-muted" aria-hidden />
        ) : (
          <FileIcon className="h-8 w-8 text-fg-muted" aria-hidden />
        )}
      </span>
      <span className="flex flex-col px-2 py-1.5">
        <span className="truncate text-xs font-medium text-fg" title={entry.name}>
          {entry.name}
        </span>
        <span className="text-[11px] text-fg-muted">{dateLabel(entry.lastModified)}</span>
      </span>
    </button>
  );
}

/**
 * The preview over the page. `files` is what ← → step through (the folder's
 * files, in the gallery's order); `index` is the one showing.
 */
interface PreviewProps {
  files: DriveEntry[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  keyPrefix: string;
  loader: PhotoLoader;
  actions: Omit<PhotoGalleryActions, "onOpenFolder">;
}

export function PhotoPreview(props: PreviewProps) {
  const entry = props.files[props.index];
  // The folder can change under the preview (a delete, a refetch).
  return entry ? <PreviewBody {...props} entry={entry} /> : null;
}

function PreviewBody({
  files,
  index,
  onIndex,
  onClose,
  keyPrefix,
  loader,
  actions,
  entry,
}: PreviewProps & { entry: DriveEntry }) {
  const image = isImageFile(entry.name);
  const photo = useDrivePhoto(keyPrefix, loader, entry, "large", image);
  const overlay = useOverlayDismiss(onClose, false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hasPrev = index > 0;
  const hasNext = index < files.length - 1;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowLeft" && hasPrev) {
      e.preventDefault();
      onIndex(index - 1);
    } else if (e.key === "ArrowRight" && hasNext) {
      e.preventDefault();
      onIndex(index + 1);
    }
  }

  const meta = [dateLabel(entry.lastModified), sizeLabel(entry.size)].filter(Boolean).join(" · ");
  const button =
    "inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20 disabled:opacity-50";

  return (
    <div
      {...overlay}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${entry.name}`}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{entry.name}</p>
          <p className="text-xs text-white/70">
            {index + 1} of {files.length}
            {meta ? ` · ${meta}` : ""}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="rounded-md p-1.5 text-white/80 hover:bg-white/15 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center py-3">
        {hasPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIndex(index - 1);
            }}
            aria-label="Previous photo"
            className="absolute left-0 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <div className="flex h-full max-w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
          {photo.url ? (
            <img
              src={photo.url}
              alt={entry.name}
              className="max-h-full max-w-full rounded-sm object-contain shadow-2xl"
            />
          ) : photo.loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-white/80" aria-label="Loading the photo" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center text-sm text-white/80">
              {image ? <ImageOff className="h-12 w-12" /> : <FileIcon className="h-12 w-12" />}
              <p>{image ? "This photo can't be previewed here." : "No preview for this kind of file."}</p>
              <p>Open shows it in SharePoint.</p>
            </div>
          )}
        </div>
        {hasNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIndex(index + 1);
            }}
            aria-label="Next photo"
            className="absolute right-0 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
        <a href={entry.webUrl} target="_blank" rel="noopener noreferrer" className={cn(button, "bg-white/20")}>
          <ExternalLink className="h-4 w-4" />
          Open
        </a>
        <button
          type="button"
          onClick={() => actions.onDownload(entry)}
          disabled={actions.downloadingId === entry.id}
          className={button}
        >
          {actions.downloadingId === entry.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download
        </button>
        <button type="button" onClick={() => actions.onRename(entry)} className={button}>
          <TextCursorInput className="h-4 w-4" />
          Rename
        </button>
        <button type="button" onClick={() => actions.onDelete(entry)} className={button}>
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}
