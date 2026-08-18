import { useRef, useState } from "react";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import {
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "@/hooks/useAttachments";
import { SharePointUnavailableError } from "@/api/sharepoint";
import type { AttachmentParent } from "@/api/attachments";
import { filesFromClipboard } from "@/lib/pasteFiles";
import { useFileDrop } from "./useFileDrop";
import { cn } from "@/lib/cn";
import { NameAttachmentDialog, needsAttachmentName } from "./NameAttachmentDialog";

interface AttachmentsSectionProps {
  parent: AttachmentParent;
  itemId: number;
}

/**
 * Attachments card used by Task and EIR detail. Shows the current
 * attachments, lets the user add or remove. Reads from the SharePoint
 * REST API via useAttachments; if the SP REST endpoint isn't reachable
 * (admin hasn't granted the API permission yet) the section degrades
 * to a friendly notice instead of crashing the detail view.
 */
export function AttachmentsSection({ parent, itemId }: AttachmentsSectionProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: attachments = [], isLoading, error } = useAttachments(parent, itemId);
  const upload = useUploadAttachment(parent, itemId);
  const remove = useDeleteAttachment(parent, itemId);

  // Unnamed screenshots wait here for the user to name them before they're
  // uploaded — one dialog at a time, so pasting several in a row prompts for
  // each rather than dropping the ones after the first.
  const [namingQueue, setNamingQueue] = useState<File[]>([]);

  /**
   * Upload a batch of files, prompting for a name for any that arrived
   * without one. Shared by the file picker, paste, and drag-and-drop so all
   * three behave identically.
   */
  function addFiles(files: File[]) {
    const unnamed: File[] = [];
    for (const file of files) {
      if (needsAttachmentName(file)) unnamed.push(file);
      else upload.mutate(file);
    }
    if (unnamed.length > 0) setNamingQueue((prev) => [...prev, ...unnamed]);
  }

  const { dragging, dropProps } = useFileDrop(addFiles, upload.isPending);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = ""; // allow re-selecting the same file
  }

  /**
   * Paste a screenshot straight into the card. The card carries tabIndex so it
   * can hold focus and receive the paste at all — a document-level listener
   * isn't an option here, because a build request renders one of these cards
   * per part and every one of them would claim the same paste.
   *
   * A file pasted with a real name uploads immediately, as before. An
   * unnamed screenshot is queued for the naming prompt instead.
   */
  function handlePaste(e: React.ClipboardEvent) {
    const pasted = filesFromClipboard(e.clipboardData);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  }

  return (
    <div
      tabIndex={0}
      onPaste={handlePaste}
      {...dropProps}
      className={cn(
        "rounded-lg border bg-surface p-4 focus:outline-none focus:ring-2 focus:ring-accent/30 sm:p-5",
        dragging ? "border-accent ring-2 ring-accent/30" : "border-border",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          <Paperclip className="h-4 w-4" />
          Attachments
          {attachments.length > 0 && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold tabular-nums text-fg">
              {attachments.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:border-fg-muted disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {upload.isPending ? "Uploading…" : "Add file"}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {error instanceof SharePointUnavailableError ? (
        <UnavailableNotice message={error.message} />
      ) : error ? (
        <UnavailableNotice message={(error as Error).message} />
      ) : isLoading ? (
        <div className="py-4 text-center text-xs text-fg-muted">Loading attachments…</div>
      ) : attachments.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-fg-muted">
          {dragging
            ? "Drop to attach"
            : 'No attachments yet. Drag files here, paste a screenshot, or click "Add file".'}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((a) => (
            <li
              key={a.serverRelativeUrl}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-fg-muted" />
              <a
                href={a.downloadUrl}
                download={a.fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-fg hover:text-accent hover:underline"
                title={a.fileName}
              >
                {a.fileName}
              </a>
              <a
                href={a.downloadUrl}
                download={a.fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fg-muted hover:text-fg"
                aria-label={`Download ${a.fileName}`}
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove "${a.fileName}" from this ${
                        parent === "eir"
                          ? "EIR"
                          : parent === "buildRequest"
                            ? "build request"
                            : parent === "buildRequestItem"
                              ? "part"
                              : "task"
                      }?`,
                    )
                  ) {
                    remove.mutate(a.fileName);
                  }
                }}
                disabled={remove.isPending}
                className="text-fg-muted hover:text-cooper-red disabled:opacity-50"
                aria-label={`Remove ${a.fileName}`}
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {upload.error && (
        <div className="mt-2 text-xs text-cooper-red">
          Upload failed: {(upload.error as Error).message}
        </div>
      )}

      {namingQueue.length > 0 && (
        <NameAttachmentDialog
          file={namingQueue[0]}
          onConfirm={(renamed) => {
            upload.mutate(renamed);
            setNamingQueue((prev) => prev.slice(1));
          }}
          onCancel={() => setNamingQueue((prev) => prev.slice(1))}
        />
      )}
    </div>
  );
}

function UnavailableNotice({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-cooper-red/40 bg-cooper-red/5 p-3 text-xs text-fg">
      <div className="font-semibold text-cooper-red">Attachments unavailable</div>
      <p className="mt-1 text-fg-muted">{message}</p>
      <p className="mt-1 text-fg-muted">
        Once an admin grants the app SharePoint REST access and sets{" "}
        <code>VITE_SP_SITE_URL</code>, attachments will start working on every
        task and EIR.
      </p>
    </div>
  );
}
