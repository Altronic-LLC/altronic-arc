import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTask, useTasks } from "@/hooks/useTasks";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { Brandmark } from "@/components/brand/Brandmark";
import { Wordmark } from "@/components/brand/Wordmark";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { Comment } from "@/types/task";

/**
 * Printable task layout intended to be saved as PDF via the browser's
 * native print dialog. The page mounts, waits a beat for the data and
 * fonts to settle, then fires window.print(). The user picks "Save as
 * PDF" (or a real printer) from the OS dialog.
 *
 * Styled with explicit light colours rather than the theme tokens, so
 * the page looks the same in light and dark mode and prints cleanly
 * regardless of the user's app theme.
 */
export function PrintTaskView() {
  const { id } = useParams<{ id: string }>();
  const taskId = id ? parseInt(id, 10) : null;
  // useTasks() is what actually populates the cache; useTask reads from it.
  useTasks();
  const { data: task, isLoading } = useTask(taskId);

  useEffect(() => {
    if (!task) return;
    // Small delay so images and the condensed display font are loaded
    // before the print dialog snapshots the page.
    const t = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(t);
  }, [task]);

  if (isLoading || !task) {
    return <LoadingTasks noun="this task" />;
  }

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-black print:p-0">
      <header className="mb-5 border-b border-gray-300 pb-3">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-black">
            <Brandmark className="h-9 w-auto shrink-0" />
            <div className="flex flex-col leading-tight">
              <Wordmark className="h-3.5 w-auto" />
              <p className="mt-1 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                Engineering Task System
              </p>
            </div>
          </div>
          <div className="rounded-sm border border-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-700">
            Confidential
          </div>
        </div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Project Task
        </div>
        <h1 className="font-display text-2xl font-bold leading-tight text-black">
          {task.numberedTitle}
        </h1>
        <div className="mt-1.5 text-xs text-gray-600">
          <span className="font-semibold">Status:</span> {task.status}
        </div>
      </header>

      <section className="mb-5">
        <SectionHeading>Details</SectionHeading>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <DetailRow label="Priority">{task.priority ?? "—"}</DetailRow>
          <DetailRow label="Category">{task.category ?? "—"}</DetailRow>
          <DetailRow label="Due Date">
            {task.dueDate ? formatDate(task.dueDate, false) : "—"}
          </DetailRow>
          <DetailRow label="Created">{formatDate(task.createdAt)}</DetailRow>
          <DetailRow label="Created By">
            {task.author ? task.author.displayName : "Unknown"}
          </DetailRow>
          <DetailRow label="Modified">{formatDate(task.modifiedAt)}</DetailRow>
          <DetailRow label="Assigned">
            {task.assigned.length === 0
              ? "Unassigned"
              : task.assigned.map((p) => p.displayName).join(", ")}
          </DetailRow>
          <DetailRow label="Watchers">
            {task.watchers.length === 0
              ? "None"
              : task.watchers.map((p) => p.displayName).join(", ")}
          </DetailRow>
          <DetailRow label="Parent Project">
            {task.parentProject?.title || "—"}
          </DetailRow>
          <DetailRow label="Related Projects">
            {task.relatedProjects.length === 0
              ? "—"
              : task.relatedProjects.map((p) => p.title || `#${p.lookupId}`).join(", ")}
          </DetailRow>
          <DetailRow label="Labels">
            {task.labels.length === 0 ? "—" : task.labels.join(", ")}
          </DetailRow>
          <DetailRow label="Parent Task">
            {task.parentTask?.numberedTitle || "—"}
          </DetailRow>
          {task.softwareRevision && (
            <DetailRow label="Software Revision">{task.softwareRevision}</DetailRow>
          )}
        </div>
      </section>

      {task.description && (
        <section className="mb-5 break-inside-avoid">
          <SectionHeading>Description</SectionHeading>
          <div
            className="comment-html text-sm text-black"
            dangerouslySetInnerHTML={{ __html: sanitiseHtml(task.description) }}
          />
        </section>
      )}

      {task.childTasks.length > 0 && (
        <section className="mb-5 break-inside-avoid">
          <SectionHeading>Child Tasks ({task.childTasks.length})</SectionHeading>
          <ul className="ml-5 list-disc text-sm">
            {task.childTasks.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{c.numberedTitle}</span>
                <span className="text-gray-600"> — {c.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHeading>Comments ({task.comments.length})</SectionHeading>
        {task.comments.length === 0 ? (
          <div className="text-sm italic text-gray-500">No comments.</div>
        ) : (
          <div className="space-y-3">
            {task.comments.map((c, i) => (
              <CommentBlock key={`${c.timestamp.getTime()}-${i}`} comment={c} />
            ))}
          </div>
        )}
      </section>

      <footer className="mt-8 border-t border-gray-300 pt-2 text-[10px] text-gray-600">
        <div className="font-semibold uppercase tracking-wider text-gray-700">
          Confidential — Altronic internal use only. Not to be shared externally.
        </div>
        <div className="mt-0.5 text-gray-500">
          Printed {formatDate(new Date())}
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-gray-600">
      {children}
    </h2>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="text-sm text-black">{children}</div>
    </div>
  );
}

function CommentBlock({ comment }: { comment: Comment }) {
  return (
    <article className="break-inside-avoid border-l-2 border-gray-300 py-1 pl-3">
      <div className="mb-1 text-xs text-gray-600">
        <span className="font-semibold text-black">{comment.authorName}</span>
        <span className="text-gray-400"> · </span>
        {formatDate(comment.timestamp)}
      </div>
      {comment.bodyHtml ? (
        <div
          className="comment-html text-sm text-black"
          dangerouslySetInnerHTML={{ __html: sanitiseHtml(comment.bodyHtml) }}
        />
      ) : (
        <div className="text-xs italic text-gray-500">(no text)</div>
      )}
      {comment.attachments && comment.attachments.length > 0 && (
        <div className="mt-1 text-[11px] text-gray-600">
          <span className="font-semibold">Attachments:</span>{" "}
          {comment.attachments.map((a) => a.filename).join(", ")}
        </div>
      )}
    </article>
  );
}

function formatDate(d: Date, includeTime = true): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime
      ? { hour: "numeric", minute: "2-digit" }
      : {}),
  });
}
