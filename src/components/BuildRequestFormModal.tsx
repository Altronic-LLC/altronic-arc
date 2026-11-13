import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { useBuildRequests, useCreateBuildRequest } from "@/hooks/useBuildRequests";
import { useCreateTask, useProjects, useTasks } from "@/hooks/useTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  BUILD_REQUEST_LEAD_TIMES,
  BUILD_REQUEST_SAMPLE_PHASES,
  BUILD_REQUEST_TYPES,
  type BuildRequestLeadTime,
  type BuildRequestSamplePhase,
  type BuildRequestType,
  type Person,
} from "@/types/task";
import { nextBuildRequestNo } from "@/lib/buildRequestNumber";
import { ChoiceSelect, MultiSelect, SingleSelect } from "./SearchableSelect";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { YesNoField } from "./YesNoField";
import {
  buildCarriedCommunication,
  buildRequestPrefillFromTask,
  taskLabel,
} from "@/lib/buildRequestFromTask";
import type { Task } from "@/types/task";
import {
  NEW_TASK_FOR_BUILD_REQUEST,
  taskForBuildRequest,
  taskLinkOptions,
} from "@/lib/buildRequestTaskLink";

interface BuildRequestFormModalProps {
  onClose: () => void;
  /**
   * Raise this Build Request FROM a task ("Create Build Request" on the task
   * detail page). Prefills the title and project, LOCKS the task reference,
   * and carries the task's discussion into the new request's comments.
   *
   * Named `fromTask` to match `TestSheetFormModal`'s prop of the same shape —
   * both mean "this record is being raised from that task" — but the two are
   * independent props on independent forms, not one shared contract.
   */
  fromTask?: Task;
}

/**
 * Create modal for Build Request headers. Parts are added afterwards from
 * the detail page ("Add Part"), matching how the old Power Apps dashboard
 * worked (header first, then parts). BR No is computed client-side from the
 * loaded list (nextBuildRequestNo) — same convention as EIR numbers.
 */
