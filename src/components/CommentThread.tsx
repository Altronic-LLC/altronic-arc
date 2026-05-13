import type { Comment } from "@/types/task";

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
              // Note: This trusts the HTML stored in SharePoint. The values
              // come from authenticated users via the existing tooling, so
              // it's the same trust model as the Power Apps version. If you
              // ever expose this to lower-trust input, run it through a
              // sanitiser like DOMPurify before rendering.
              dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
            />
          ) : (
            <div className="text-xs italic text-fg-muted">(empty comment — file attachment only)</div>
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
