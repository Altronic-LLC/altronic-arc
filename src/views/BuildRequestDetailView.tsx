import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Eye,
  FolderOpen,
  Link2,
  Package,
  Pencil,
  Plus,
  User,
} from "lucide-react";
import {
  useAddBuildRequestComment,
  useBuildRequest,
  useBuildRequestItems,
  useBuildRequests,
  useEditBuildRequestComment,
  useSetBuildRequestEngineer,
  useSetBuildRequestProjects,
  useSetBuildRequestRequestor,
  useSetBuildRequestWatchers,
  useUpdateBuildRequestFields,
} from "@/hooks/useBuildRequests";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAdmins } from "@/hooks/useAdmins";
import {
  BUILD_REQUEST_BLOCKED_REASONS,
  BUILD_REQUEST_LEAD_TIMES,
  BUILD_REQUEST_SAMPLE_PHASES,
  BUILD_REQUEST_STATUSES,
  BUILD_REQUEST_TYPES,
  type Comment,
  type Person,
} from "@/types/task";
import { BuildRequestStatusBadge, LeadFreeChip, LeadTimeChip } from "@/components/buildRequestAtoms";
import { BuildRequestItemCard } from "@/components/BuildRequestItemCard";
import { BuildRequestItemFormModal } from "@/components/BuildRequestItemFormModal";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { PersonMultiField } from "@/components/PersonMultiField";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { LoadingTasks } from "@/components/LoadingTasks";