export function BuildRequestFormModal({ onClose, fromTask }: BuildRequestFormModalProps) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: allBrs = [] } = useBuildRequests();
  const { data: projects = [] } = useProjects();
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const createBr = useCreateBuildRequest();
  const createTask = useCreateTask();
  const directory = useDirectoryPeople();

  // Seeded ONCE from the task, deliberately not a controlled mirror of it:
  // the tasks list refetches on its own cadence, and re-seeding would wipe
  // whatever the user has since typed over the prefill.
  const prefill = fromTask ? buildRequestPrefillFromTask(fromTask) : null;

  const [title, setTitle] = useState(prefill?.title ?? "");
  const [brType, setBrType] = useState<BuildRequestType | "">("");
  const [leadTime, setLeadTime] = useState<BuildRequestLeadTime | "">("STD Lead Time");
  const [shipDate, setShipDate] = useState("");
  const [samplePhase, setSamplePhase] = useState<BuildRequestSamplePhase | "">("");
  const [engineerKey, setEngineerKey] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPO, setCustomerPO] = useState("");
  const [leadFree, setLeadFree] = useState(false);
  const [projectIds, setProjectIds] = useState<number[]>(
    prefill?.parentProjectLookupIds ?? [],
  );
  // The task a NEW build request is linked to (BusinessIT#58) — a task id,
  // NEW_TASK_FOR_BUILD_REQUEST, or null while nothing is picked. Required:
  // a build request with no task shows on no task's page. Not used when the
  // form is opened FROM a task, which decides it already.
  const [taskKey, setTaskKey] = useState<string | null>(null);
  // A task "Create a task for this" already made, kept so a retry after a
  // failed build request create links to it rather than making a second.
  const [createdTask, setCreatedTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  // People directory for the Engineer picker — everyone assigned/watching
  // across Engineering tasks (same pool the task pickers use).
  const allPeople: Person[] = (() => {
    const seen = new Map<string, Person>();
    for (const t of tasks) {
      for (const p of [...t.assigned, ...t.watchers]) {
        const key = (p.email ?? p.displayName).toLowerCase();
        if (!seen.has(key)) seen.set(key, p);
      }
    }
    if (currentUser.email && !seen.has(currentUser.email.toLowerCase())) {
      seen.set(currentUser.email.toLowerCase(), currentUser);
    }
    return mergePeople([...seen.values()], directory);
  })();

  // What "Create a task for this" would make right now, or why it can't —
  // shown under the picker so the reason is on screen before Create.
  const newTaskPreview =
    !fromTask && taskKey === NEW_TASK_FOR_BUILD_REQUEST && !createdTask
      ? taskForBuildRequest({
          title,
          brNo: nextBuildRequestNo(allBrs),
          project: projects.find((p) => p.lookupId === projectIds[0]) ?? null,
          engineer: null,
          allTasks: tasks,
        })
      : null;
  // The task's number counts its project's tasks, so it waits for the FULL
  // list — TaskFormModal's numberingPending rule.
  const taskNumberingPending =
    !fromTask && taskKey === NEW_TASK_FOR_BUILD_REQUEST && !createdTask && tasksLoading;
  const taskMissing = !fromTask && taskKey == null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Product or project name is required.");
      return;
    }
    const engineer = engineerKey
      ? allPeople.find((p) => (p.email ?? p.displayName) === engineerKey) ?? null
      : null;
    const brNo = nextBuildRequestNo(allBrs);

    let taskId: number | null = fromTask ? fromTask.id : null;
    const wantsNewTask = !fromTask && taskKey === NEW_TASK_FOR_BUILD_REQUEST;
    if (!fromTask) {
      if (taskKey == null) {
        setError("Pick the task this build request is for, or create one.");
        return;
      }
      if (!wantsNewTask) taskId = parseInt(taskKey, 10);
    }

    // A local copy, not the state: a task made below must be used by the
    // build request create in this same call, before state has updated.
    let madeTask = wantsNewTask ? createdTask : null;
    if (wantsNewTask && !madeTask) {
      const draft = taskForBuildRequest({
        title: trimmedTitle,
        brNo,
        project: projects.find((p) => p.lookupId === projectIds[0]) ?? null,
        engineer,
        allTasks: tasks,
      });
      if ("problem" in draft) {
        setError(draft.problem);
        return;
      }
      setError(null);
      setBusy(true);
      try {
        madeTask = await createTask.mutateAsync(draft);
        setCreatedTask(madeTask);
      } catch {
        setError("Couldn't create the task — nothing was saved. Please retry.");
        setBusy(false);
        return;
      }
    }
    if (madeTask) taskId = madeTask.id;
    setError(null);
    setBusy(true);

    try {
      const created = await createBr.mutateAsync({
        title: trimmedTitle,
        brNo,
        brType: brType || null,
        requiredLeadTime: leadTime || null,
        quotedShipDate: leadTime === "Ship Date" && shipDate ? new Date(shipDate) : null,
        samplePhase: brType === "Sample (A-D)" && samplePhase ? samplePhase : null,
        requestor: currentUser,
        engineerAssigned: engineer,
        customerName: customerName.trim() || undefined,
        customerPO: customerPO.trim() || undefined,
        leadFree,
        parentProjectLookupIds: projectIds,
        watchers: [currentUser],
        // The ONE stored half of the task↔BR link. The task side is derived
        // from this — see lib/buildRequestFromTask.ts.
        taskReferenceLookupId: taskId,
        communication: fromTask
          ? buildCarriedCommunication({
              task: fromTask,
              raisedBy: currentUser,
              now: new Date(),
            })
          : undefined,
      });
      onClose();
      navigate(`/build-request/${created.id}`);
    } catch {
      setError(
        madeTask
          ? `Couldn't create the build request — please retry. Task ${taskLabel(madeTask)} was created, and the retry will use it.`
          : "Couldn't create the build request — please retry.",
      );
      setBusy(false);
    }
  }

  // Dismiss on a genuine backdrop click only — never when a text-selection
  // drag merely happens to end out here (see useOverlayDismiss).
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" />
            {fromTask ? `New Build Request from ${taskLabel(fromTask)}` : "New Build Request"}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FieldLabel label="Product or Project Name *">
            <input
              ref={titleInputRef}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. HUB V4"
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Type">
              <ChoiceSelect
                value={brType}
                onChange={(v) => setBrType(v as BuildRequestType | "")}
                options={BUILD_REQUEST_TYPES}
                emptyLabel="Not set"
                searchPlaceholder="Search types…"
                disabled={busy}
              />
            </FieldLabel>

            <FieldLabel label="Required Lead Time">
              <ChoiceSelect
                value={leadTime}
                onChange={(v) => setLeadTime(v as BuildRequestLeadTime | "")}
                options={BUILD_REQUEST_LEAD_TIMES}
                emptyLabel="Not set"
                searchPlaceholder="Search lead times…"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          {leadTime === "Ship Date" && (
            <FieldLabel label="Quoted Ship Date">
              <DateField
                value={shipDate}
                onChange={setShipDate}
                disabled={busy}
                aria-label="Quoted Ship Date"
              />
            </FieldLabel>
          )}

          {brType === "Sample (A-D)" && (
            <FieldLabel label="Sample Phase">
              <ChoiceSelect
                value={samplePhase}
                onChange={(v) => setSamplePhase(v as BuildRequestSamplePhase | "")}
                options={BUILD_REQUEST_SAMPLE_PHASES}
                emptyLabel="Not set"
                searchPlaceholder="Search phases…"
                disabled={busy}
              />
            </FieldLabel>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Engineer Assigned">
              <SingleSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={engineerKey}
                onChange={setEngineerKey}
              />
            </FieldLabel>

            <FieldLabel label="Project Reference">
              <MultiSelect
                allLabel="No projects"
                searchPlaceholder="Search projects…"
                options={projects.map((p) => ({ value: String(p.lookupId), label: p.title }))}
                selected={projectIds.map(String)}
                onChange={(next) =>
                  setProjectIds(next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)))
                }
              />
            </FieldLabel>
          </div>

          {!fromTask && (
            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Task *
              </span>
              <SingleSelect
                ariaLabel="Task"
                allLabel={tasksLoading ? "Loading tasks…" : "Pick a task, or create one…"}
                searchPlaceholder="Search tasks…"
                options={[
                  { value: NEW_TASK_FOR_BUILD_REQUEST, label: "+ Create a task for this" },
                  ...taskLinkOptions(tasks, projectIds),
                ]}
                selected={taskKey}
                onChange={setTaskKey}
                disabled={busy}
              />
              <p className="mt-1 text-xs text-fg-muted" data-testid="br-task-hint">
                {createdTask && taskKey === NEW_TASK_FOR_BUILD_REQUEST
                  ? `Task ${taskLabel(createdTask)} has been created and will be linked.`
                  : taskNumberingPending
                    ? "Waiting for the task list, to number the new task…"
                    : newTaskPreview && "problem" in newTaskPreview
                      ? newTaskPreview.problem
                      : newTaskPreview
                        ? `Creates task ${newTaskPreview.numberedTitle}${
                            engineerKey ? ", assigned to the engineer above" : ""
                          }.`
                        : "People working from the task see this build request, and comments are copied between the two. Tasks in this build request's project are listed first."}
              </p>
            </div>
          )}

          {fromTask && (
            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Task Reference
              </span>
              {/*
                Read-only, never a picker. The whole point of arriving here
                from a task is that the task is already decided — offering to
                change it invites a Build Request pointing at a task whose
                discussion it just carried over.
              */}
              <div className="flex h-[38px] items-center rounded-md border border-dashed border-border bg-surface-2 px-3 text-sm text-fg">
                <span className="truncate">{taskLabel(fromTask)}</span>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {fromTask.comments.length > 0
                  ? `This task's ${fromTask.comments.length} comment${
                      fromTask.comments.length === 1 ? "" : "s"
                    } will be copied into the new build request.`
                  : "The two will be linked to each other."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Customer Name">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Customer PO">
              <input
                type="text"
                value={customerPO}
                onChange={(e) => setCustomerPO(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">
              Lead Free (RoHS)
            </span>
            <YesNoField
              label="Lead Free (RoHS)"
              value={leadFree ? "Yes" : ""}
              onChange={(next) => setLeadFree(next === "Yes")}
              disabled={busy}
              name="new-build-request-rohs"
            />
          </div>

          {error && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-fg-muted">
              Will be numbered <span className="font-mono font-semibold">{nextBuildRequestNo(allBrs)}</span>
              . Add parts from the detail page after creating.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  busy ||
                  !title.trim() ||
                  taskMissing ||
                  taskNumberingPending ||
                  (newTaskPreview != null && "problem" in newTaskPreview)
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
