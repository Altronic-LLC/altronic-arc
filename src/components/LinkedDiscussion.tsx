import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, MessagesSquare } from "lucide-react";
import type { Comment } from "@/types/task";
import { CommentThread } from "./CommentThread";

// =============================================================================
// The other record's EARLIER comments, shown read-only — BusinessIT#58.
//
// When a build request is linked to a task, comments made on either before
// the link stay where they were posted (Tim, 2026-11-02: "keep them where
// they are but display them in the other area"). Nothing is copied and
// nobody is emailed. From the link on, the live mirror copies new comments
// both ways, so `earlierLinkedComments` (lib/buildRequestTaskLink.ts) leaves
// out everything already in this thread and the panel holds only what came
// before.
//
// Collapsed by default: it is context, not the conversation on this page, and
// a long thread above the real one would push it off the screen.
// =============================================================================

export function LinkedDiscussion({
  recordLabel,
  to,
  comments,
  currentUserEmail,
  currentUserName,
}: {
  /** How the other record is named ("T12-0017-HUB V4", "BR_2026-0081"). */
  recordLabel: string;
  /** Router path of the other record — replies go there. */
  to: string;
  /** Already filtered by `earlierLinkedComments`. */
  comments: Comment[];
  currentUserEmail?: string;
  currentUserName?: string;
}) {
  const [open, setOpen] = useState(false);
  if (comments.length === 0) return null;

  return (
    <div className="mt-5 rounded-md border border-dashed border-border bg-surface-2/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted hover:text-fg"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <MessagesSquare className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">
          Earlier discussion on <span className="font-medium text-fg">{recordLabel}</span>
        </span>
        <span className="ml-auto shrink-0 text-xs">
          {comments.length} comment{comments.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="border-t border-dashed border-border px-3 pb-3 pt-2">
          <p className="mb-3 text-xs text-fg-muted">
            Posted on{" "}
            <Link to={to} className="text-accent underline-offset-2 hover:underline">
              {recordLabel}
            </Link>{" "}
            before the two were linked. They are shown here, not copied — reply on{" "}
            {recordLabel}.
          </p>
          {/* No onEdit and no onReply: read-only. */}
          <CommentThread
            comments={comments}
            currentUserEmail={currentUserEmail}
            currentUserName={currentUserName}
          />
        </div>
      )}
    </div>
  );
}
