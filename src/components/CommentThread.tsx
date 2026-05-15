import { useState } from "react";
import { Paperclip, Pencil } from "lucide-react";
import type { Comment, CommentAttachment } from "@/types/task";
import { sanitiseHtml } from "@/lib/sanitiseHtml";

interface CommentThreadProps {
  comments: Comment[];
  currentUserEmail?: string;
  /** Save handler. If omitted, the Edit button is hidden entirely. */
  onEdit?: (comment: Comment, newBodyHtml: string) => Promise<void> | void;
}

export function CommentThread({ comments, currentUserEmail, onEdit }: CommentThreadProps) {
  if (comments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-fg-muted">
        No comments yet. Add the first one below.
      </div>
    );
  }

  const myEmail = (currentUserEmail ?? "").toLowerCase();

  return (
    <div className="divide-y divide-border">
      {comments.map((c, i) => {
        const isOwn =
          !!myEmail && (c.authorEmail ?? "").toLowerCase() === myEmail;
        return (
          <CommentItem
            key={`${c.timestamp.getTime()}-${i}`}
            comment={c}
            canEdit={isOwn && !!onEdit}
            onEdit={onEdit}
          />
        );
      })}
    </div>
  );
}

function CommentItem({
  comment,
  canEdit,
  onEdit,
}: {
  comment: Comment;
  canEdit: boolean;
  onEdit?: (comment: Comment, newBodyHtml: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing && onEdit) {
    return (
      <article className="py-4 first:pt-0 last:pb-0">
        <CommentEditor
          initialBodyHtml={comment.bodyHtml}
          onCancel={() => setEditing(false)}
          onSave={async (newBodyHtml) => {
            await onEdit(comment, newBodyHtml);
            setEditing(false);
          }}
        />
        {comment.attachments && comment.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {comment.attachments.map((a) => (
              <CommentAttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        )}
        <div className="mt-2 text-right text-xs text-fg-muted">
          {formatTimestamp(comment.timestamp)}{" "}
          by <span className="font-medium text-fg">{comment.authorName}</span>
        </div>
      </article>
    );
  }

  return (
    <article className="py-4 first:pt-0 last:pb-0">
      {comment.bodyHtml ? (
        <div
          className="comment-html"
          // bodyHtml is authored content from SharePoint users; sanitised
          // through DOMPurify to strip scripts and event handlers before
          // rendering. See src/lib/sanitiseHtml.ts.
          dangerouslySetInnerHTML={{ __html: sanitiseHtml(comment.bodyHtml) }}
        />
      ) : comment.attachments && comment.attachments.length > 0 ? (
        <div className="text-xs italic text-fg-muted">(attachment only — no text)</div>
      ) : (
        <div className="text-xs italic text-fg-muted">(empty comment)</div>
      )}

      {comment.attachments && comment.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {comment.attachments.map((a) => (
            <CommentAttachmentView key={a.id} attachment={a} />
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2 text-xs text-fg-muted">
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            title="Edit comment"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
        <span>
          {formatTimestamp(comment.timestamp)}{" "}
          by <span className="font-medium text-fg">{comment.authorName}</span>
        </span>
      </div>
    </article>
  );
}

function CommentEditor({
  initialBodyHtml,
  onSave,
  onCancel,
}: {
  initialBodyHtml: string;
  onSave: (newBodyHtml: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() => htmlToPlainText(initialBodyHtml));
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const html = trimmed
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
        .join("");
      await onSave(html);
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="rounded-md border border-accent/40 bg-surface-2 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={busy}
        rows={4}
        autoFocus
        className="w-full resize-y rounded-md bg-bg p-2.5 text-base text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent/30 sm:text-sm"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={busy || text.trim().length === 0}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function CommentAttachmentView({ attachment }: { attachment: CommentAttachment }) {
  const isImage = attachment.contentType.startsWith("image/");

  if (isImage && attachment.objectUrl) {
    return (
      <a
        href={attachment.objectUrl}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border border-border bg-surface-2 transition-shadow hover:shadow-md"
      >
        <img
          src={attachment.objectUrl}
          alt={attachment.filename}
          className="max-h-48 max-w-xs object-contain"
        />
        <div className="border-t border-border px-2 py-1 text-[11px] text-fg-muted">
          {attachment.filename}
        </div>
      </a>
    );
  }

  return (
    <a
      href={attachment.objectUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-surface"
    >
      <Paperclip className="h-3.5 w-3.5 text-fg-muted" />
      <span className="font-medium">{attachment.filename}</span>
      <span className="text-fg-muted">{formatBytes(attachment.sizeBytes)}</span>
    </a>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Convert the comment's bodyHtml back to plain text for editing.
 * Handles the shape our composer produces (<p>…</p> wrapping with <br/>
 * line breaks). Richer HTML from the Power Apps version loses formatting
 * on edit — acceptable because the user is editing their own comment.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
