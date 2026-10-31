import { useMemo } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { quoteOriginOfTask } from "@/lib/quoteToTask";
import type { Comment } from "@/types/task";

/**
 * "From quote: IQ-…" on a task created from a won Insourcing Quote — the jump
 * back to the quote (Ray, 2026-10-30). Read off the task's own thread (the
 * marker header ARC wrote at creation, lib/quoteToTask.ts), so it costs no
 * request. Opens the revision the task was created from; the quote page
 * shows every rev from there.
 */
export function FromQuoteLink({ comments }: { comments: readonly Comment[] }) {
  const origin = useMemo(() => quoteOriginOfTask(comments), [comments]);
  if (!origin) return null;
  return (
    <Link
      to={`/sales/quotes/${origin.quoteId}`}
      className="mb-3 mr-2 inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
      title="Open the quote this task was created from"
    >
      <FileText className="h-3 w-3" />
      <span>From quote:</span>{" "}
      <span className="font-medium text-fg">{origin.quoteNumber || origin.quoteBase}</span>
    </Link>
  );
}
