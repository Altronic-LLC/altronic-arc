import { Paperclip } from "lucide-react";
import type { Comment, CommentAttachment } from "@/types/task";
import { sanitiseHtml } from "@/lib/sanitiseHtml";

interface CommentThreadProps {
  comments: Comment[];
}

export function CommentThread({ comments }: CommentThreadProps) {
  if (comments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-fg-muted">
        No comments yet. Add the first one below.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {comments.map((c, i) => (
        <article key={`${c.timestamp.getTime()}-${i}`} className="py-4 first:pt-0 last:pb-0">
          {c.bodyHtml ? (
            <div
              className="comment-html"
              // bodyHtml is authored content from SharePoint users; sanitised
              // through DOMPurify to strip scripts and event handlers before
              // rendering. See src/lib/sanitiseHtml.ts.
              dangerouslySetInnerHTML={{ __html: sanitiseHtml(c.bodyHtml) }}
            />
          ) : c.attachments && c.attachments.length > 0 ? (
            <div className="text-xs italic text-fg-muted">(attachment only — no text)</div>
          ) : (
            <div className="text-xs italic text-fg-muted">(empty comment)</div>
          )}

          {c.attachments && c.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {c.attachments.map((a) => (
                <CommentAttachmentView key={a.id} attachment={a} />
              ))}
            </div>
          )}

          <div className="mt-2 text-right text-xs text-fg-muted">
            {c.timestamp.toLocaleString(undefined, {
              month: "numeric",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            by <span className="font-medium text-fg">{c.authorName}</span>
          </div>
        </article>
      ))}
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
