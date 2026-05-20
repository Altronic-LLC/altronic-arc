import { useRef } from "react";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import {
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "@/hooks/useAttachments";
import { SharePointUnavailableError } from "@/api/sharepoint";
import type { AttachmentParent } from "@/api/attachments";

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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
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
          No attachments yet. Click "Add file" to attach one.
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
                      `Remove "${a.fileName}" from this ${parent === "eir" ? "EIR" : "task"}?`,
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
