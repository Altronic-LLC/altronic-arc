import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardCheck, FolderOpen } from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { useTestSheets } from "@/hooks/useTestSheets";
import { TaskRow } from "@/components/TaskRow";
import { EirRow } from "@/components/EirRow";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { TestSheet } from "@/types/task";

/**
 * Project detail / overview page.
 *
 * Lists everything tied back to this project reference: tasks (as parent
 * or related project), EIRs, and test sheets. Project chips/pickers
 * throughout the app (task detail, Dashboard) link here.
 */
export function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const lookupId = id ? parseInt(id, 10) : null;
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: eirs = [], isLoading: eirsLoading } = useEirs();
  const { data: testSheets = [], isLoading: testSheetsLoading } = useTestSheets();

  if (tasksLoading || projectsLoading || eirsLoading || testSheetsLoading) {
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

  const relatedEirs = eirs.filter((e) =>
    e.parentProjects.some((p) => p.lookupId === project.lookupId),
  );
  const relatedTestSheets = testSheets.filter(
    (s) => s.parentProject?.lookupId === project.lookupId,
  );

  const totalLinked = related.length + relatedEirs.length + relatedTestSheets.length;

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
          {related.length} task{related.length === 1 ? "" : "s"} · {relatedEirs.length} EIR
          {relatedEirs.length === 1 ? "" : "s"} · {relatedTestSheets.length} test sheet
          {relatedTestSheets.length === 1 ? "" : "s"} linked to this project
        </div>
      </div>

      {totalLinked === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          Nothing is linked to this project yet.
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

          {relatedEirs.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                EIRs ({relatedEirs.length})
              </h2>
              <div className="flex flex-col gap-2">
                {relatedEirs.map((e) => (
                  <EirRow key={e.id} eir={e} onOpen={(eirId) => navigate(`/eir/${eirId}`)} />
                ))}
              </div>
            </section>
          )}

          {relatedTestSheets.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Test Sheets ({relatedTestSheets.length})
              </h2>
              <div className="flex flex-col gap-2">
                {relatedTestSheets.map((s) => (
                  <TestSheetRow
                    key={s.id}
                    sheet={s}
                    onOpen={() => navigate(`/test-sheet/${s.id}`)}
                  />
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

/** Compact test-sheet row for the project rollup — same info as the Test Sheets list, minus the project column (redundant on this page). */
function TestSheetRow({ sheet, onOpen }: { sheet: TestSheet; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-all hover:border-fg-muted hover:shadow-md sm:p-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ClipboardCheck className="h-4 w-4 shrink-0 text-fg-muted" />
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-semibold text-fg">{sheet.title}</div>
          <div className="truncate text-xs text-fg-muted">
            {sheet.product || "—"}
            {sheet.parentTask?.numberedTitle ? ` · ${sheet.parentTask.numberedTitle}` : ""}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-fg-muted">
        <span>{sheet.tester?.displayName ?? "Unassigned"}</span>
        {sheet.testDate && (
          <span>
            {sheet.testDate.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        )}
      </div>
    </button>
  );
}
