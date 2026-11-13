import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import type { BuildRequest, Task } from "@/types/task";
import { useSetBuildRequestTask } from "@/hooks/useBuildRequests";
import { useCreateTask, useProjects } from "@/hooks/useTasks";
import {
  NEW_TASK_FOR_BUILD_REQUEST,
  taskForBuildRequest,
  taskLinkOptions,
} from "@/lib/buildRequestTaskLink";
import { taskLabel } from "@/lib/buildRequestFromTask";
import { SingleSelect } from "./SearchableSelect";
import { RichTextWarningDialog } from "./RichTextWarningDialog";

// =============================================================================
// A build request's Task Reference, on its detail page — BusinessIT#58.
//
//  - **Not linked:** says so, and offers the picker. Anyone signed in may
//    link; neither a task nor a build request is limited to a role in ARC.
//  - **Linked:** the task, plus Change. Moving a build request to another
//    task ASKS FIRST (Tim, 2026-11-02): it moves where new comments are
//    copied and which task's Complete waits on it.
//  - **Either way the picker offers "Create a task for this"**, the New Build
//    Request form's option: a task named after the request, in its first
//    project, assigned to its engineer — then linked. Task first, link
//    second, so a failed create links nothing.
// =============================================================================

/** What the picker chose: a task id, or a new task. */
type Target = number | "new";

export function BuildRequestTaskField({
  br,
  tasks,
  tasksLoading,
}: {
  br: BuildRequest;
  tasks: readonly Task[];
  tasksLoading: boolean;
}) {
  const setTask = useSetBuildRequestTask();
  const createTask = useCreateTask();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const [changing, setChanging] = useState(false);
  const [pending, setPending] = useState<Target | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const options = useMemo(
    () => [
      { value: NEW_TASK_FOR_BUILD_REQUEST, label: "+ Create a task for this" },
      ...taskLinkOptions(tasks, br.parentProjects.map((p) => p.lookupId)),
    ],
    [tasks, br.parentProjects],
  );
  const nameOf = (id: number) => {
    const t = tasks.find((x) => x.id === id);
    return t ? taskLabel(t) : `Task #${id}`;
  };

  // The task "Create a task for this" would make now, or why it can't. Only
  // a project IN the Projects list will do: the request's own copy can name
  // one that list doesn't hold (a deleted project, or — as the demo did —
  // one the picker can't show), and the page then reads "No projects" while
  // a task gets numbered from it. Found by Tim, 2026-11-02.
  const firstProjectId = br.parentProjects[0]?.lookupId;
  const draft = taskForBuildRequest({
    title: br.title,
    brNo: br.brNo,
    project: projects.find((p) => p.lookupId === firstProjectId) ?? null,
    engineer: br.engineerAssigned,
    allTasks: tasks,
  });
  const targetName = (t: Target) =>
    t === "new" ? ("problem" in draft ? "a new task" : `a new task, ${draft.numberedTitle}`) : nameOf(t);

  async function createAndLink() {
    if ("problem" in draft) {
      setProblem(draft.problem);
      return;
    }
    setCreating(true);
    try {
      const created = await createTask.mutateAsync(draft);
      setTask.mutate({ id: br.id, taskId: created.id });
    } catch {
      setProblem("Couldn't create the task — nothing was linked. Please retry.");
    } finally {
      setCreating(false);
    }
  }

  function apply(target: Target) {
    if (target === "new") void createAndLink();
    else setTask.mutate({ id: br.id, taskId: target });
  }

  const busy = tasksLoading || projectsLoading || setTask.isPending || creating;
  const picker = (ariaLabel: string, onPick: (t: Target) => void) => (
    <SingleSelect
      ariaLabel={ariaLabel}
      allLabel={tasksLoading ? "Loading tasks…" : creating ? "Creating the task…" : "Pick a task…"}
      searchPlaceholder="Search tasks…"
      options={options}
      selected={null}
      clearable={false}
      // Waits for the FULL task list: a new task's number counts its
      // project's tasks (TaskFormModal's numberingPending rule).
      disabled={busy}
      onChange={(v) => {
        setProblem(null);
        if (v === NEW_TASK_FOR_BUILD_REQUEST) {
          // Say why BEFORE any confirm — no dialog for a task that can't be made.
          if ("problem" in draft) {
            setProblem(draft.problem);
            return;
          }
          onPick("new");
          return;
        }
        const id = v ? parseInt(v, 10) : NaN;
        if (!Number.isNaN(id)) onPick(id);
      }}
    />
  );
  const problemLine = problem && (
    <p className="text-xs text-cooper-red" role="alert">
      {problem}
    </p>
  );

  const current = br.taskReferenceLookupId;

  if (current == null) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="flex items-start gap-1.5 text-xs text-ajax-yellow-fg">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Not linked to a task, so it doesn't show on any task's page.
        </p>
        {picker("Link to a task", apply)}
        {problemLine}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <Link
          to={`/task/${current}`}
          className="min-w-0 truncate text-sm text-accent underline-offset-2 hover:underline"
        >
          {nameOf(current)}
        </Link>
        {!changing && (
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="ml-auto shrink-0 text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Change
          </button>
        )}
      </div>
      {changing && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {picker("Move to another task", (target) => {
              if (target === current) {
                setChanging(false);
                return;
              }
              setPending(target);
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              setChanging(false);
              setProblem(null);
            }}
            className="shrink-0 text-xs text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
      )}
      {problemLine}
      {pending != null && (
        <RichTextWarningDialog
          title="Move this build request to another task?"
          detail={`It is linked to ${nameOf(current)}. It will be linked to ${targetName(pending)} instead.`}
          notifyNote={`Comments already copied to ${nameOf(current)} stay there. New comments will be copied to the new task, and that task can't be marked Complete until this build request is.`}
          trailing="Nobody is emailed about the move."
          confirmLabel="Move it"
          cancelLabel="Keep the current task"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            apply(pending);
            setPending(null);
            setChanging(false);
          }}
        />
      )}
    </div>
  );
}
