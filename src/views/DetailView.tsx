import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, CheckCircle2, Eye, Flag, FolderOpen, Tag, User } from "lucide-react";
import { useAddComment, useTask, useUpdateTaskFields } from "@/hooks/useTasks";
import { STATUSES, type Status } from "@/types/task";
import { CommentThread } from "@/components/CommentThread";
import { CommentComposer } from "@/components/CommentComposer";
import { LabelChip, StatusBadge } from "@/components/atoms";

export function DetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = id ? parseInt(id, 10) : null;
  const { data: task, isLoading } = useTask(taskId);
  const updateFields = useUpdateTaskFields();
  const addComment = useAddComment();

  if (isLoading) {
    return <div className="mx-auto max-w-[1400px] px-6 py-12 text-fg-muted">Loading task…</div>;
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-12">
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-fg-muted">
          Task not found.
          <button
            onClick={() => navigate("/")}
            className="mt-2 block text-sm text-accent underline"
          >
            ← Back to list
          </button>
        </div>
      </div>
    );
  }

  function handleStatusChange(next: Status) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Status: next } });
  }

  function handleMarkComplete() {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Status: "Complete" } });
  }

  async function handleAddComment(bodyHtml: string) {
    if (!task) return;
    await addComment.mutateAsync({
      id: task.id,
      comment: {
        // In real mode these would come from the authenticated MSAL account.
        // Mock mode uses a placeholder.
        authorName: "You",
        authorEmail: "you@coopermachineryservices.com",
        bodyHtml,
      },
    });
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Main column */}
        <div className="flex flex-1 flex-col gap-4">
          {/* Header card */}
          <div className="rounded-lg border border-border bg-surface p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={handleMarkComplete}
                disabled={task.status === "Complete"}
                className="inline-flex items-center gap-1.5 rounded-md bg-cooper-green px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-cooper-green/90 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {task.status === "Complete" ? "Completed" : "Mark Complete"}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              >
                Copy task link
              </button>
              <div className="ml-auto inline-flex items-center gap-1.5 text-sm text-fg-muted">
                <Eye className="h-4 w-4" />
                {task.watchers.length === 0
                  ? "No watchers"
                  : `${task.watchers.length} watcher${task.watchers.length === 1 ? "" : "s"}`}
              </div>
            </div>
            <h1 className="font-display text-2xl font-semibold leading-tight text-fg">
              {task.numberedTitle}
            </h1>
          </div>

          {/* Description card */}
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Description
            </h2>
            {task.description ? (
              <div
                className="comment-html"
                dangerouslySetInnerHTML={{ __html: task.description }}
              />
            ) : (
              <div className="text-sm text-fg-muted">No description.</div>
            )}
          </div>

          {/* Comments card */}
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer onSubmit={handleAddComment} />
            <div className="mt-5">
              <CommentThread comments={task.comments} />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-5">
            <div className="grid gap-5">
              <Field icon={<Calendar />} label="Created">
                {task.createdAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Field>

              <Field icon={<Calendar />} label="Due Date">
                {task.dueDate
                  ? task.dueDate.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Not set"}
              </Field>

              <Field icon={<Flag />} label="Priority">
                {task.priority ?? "Not set"}
              </Field>

              <Field icon={<User />} label="Assigned">
                {task.assigned.length === 0
                  ? "Unassigned"
                  : task.assigned.map((p) => p.displayName).join(", ")}
              </Field>

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Status
                </div>
                <select
                  value={task.status}
                  onChange={(e) => handleStatusChange(e.target.value as Status)}
                  className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5">
                  <StatusBadge status={task.status} />
                </div>
              </div>

              <Field icon={<FolderOpen />} label="Parent Project">
                {task.parentProject?.title ?? "—"}
              </Field>

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  <Tag className="h-3.5 w-3.5" />
                  Labels
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {task.labels.length === 0 ? (
                    <span className="text-sm text-fg-muted">None</span>
                  ) : (
                    task.labels.map((l) => <LabelChip key={l} label={l} />)
                  )}
                </div>
              </div>

              <Field icon={<Tag />} label="Category">
                {task.category ?? "—"}
              </Field>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {label}
      </div>
      <div className="text-sm text-fg">{children}</div>
    </div>
  );
}
