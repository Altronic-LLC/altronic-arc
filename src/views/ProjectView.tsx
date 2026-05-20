import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { TaskRow } from "@/components/TaskRow";
import { LoadingTasks } from "@/components/LoadingTasks";

/**
 * Project detail / overview page.
 *
 * Lists all tasks where this project is either the parent project or one
 * of the related projects. Project chips on the task detail view link
 * here.
 */
export function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const lookupId = id ? parseInt(id, 10) : null;
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();

  if (tasksLoading || projectsLoading) {
    return <LoadingTasks noun="this project" />;
  }

  const project = projects.find((p) => p.lookupId === lookupId);

  if (!project) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12">
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-fg-muted">
          Project not found.
          <button
            onClick={() => navigate("/")}
            className="mt-2 block w-full text-sm text-accent underline"
          >
            ← Back to task list
          </button>
        </div>
      </div>
    );
  }

  const related = tasks.filter(
    (t) =>
      t.parentProject?.lookupId === project.lookupId ||
      t.relatedProjects.some((r) => r.lookupId === project.lookupId),
  );

  const parentTasks = related.filter((t) => t.parentProject?.lookupId === project.lookupId);
  const relatedTasks = related.filter(
    (t) =>
      t.parentProject?.lookupId !== project.lookupId &&
      t.relatedProjects.some((r) => r.lookupId === project.lookupId),
  );

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-6 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          <FolderOpen className="h-3.5 w-3.5" />
          Project
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold leading-tight text-fg">
          {project.title}
        </h1>
        <div className="mt-2 text-xs text-fg-muted">
          {related.length} task{related.length === 1 ? "" : "s"} linked to this project
        </div>
      </div>

      {related.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          No tasks are linked to this project yet.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {parentTasks.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Tasks with this as parent project ({parentTasks.length})
              </h2>
              <div className="flex flex-col gap-2">
                {parentTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={(taskId) => navigate(`/task/${taskId}`)} />
                ))}
              </div>
            </section>
          )}

          {relatedTasks.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Tasks with this as related project ({relatedTasks.length})
              </h2>
              <div className="flex flex-col gap-2">
                {relatedTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={(taskId) => navigate(`/task/${taskId}`)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <div className="mt-6">
        <Link
          to="/"
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          ← All tasks
        </Link>
      </div>
    </div>
  );
}
