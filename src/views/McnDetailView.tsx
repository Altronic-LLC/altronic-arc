import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bell, BellOff, Factory, Lock, Pencil } from "lucide-react";
import {
  collectMcnPeople,
  useAddMcnComment,
  useEditMcnComment,
  useMcn,
  useMcnTransition,
  useMcns,
  useSetMcnOperationsTask,
  useSetMcnPerson,
  useSetMcnWatchers,
  useUpdateMcnFields,
} from "@/hooks/useMcns";
import { useMyMcnAccess } from "@/hooks/useMcnRoles";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useMaintenanceDepartments } from "@/hooks/useMaintenanceReferenceLists";
import { useOperationsTasks } from "@/hooks/useOperationsTasks";
import { useCommentFileUpload } from "@/hooks/useAttachments";
import type { Comment, Person } from "@/types/task";
import { MCN_PRIORITIES, MCN_PRIORITY_MEANINGS, type Mcn, type McnPatch, type McnPriority } from "@/types/mcn";
import { mcnItemsIn, type McnItemGroup } from "@/lib/mcnFields";
import { mcnLabel, scopeDepartmentLabel } from "@/lib/mcnMapper";
import { raiseMcnGate } from "@/lib/mcnRoles";
import {
  MCN_ACTION_LABELS,
  mcnActionGate,
  mcnActionsFor,
  mcnEditGate,
  type McnAction,
  type McnSection,
} from "@/lib/mcnWorkflow";
import { mergePeople, personKey } from "@/lib/people";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { formatSpDate, fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { FieldEditModal } from "@/components/FieldEditModal";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";
import { SingleSelect } from "@/components/SearchableSelect";
import { CardTitle, McnAccessGate, McnPriorityChip, McnStatusChip } from "@/components/mcnAtoms";
import { McnPersonPicker } from "@/components/McnFields";
import {
  McnApproveDialog,
  McnDescriptionDialog,
  McnDistributionDialog,
  McnImplementDialog,
  McnItemsDialog,
  McnReasonDialog,
  McnScopeDialog,
} from "@/components/McnDialogs";
import { cn } from "@/lib/cn";

// =============================================================================
// One MCN, laid out in MFGFRM-021's order (BusinessIT#38).
//
// Main column: Details, Description, Scope, Requires…, Incorporate into,
// Implementation, Attachments, Discussion — each card with ONE Edit button.
// Side panel: the workflow button for the current step, the people, the
// distribution (ticked and actually sent), the Operations task, watchers.
//
// LOCKS: every card's Edit asks `mcnEditGate` — content in Draft only, the
// implementation card once approved — and the hook asks the same gate again
// against a fresh read before writing. A locked card SAYS why, rather than
// hiding its button.
// =============================================================================

export function McnDetailView() {
  return (
    <McnAccessGate>
      <McnDetail />
    </McnAccessGate>
  );
}

type Dialog =
  | { kind: "details" }
  | { kind: "description" }
  | { kind: "scope" }
  | { kind: "items"; group: McnItemGroup }
  | { kind: "distribution" }
  | { kind: "implementation" }
  | { kind: "approve" }
  | { kind: "reject" }
  | { kind: "reopen" }
  | { kind: "implement" };

function McnDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mcnId = id ? parseInt(id, 10) : null;
  const uploadCommentFile = useCommentFileUpload("mcn", mcnId);
  const { data: mcn, isLoading } = useMcn(mcnId);
  const { data: mcns = [] } = useMcns();
  const access = useMyMcnAccess();
  const me = useCurrentUser();
  const directory = useDirectoryPeople();
  const { data: departments = [] } = useMaintenanceDepartments();
  const { data: opsTasks = [] } = useOperationsTasks();

  const update = useUpdateMcnFields();
  const setPerson = useSetMcnPerson();
  const setWatchers = useSetMcnWatchers();
  const setTask = useSetMcnOperationsTask();
  const transition = useMcnTransition();
  const addComment = useAddMcnComment();
  const editComment = useEditMcnComment();

  const [dialog, setDialog] = useState<Dialog | null>(null);

  const people = useMemo(() => mergePeople(collectMcnPeople(mcns), directory, [me]), [mcns, directory, me]);
  const departmentNames = useMemo(() => new Map(departments.map((d) => [d.lookupId, d.title])), [departments]);

  if (isLoading) return <LoadingTasks noun="the MCN" />;
  if (!mcn) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That MCN doesn't exist.</p>
        <button onClick={() => navigate("/operations/mcns")} className="mt-3 text-sm text-accent hover:underline">
          Back to MCNs
        </button>
      </div>
    );
  }
  const current: Mcn = mcn;

  function edit(section: McnSection, patch: McnPatch) {
    update.mutate({ id: current.id, section, patch });
  }
  function act(action: McnAction, extra: Omit<Parameters<typeof transition.mutate>[0], "id" | "action"> = {}) {
    transition.mutate({ id: current.id, action, ...extra }, { onSuccess: () => setDialog(null) });
  }
  function handleAddComment(bodyHtml: string) {
    return addComment
      .mutateAsync({ id: current.id, comment: { authorName: me.displayName, authorEmail: me.email ?? "", bodyHtml } })
      .then(() => undefined);
  }
  async function handleEditComment(comment: Comment, bodyHtml: string) {
    await editComment.mutateAsync({
      id: current.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  const gate = (section: McnSection) => mcnEditGate(section, current, access);
  const watching = current.watchers.some((w) => personKey(w) === personKey(me));
  const detailsGate = gate("details");
  const canRaise = raiseMcnGate(access).allowed;
  const lockHint = current.status !== "Draft" ? gate("description").hint : "";

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="MCNs" listTo="/operations/mcns" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <Factory className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">{mcnLabel(current)}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <McnStatusChip status={current.status} />
            <McnPriorityChip priority={current.priority} />
            {current.legacyNote && <span className="text-xs text-fg-muted">{current.legacyNote}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            setWatchers.mutate({
              id: current.id,
              people: watching ? current.watchers.filter((w) => personKey(w) !== personKey(me)) : [...current.watchers, me],
            })
          }
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            watching ? "border-accent/40 bg-accent/10 text-fg hover:bg-accent/20" : "border-border bg-surface text-fg hover:bg-surface-2",
          )}
        >
          {watching ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {watching ? "Unwatch" : "Watch"}
        </button>
      </div>

      {lockHint && canRaise && (
        <p className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
          {lockHint}
        </p>
      )}
      {current.status === "Rejected" && current.rejectionReason && (
        <p className="rounded-md border border-cooper-red/40 bg-cooper-red/5 px-3 py-2 text-sm text-fg">
          <span className="font-semibold">Rejected:</span> {current.rejectionReason}
        </p>
      )}

      {/* Three blocks, placed by the grid: on a wide screen the workflow sits
          at the top of the side panel; on a phone it comes FIRST, above the
          cards, rather than under the whole discussion. One copy either way. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <section
          aria-label="Workflow"
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 lg:col-start-2 lg:row-start-1"
        >
          <h3 className="font-display text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Workflow</h3>
          <WorkflowButtons
            mcn={current}
            access={access}
            busy={transition.isPending}
            onAction={(action) => {
              if (action === "submit") act("submit");
              else setDialog({ kind: action });
            }}
          />
        </section>

        <div className="flex flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Card title="Details" gate={detailsGate} onEdit={() => setDialog({ kind: "details" })}>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Value label="Process">{current.process}</Value>
              <Value label="Date">{current.date ? formatSpDate(current.date) : ""}</Value>
              <Value label="Priority">
                {current.priority
                  ? `${current.priority} — ${MCN_PRIORITY_MEANINGS[current.priority as McnPriority] ?? ""}`
                  : ""}
              </Value>
            </dl>
          </Card>

          <Card title="Description and reason" gate={gate("description")} onEdit={() => setDialog({ kind: "description" })}>
            {current.description.replace(/<[^>]*>|&nbsp;|\s/g, "") ? (
              <div className="prose-sm comment-html text-sm text-fg" dangerouslySetInnerHTML={{ __html: sanitiseHtml(current.description) }} />
            ) : (
              <p className="text-sm text-fg-muted">Not set</p>
            )}
          </Card>

          <Card title="Departments, processes and equipment" gate={gate("scope")} onEdit={() => setDialog({ kind: "scope" })}>
            {current.scopeCorrupt ? (
              <p className="text-sm text-cooper-red">
                The stored scope couldn't be read, so it isn't shown and can't be edited here. Ask an admin to check the
                Scope column in SharePoint.
              </p>
            ) : current.scope.length === 0 ? (
              <p className="text-sm text-fg-muted">Not set</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
                    <tr>
                      <th className="py-1 pr-3">Department</th>
                      <th className="py-1 pr-3">Process</th>
                      <th className="py-1">Applicable equipment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.scope.map((line, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1.5 pr-3 text-fg">{scopeDepartmentLabel(line, departmentNames) || "—"}</td>
                        <td className="py-1.5 pr-3 text-fg">{line.process || "—"}</td>
                        <td className="py-1.5 text-fg">{line.equipment || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {(["requires", "incorporate"] as const).map((group) => (
            <Card
              key={group}
              title={group === "requires" ? "Requires…" : "Incorporate into"}
              gate={gate(group)}
              onEdit={() => setDialog({ kind: "items", group })}
            >
              <ul className="flex flex-col divide-y divide-border">
                {mcnItemsIn(group).map((f) => {
                  const item = current.items[f.key];
                  return (
                    <li key={f.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 text-fg">{f.label}</span>
                      <span
                        className={cn(
                          "w-16 text-right font-medium",
                          item?.answer === "Yes" ? "text-fg" : "text-fg-muted",
                        )}
                      >
                        {item?.answer || "—"}
                      </span>
                      {item?.reference && <span className="basis-full text-xs text-fg-muted sm:pl-0">{item.reference}</span>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}

          <Card title="Implementation" gate={gate("implementation")} onEdit={() => setDialog({ kind: "implementation" })}>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Value label="Date implemented">{current.dateImplemented ? formatSpDate(current.dateImplemented) : ""}</Value>
              <Value label="Date codes / serial numbers affected">{current.affected}</Value>
            </dl>
          </Card>

          <AttachmentsSection parent="mcn" itemId={current.id} readOnly={!canRaise} />

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3">
              <CardTitle>Discussion</CardTitle>
            </div>
            <CommentComposer
              draftKey={`mcn:${current.id}`}
              uploadFile={uploadCommentFile}
              onSubmit={handleAddComment}
              mentionablePeople={people}
            />
            <div className="mt-5">
              <CommentThread
                uploadFile={uploadCommentFile}
                comments={current.comments}
                currentUserEmail={me.email}
                currentUserName={me.displayName}
                mentionablePeople={people}
                onEdit={handleEditComment}
                onReply={handleAddComment}
                draftKey={`mcn:${current.id}`}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4 self-start rounded-xl border border-border bg-surface p-4 lg:col-start-2 lg:row-start-2">
          <SidebarGroup title="People">
            <SidebarField label="Originated by">
              {detailsGate.allowed ? (
                <McnPersonPicker
                  value={current.originatedBy}
                  people={people}
                  ariaLabel="Originated by"
                  onChange={(p) => setPerson.mutate({ id: current.id, column: "originatedBy", person: p })}
                />
              ) : (
                <PersonText person={current.originatedBy} />
              )}
            </SidebarField>
            <SidebarField label="Assigned engineer">
              {detailsGate.allowed ? (
                <McnPersonPicker
                  value={current.assignedEngineer}
                  people={people}
                  ariaLabel="Assigned engineer"
                  onChange={(p) => setPerson.mutate({ id: current.id, column: "assignedEngineer", person: p })}
                />
              ) : (
                <PersonText person={current.assignedEngineer} />
              )}
            </SidebarField>
            <SidebarField label="Approved by">
              {current.approvedBy ? (
                <p className="px-1 text-sm text-fg">
                  {current.approvedBy.displayName}
                  {current.approvedAt && <span className="text-fg-muted"> · {current.approvedAt.toLocaleDateString()}</span>}
                </p>
              ) : (
                <p className="px-1 text-sm text-fg-muted">Not yet approved</p>
              )}
            </SidebarField>
            <SidebarField label="Watchers">
              <PersonMultiField
                value={current.watchers}
                allPeople={people}
                onToggle={(p) =>
                  setWatchers.mutate({
                    id: current.id,
                    people: current.watchers.some((w) => personKey(w) === personKey(p))
                      ? current.watchers.filter((w) => personKey(w) !== personKey(p))
                      : [...current.watchers, p],
                  })
                }
                emptyLabel="No watchers"
                searchPlaceholder="Add a watcher…"
              />
            </SidebarField>
          </SidebarGroup>

          <SidebarGroup title="Distribution">
            <SidebarField label="Ticked on the form">
              <div className="flex items-start justify-between gap-2">
                <p className="px-1 text-sm text-fg">{current.distribution.length ? current.distribution.join(", ") : <span className="text-fg-muted">None</span>}</p>
                {gate("distribution").allowed && (
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: "distribution" })}
                    aria-label="Edit distribution"
                    className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </SidebarField>
            {current.distributedTo.length > 0 && (
              <SidebarField label={`Sent to (${current.distributedTo.length})`}>
                <ul className="px-1 text-sm text-fg">
                  {current.distributedTo.map((p) => (
                    <li key={personKey(p)} className="truncate" title={p.email}>
                      {p.displayName}
                    </li>
                  ))}
                </ul>
                {current.distributedAt && (
                  <p className="px-1 text-[11px] text-fg-muted">on {current.distributedAt.toLocaleString()}</p>
                )}
              </SidebarField>
            )}
          </SidebarGroup>

          <SidebarGroup title="Links">
            <SidebarField label="Operations task">
              {canRaise ? (
                <SingleSelect
                  options={opsTasks.map((t) => ({ value: String(t.id), label: `${t.taskNumber} — ${t.title}` }))}
                  selected={current.operationsTask ? String(current.operationsTask.lookupId) : null}
                  onChange={(v) => {
                    const t = v ? opsTasks.find((x) => x.id === Number(v)) : null;
                    setTask.mutate({ id: current.id, task: t ? { lookupId: t.id, title: t.title } : null });
                  }}
                  allLabel="None"
                  ariaLabel="Operations task"
                  searchPlaceholder="Search Operations tasks…"
                />
              ) : null}
              {current.operationsTask ? (
                <Link to={`/operations/task/${current.operationsTask.lookupId}`} className="mt-1 block px-1 text-xs text-accent hover:underline">
                  Open {opsTasks.find((t) => t.id === current.operationsTask!.lookupId)?.taskNumber ?? `task #${current.operationsTask.lookupId}`}
                </Link>
              ) : (
                !canRaise && <p className="px-1 text-sm text-fg-muted">None</p>
              )}
            </SidebarField>
            <SidebarField label="Raised by">
              <p className="px-1 text-sm text-fg">
                {current.createdBy?.displayName ?? <span className="text-fg-muted">Unknown</span>}
                <span className="text-fg-muted"> · {formatSpDate(current.createdAt)}</span>
              </p>
            </SidebarField>
          </SidebarGroup>
        </aside>
      </div>

      {dialog?.kind === "details" && (
        <FieldEditModal
          title="Edit details"
          fields={[
            { key: "process", label: "Process", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
            { key: "priority", label: "Priority", kind: "choice", choices: MCN_PRIORITIES, hint: "Level 1 immediate · 2 by next build · 3 at convenience" },
          ]}
          values={{ process: current.process, date: toDateInputValue(current.date), priority: current.priority }}
          onClose={() => setDialog(null)}
          onSave={(changed) => {
            const patch: McnPatch = {};
            if ("process" in changed) patch.process = changed.process;
            if ("date" in changed) patch.date = fromDateInputValue(changed.date);
            if ("priority" in changed) patch.priority = changed.priority;
            edit("details", patch);
          }}
        />
      )}
      {dialog?.kind === "description" && (
        <McnDescriptionDialog mcn={current} onClose={() => setDialog(null)} onSave={(html) => edit("description", { description: html })} />
      )}
      {dialog?.kind === "scope" && (
        <McnScopeDialog mcn={current} onClose={() => setDialog(null)} onSave={(scope) => edit("scope", { scope })} />
      )}
      {dialog?.kind === "items" && (
        <McnItemsDialog
          mcn={current}
          group={dialog.group}
          onClose={() => setDialog(null)}
          onSave={(items) => edit(dialog.group, { items })}
        />
      )}
      {dialog?.kind === "distribution" && (
        <McnDistributionDialog mcn={current} onClose={() => setDialog(null)} onSave={(distribution) => edit("distribution", { distribution })} />
      )}
      {dialog?.kind === "implementation" && (
        <FieldEditModal
          title="Edit implementation"
          fields={[
            { key: "dateImplemented", label: "Date implemented", kind: "date" },
            { key: "affected", label: "Date codes / serial numbers affected", kind: "multiline" },
          ]}
          values={{ dateImplemented: toDateInputValue(current.dateImplemented), affected: current.affected }}
          onClose={() => setDialog(null)}
          onSave={(changed) => {
            const patch: McnPatch = {};
            if ("dateImplemented" in changed) patch.dateImplemented = fromDateInputValue(changed.dateImplemented);
            if ("affected" in changed) patch.affected = changed.affected;
            edit("implementation", patch);
          }}
        />
      )}
      {dialog?.kind === "approve" && (
        <McnApproveDialog
          mcn={current}
          people={people}
          me={me}
          busy={transition.isPending}
          onClose={() => setDialog(null)}
          onApprove={(recipients) => act("approve", { distributedTo: recipients })}
        />
      )}
      {(dialog?.kind === "reject" || dialog?.kind === "reopen") && (
        <McnReasonDialog
          mcn={current}
          action={dialog.kind}
          busy={transition.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => act(dialog.kind as "reject" | "reopen", { reason })}
        />
      )}
      {dialog?.kind === "implement" && (
        <McnImplementDialog
          mcn={current}
          busy={transition.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(args) => act("implement", args)}
        />
      )}
    </div>
  );
}

/**
 * The button(s) for the current step. A button the user may not press yet is
 * `aria-disabled` with its reason printed beneath — never `disabled`, which
 * would hide both the tooltip and the button from a keyboard (the EIR pills
 * lesson). A step nobody here can take shows nothing but the reason.
 */
function WorkflowButtons({
  mcn,
  access,
  busy,
  onAction,
}: {
  mcn: Mcn;
  access: ReturnType<typeof useMyMcnAccess>;
  busy: boolean;
  onAction: (action: McnAction) => void;
}) {
  const actions = mcnActionsFor(mcn.status);
  if (actions.length === 0) {
    return <p className="text-sm text-fg-muted">Implemented — the workflow is complete.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {actions.map((action) => {
        const gate = mcnActionGate(action, mcn, access);
        const primary = action === "submit" || action === "approve" || action === "implement";
        return (
          <div key={action}>
            <button
              type="button"
              aria-disabled={!gate.allowed || busy}
              title={gate.allowed ? undefined : gate.hint}
              onClick={() => {
                if (gate.allowed && !busy) onAction(action);
              }}
              className={cn(
                "w-full rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                primary
                  ? "bg-accent text-white shadow-xs hover:bg-accent/90"
                  : "border border-border bg-surface text-fg hover:bg-surface-2",
                (!gate.allowed || busy) && "cursor-not-allowed opacity-50",
              )}
            >
              {MCN_ACTION_LABELS[action]}
            </button>
            {!gate.allowed && <p className="mt-1 text-[11px] text-fg-muted">{gate.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Card({
  title,
  gate,
  onEdit,
  children,
}: {
  title: string;
  gate: { allowed: boolean; hint: string };
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {gate.allowed ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${title}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        ) : (
          <span title={gate.hint} aria-label={`${title} is locked. ${gate.hint}`} className="text-fg-muted">
            <Lock className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Value({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === "" || children === null || children === undefined;
  return (
    <div>
      <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className={cn("whitespace-pre-wrap text-sm", empty ? "text-fg-muted" : "text-fg")}>{empty ? "Not set" : children}</dd>
    </div>
  );
}

function PersonText({ person }: { person: Person | null }) {
  return person ? <p className="px-1 text-sm text-fg">{person.displayName}</p> : <p className="px-1 text-sm text-fg-muted">Not set</p>;
}

function SidebarGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
      {children}
    </div>
  );
}

function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      {children}
    </div>
  );
}