export function BuildRequestDetailView() {
  const { id } = useParams<{ id: string }>();
  const brId = id ? parseInt(id, 10) : null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusItemId = searchParams.get("item") ? parseInt(searchParams.get("item")!, 10) : null;

  const currentUser = useCurrentUser();
  const { data: br, isLoading } = useBuildRequest(brId);
  const { data: allBrs = [] } = useBuildRequests();
  const { data: allItems = [] } = useBuildRequestItems();
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const { data: admins = [] } = useAdmins();

  const updateFields = useUpdateBuildRequestFields();
  const setRequestor = useSetBuildRequestRequestor();
  const setEngineer = useSetBuildRequestEngineer();
  const setProjects = useSetBuildRequestProjects();
  const setWatchers = useSetBuildRequestWatchers();
  const addComment = useAddBuildRequestComment();
  const editComment = useEditBuildRequestComment();

  const [showAddPart, setShowAddPart] = useState(false);

  const items = useMemo(
    () =>
      allItems
        .filter((i) => i.buildRequestLookupId === brId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    [allItems, brId],
  );

  // People directory: everyone on any BR (requestors/engineers/watchers on
  // headers + items) + the Admins list, so brand-new people can be picked
  // and @-mentioned (the cold-start lesson).
  const allPeople: Person[] = useMemo(() => {
    const map = new Map<string, Person>();
    const note = (p: Person | null | undefined) => {
      if (!p || !p.displayName) return;
      const k = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(k)) map.set(k, p);
    };
    for (const b of allBrs) {
      note(b.requestor);
      note(b.engineerAssigned);
      b.watchers.forEach(note);
    }
    for (const i of allItems) i.watchers.forEach(note);
    for (const t of tasks) {
      for (const p of [...t.assigned, ...t.watchers]) note(p);
    }
    note(currentUser);
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allBrs, allItems, tasks, currentUser]);

  const mentionCandidates: Person[] = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of allPeople) map.set((p.email ?? p.displayName).toLowerCase(), p);
    for (const a of admins) {
      const key = a.email.toLowerCase();
      if (!map.has(key)) map.set(key, { displayName: a.displayName || a.email, email: a.email });
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allPeople, admins]);

  // Task Reference resolves against the tasks cache (non-blocking; shows the
  // bare id until the tasks list has loaded).
  const linkedTask = useMemo(
    () =>
      br?.taskReferenceLookupId != null
        ? tasks.find((t) => t.id === br.taskReferenceLookupId) ?? null
        : null,
    [br, tasks],
  );

  useEffect(() => {
    if (br) document.title = `${br.brNo} — ARC`;
    return () => {
      document.title = "ARC — Altronic Resource Center";
    };
  }, [br]);

  if (isLoading && !br) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <LoadingTasks noun="this build request" />
      </div>
    );
  }

  if (!br) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12 text-center">
        <p className="text-fg-muted">Build request not found.</p>
        <button
          onClick={() => navigate("/build-requests")}
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Build Requests
        </button>
      </div>
    );
  }

  function patch(fields: Record<string, unknown>) {
    if (!br) return;
    updateFields.mutate({ id: br.id, fields });
  }

  function personByKey(key: string | null): Person | null {
    if (!key) return null;
    return allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null;
  }

  function handleAddComment(bodyHtml: string) {
    if (!br) return;
    addComment.mutate({
      id: br.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string, renotify: boolean) {
    if (!br) return;
    await editComment.mutateAsync({
      id: br.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      newBodyHtml,
      renotify,
    });
  }

  function handleWatcherToggle(p: Person) {
    if (!br) return;
    const key = (p.email ?? p.displayName).toLowerCase();
    const has = br.watchers.some((w) => (w.email ?? w.displayName).toLowerCase() === key);
    const next = has
      ? br.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...br.watchers, p];
    setWatchers.mutate({ id: br.id, people: next });
  }

  const shipDateInput = br.quotedShipDate ? br.quotedShipDate.toISOString().slice(0, 10) : "";

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Header card */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <BuildRequestStatusBadge status={br.status} />
              {br.brType && (
                <span className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg">
                  {br.brType}
                </span>
              )}
              <LeadTimeChip leadTime={br.requiredLeadTime} />
              <LeadFreeChip leadFree={br.leadFree} />
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs font-semibold text-fg-muted">
                {br.brNo || `#${br.id}`}
              </span>
            </div>
            <InlineTitle value={br.title} onSave={(next) => patch({ Title: next })} />
          </div>

          {/* Parts */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                <Package className="h-4 w-4" />
                Parts ({items.length})
              </h2>
              <button
                onClick={() => setShowAddPart(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
              >
                <Plus className="h-4 w-4" />
                Add Part
              </button>
            </div>
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-muted">
                No parts yet. Click "Add Part" to add the first one.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <BuildRequestItemCard
                    key={item.id}
                    item={item}
                    mentionCandidates={mentionCandidates}
                    defaultExpanded={focusItemId === item.id}
                  />
                ))}
              </div>
            )}
          </div>

          <AttachmentsSection parent="buildRequest" itemId={br.id} />

          {/* Header comments */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments on this request
            </h2>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
            <div className="mt-5">
              <CommentThread
                comments={br.comments}
                currentUserEmail={currentUser.email}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="grid gap-4">
              <SideField label="Status">
                <select
                  value={br.status}
                  onChange={(e) => patch({ BRStatus: e.target.value })}
                  className="select"
                >
                  {BUILD_REQUEST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </SideField>

              {br.status === "Blocked" && (
                <SideField label="Blocked Reason">
                  <select
                    value={br.blockedReason ?? ""}
                    onChange={(e) => patch({ BlockedReason: e.target.value || null })}
                    className="select"
                  >
                    <option value="">Not set</option>
                    {BUILD_REQUEST_BLOCKED_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </SideField>
              )}

              <SideField label="Type">
                <select
                  value={br.brType ?? ""}
                  onChange={(e) => patch({ BrType0: e.target.value || null })}
                  className="select"
                >
                  <option value="">Not set</option>
                  {BUILD_REQUEST_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </SideField>

              {br.brType === "Sample (A-D)" && (
                <SideField label="Sample Phase">
                  <select
                    value={br.samplePhase ?? ""}
                    onChange={(e) => patch({ SamplePhase: e.target.value || null })}
                    className="select"
                  >
                    <option value="">Not set</option>
                    {BUILD_REQUEST_SAMPLE_PHASES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </SideField>
              )}

              <SideField label="Required Lead Time">
                <select
                  value={br.requiredLeadTime ?? ""}
                  onChange={(e) => patch({ RequiredLeadTime: e.target.value || null })}
                  className="select"
                >
                  <option value="">Not set</option>
                  {BUILD_REQUEST_LEAD_TIMES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </SideField>

              {br.requiredLeadTime === "Ship Date" && (
                <SideField label="Quoted Ship Date" icon={<Calendar />}>
                  <input
                    type="date"
                    value={shipDateInput}
                    onChange={(e) =>
                      patch({
                        QuotedShipDate: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                    className="select"
                  />
                </SideField>
              )}

              <SideField label="Requestor" icon={<User />}>
                <SingleSelect
                  allLabel="Not set"
                  searchPlaceholder="Search people…"
                  options={allPeople.map((p) => ({
                    value: p.email ?? p.displayName,
                    label: p.displayName,
                  }))}
                  selected={br.requestor ? br.requestor.email ?? br.requestor.displayName : null}
                  onChange={(key) => setRequestor.mutate({ id: br.id, person: personByKey(key) })}
                />
              </SideField>

              <SideField label="Engineer Assigned" icon={<User />}>
                <SingleSelect
                  allLabel="Unassigned"
                  searchPlaceholder="Search people…"
                  options={allPeople.map((p) => ({
                    value: p.email ?? p.displayName,
                    label: p.displayName,
                  }))}
                  selected={
                    br.engineerAssigned
                      ? br.engineerAssigned.email ?? br.engineerAssigned.displayName
                      : null
                  }
                  onChange={(key) => setEngineer.mutate({ id: br.id, person: personByKey(key) })}
                />
              </SideField>

              <SideField label="Project Reference" icon={<FolderOpen />}>
                <MultiSelect
                  allLabel="No projects"
                  searchPlaceholder="Search projects…"
                  variant="chips"
                  options={projects.map((p) => ({ value: String(p.lookupId), label: p.title }))}
                  selected={br.parentProjects.map((p) => String(p.lookupId))}
                  onChange={(next) =>
                    setProjects.mutate({
                      id: br.id,
                      lookupIds: next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)),
                    })
                  }
                />
              </SideField>

              {br.taskReferenceLookupId != null && (
                <SideField label="Task Reference" icon={<Link2 />}>
                  <Link
                    to={`/task/${br.taskReferenceLookupId}`}
                    className="text-sm text-accent underline-offset-2 hover:underline"
                  >
                    {linkedTask ? linkedTask.numberedTitle || linkedTask.title : `Task #${br.taskReferenceLookupId}`}
                  </Link>
                </SideField>
              )}

              <SideField label="Customer" icon={<Building2 />}>
                <input
                  type="text"
                  defaultValue={br.customerName}
                  key={`cn-${br.id}-${br.customerName}`}
                  onBlur={(e) => {
                    if (e.target.value !== br.customerName) patch({ CustomerName: e.target.value });
                  }}
                  placeholder="Customer name"
                  className="select"
                />
                <input
                  type="text"
                  defaultValue={br.customerPO}
                  key={`po-${br.id}-${br.customerPO}`}
                  onBlur={(e) => {
                    if (e.target.value !== br.customerPO)
                      patch({ CustomerPurchaseOrder: e.target.value });
                  }}
                  placeholder="Customer PO"
                  className="select mt-1.5"
                />
              </SideField>

              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={br.leadFree}
                  onChange={(e) => patch({ RoHS: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                Lead Free (RoHS)
              </label>

              <SideField label="Watchers" icon={<Eye />}>
                <PersonMultiField
                  value={br.watchers}
                  allPeople={mentionCandidates}
                  onToggle={handleWatcherToggle}
                  emptyLabel="Nobody is watching this request"
                />
              </SideField>

              <div className="border-t border-border pt-3 text-[11px] leading-relaxed text-fg-muted">
                Created{" "}
                {br.createdAt.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {br.author?.displayName ? ` by ${br.author.displayName}` : ""}
                <br />
                Modified{" "}
                {br.modifiedAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {showAddPart && (
        <BuildRequestItemFormModal buildRequest={br} onClose={() => setShowAddPart(false)} />
      )}
    </div>
  );
}

// ---- file-local helpers (EirDetailView convention) --------------------------

function InlineTitle({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="group flex items-start gap-2">
        <h1 className="flex-1 font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">
          {value}
        </h1>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="shrink-0 rounded-md p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100 focus:opacity-100"
          aria-label="Edit title"
          title="Edit title"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="w-full rounded-md border border-border bg-bg px-3 py-2 font-display text-xl font-semibold leading-tight text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-2xl"
    />
  );
}

function SideField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}
