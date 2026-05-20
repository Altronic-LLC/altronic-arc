import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileText,
  Flag,
  FolderOpen,
  HardHat,
  Tag,
  User,
  Users,
} from "lucide-react";
import {
  useAddEirComment,
  useEditEirComment,
  useEir,
  useSetEirAssignedEngineers,
  useSetEirReporter,
  useSetEirWatchers,
  useUpdateEirFields,
} from "@/hooks/useEirs";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  EIR_REQUEST_TYPES,
  EIR_REQUESTED_PRIORITIES,
  EIR_RESOLUTIONS,
  EIR_STATUSES,
  type EirRequestType,
  type EirRequestedPriority,
  type Person,
  type Comment as CommentType,
  type CommentAttachment,
} from "@/types/task";
import { CommentThread } from "@/components/CommentThread";
import { CommentComposer } from "@/components/CommentComposer";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { StatusChip } from "./EirsView";
import { sanitiseHtml } from "@/lib/sanitiseHtml";

export function EirDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const eirId = id ? parseInt(id, 10) : null;
  const { data: eir, isLoading } = useEir(eirId);
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const currentUser = useCurrentUser();

  const updateFields = useUpdateEirFields();
  const setReporter = useSetEirReporter();
  const setEngineers = useSetEirAssignedEngineers();
  const setWatchers = useSetEirWatchers();
  const addComment = useAddEirComment();
  const editComment = useEditEirComment();

  // People directory — collected across tasks + EIRs to give the pickers
  // a useful starting set even before the EIR list itself has watchers.
  const allPeople = useMemo<Person[]>(() => {
    const map = new Map<string, Person>();
    for (const t of tasks) {
      for (const p of [...t.assigned, ...t.watchers]) {
        const k = (p.email ?? p.displayName).toLowerCase();
        if (!map.has(k)) map.set(k, p);
      }
    }
    if (currentUser.email) {
      const k = currentUser.email.toLowerCase();
      if (!map.has(k)) map.set(k, currentUser);
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [tasks, currentUser]);

  if (isLoading) {
    return <div className="mx-auto max-w-[1400px] px-4 py-12 text-fg-muted">Loading EIR…</div>;
  }
  if (!eir) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12">
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-fg-muted">
          EIR not found.
          <button
            onClick={() => navigate("/eirs")}
            className="mt-2 block w-full text-sm text-accent underline"
          >
            ← Back to EIRs
          </button>
        </div>
      </div>
    );
  }

  function handleAddComment(bodyHtml: string, _attachments: CommentAttachment[]) {
    if (!eir) return;
    // EIRs reuse the comment data shape; attachments aren't part of the
    // EIR Communication field today (parity with tasks).
    addComment.mutate({
      id: eir.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  async function handleEditComment(comment: CommentType, newBodyHtml: string) {
    if (!eir) return;
    await editComment.mutateAsync({
      id: eir.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      newBodyHtml,
    });
  }

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
              <StatusChip status={eir.status} />
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg">
                <FileText className="h-3 w-3" /> {eir.requestType ?? "EIR"}
              </span>
              {eir.taskPromotedFlag && (
                <span className="inline-flex items-center gap-1 rounded-full bg-cooper-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cooper-green">
                  Promoted to task
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs font-semibold text-fg-muted">
                {eir.eirNo || `#${eir.id}`}
              </span>
            </div>
            <h1 className="font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">
              {eir.title}
            </h1>
          </div>

          <BodyCard title="Description" body={eir.description} />
          <EditableTextCard
            title="Engineering Response"
            value={eir.engineeringResponse}
            onSave={(next) =>
              updateFields.mutate({ id: eir.id, fields: { EngineeringResponse: next } })
            }
          />

          {/* Part details */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              <HardHat className="h-4 w-4" /> Part details
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InlineTextField
                label="Where Used"
                value={eir.whereUsed}
                onSave={(v) => updateFields.mutate({ id: eir.id, fields: { WhereUsed: v } })}
              />
              <InlineTextField
                label="MFG"
                value={eir.mfg}
                onSave={(v) => updateFields.mutate({ id: eir.id, fields: { MFG: v } })}
              />
              <InlineTextField
                label="MFG P/N"
                value={eir.mfgPartNumber}
                mono
                onSave={(v) => updateFields.mutate({ id: eir.id, fields: { MFGP_x002f_N: v } })}
              />
              <InlineTextField
                label="Altronic Part Number"
                value={eir.altronicPartNumber}
                mono
                onSave={(v) =>
                  updateFields.mutate({
                    id: eir.id,
                    fields: { Altronic_x0020_Part_x0020_Number: v },
                  })
                }
              />
              <InlineTextField
                label="EAU"
                value={eir.eau}
                onSave={(v) => updateFields.mutate({ id: eir.id, fields: { EAU: v } })}
              />
              <InlineTextField
                label="Current Stock"
                value={eir.currentStock}
                onSave={(v) => updateFields.mutate({ id: eir.id, fields: { CurrentStock: v } })}
              />
              <InlineTextField
                label="Current Price"
                value={eir.currentPrice}
                onSave={(v) =>
                  updateFields.mutate({ id: eir.id, fields: { Current_x0020_Price: v } })
                }
              />
              <InlineTextField
                label="Buyer Code"
                value={eir.buyerCode}
                onSave={(v) => updateFields.mutate({ id: eir.id, fields: { BuyerCode: v } })}
              />
            </div>
          </div>

          {/* Comments */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={allPeople} />
            <div className="mt-5">
              <CommentThread
                comments={eir.comments}
                currentUserEmail={currentUser.email}
                onEdit={handleEditComment}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="grid gap-4">
              <SidebarSelect
                icon={<CheckCircle2 />}
                label="Status"
                value={eir.status}
                options={EIR_STATUSES}
                onChange={(v) => updateFields.mutate({ id: eir.id, fields: { Status: v } })}
              />
              <SidebarSelect
                icon={<Tag />}
                label="Resolution"
                value={eir.resolution}
                options={EIR_RESOLUTIONS}
                onChange={(v) => updateFields.mutate({ id: eir.id, fields: { Resolution: v } })}
              />
              <SidebarSelect<EirRequestType | "">
                icon={<FileText />}
                label="Request Type"
                value={eir.requestType ?? ""}
                options={["", ...EIR_REQUEST_TYPES] as (EirRequestType | "")[]}
                renderOption={(v) => v || "Not set"}
                onChange={(v) =>
                  updateFields.mutate({ id: eir.id, fields: { RequestType: v || null } })
                }
              />
              <SidebarSelect<EirRequestedPriority | "">
                icon={<Flag />}
                label="Requested Priority"
                value={eir.requestedPriority ?? ""}
                options={["", ...EIR_REQUESTED_PRIORITIES] as (EirRequestedPriority | "")[]}
                renderOption={(v) => v || "Not set"}
                onChange={(v) =>
                  updateFields.mutate({ id: eir.id, fields: { Priority: v || null } })
                }
              />

              <SidebarLabel icon={<User />}>Reporter</SidebarLabel>
              <SingleSelect
                allLabel="No reporter"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={eir.reporter ? eir.reporter.email ?? eir.reporter.displayName : null}
                onChange={(key) => {
                  const person = key
                    ? allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null
                    : null;
                  setReporter.mutate({ id: eir.id, person });
                }}
              />

              <SidebarLabel icon={<Users />}>Assigned Engineers</SidebarLabel>
              <MultiSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={eir.assignedEngineers.map((p) => p.email ?? p.displayName)}
                onChange={(keys) => {
                  const next: Person[] = [];
                  for (const k of keys) {
                    const p = allPeople.find((x) => (x.email ?? x.displayName) === k);
                    if (p) next.push(p);
                  }
                  setEngineers.mutate({ id: eir.id, people: next });
                }}
              />

              <SidebarLabel icon={<Users />}>Watchers</SidebarLabel>
              <MultiSelect
                allLabel="No watchers"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={eir.watchers.map((p) => p.email ?? p.displayName)}
                onChange={(keys) => {
                  const next: Person[] = [];
                  for (const k of keys) {
                    const p = allPeople.find((x) => (x.email ?? x.displayName) === k);
                    if (p) next.push(p);
                  }
                  setWatchers.mutate({ id: eir.id, people: next });
                }}
              />

              <SidebarLabel icon={<FolderOpen />}>Project Reference</SidebarLabel>
              <SingleSelect
                allLabel="None"
                searchPlaceholder="Search projects…"
                options={projects.map((p) => ({
                  value: String(p.lookupId),
                  label: p.title,
                }))}
                selected={eir.parentProject ? String(eir.parentProject.lookupId) : null}
                onChange={(v) =>
                  updateFields.mutate({
                    id: eir.id,
                    fields: { ProjectReferenceLookupId: v ? parseInt(v, 10) : null },
                  })
                }
              />
              {eir.parentProject && (
                <Link
                  to={`/project/${eir.parentProject.lookupId}`}
                  className="-mt-2 text-xs text-accent underline-offset-2 hover:underline"
                >
                  View project →
                </Link>
              )}

              <SidebarLabel icon={<FileText />}>Task Reference</SidebarLabel>
              <InlineTextField
                label=""
                value={eir.taskReference}
                onSave={(v) => updateFields.mutate({ id: eir.id, fields: { TaskReference: v } })}
                placeholder="e.g. T115"
              />
              {eir.taskReference && /^T?\d+/.test(eir.taskReference) && (
                <Link
                  to={`/task/${eir.taskReference.replace(/^T/i, "").split("-")[0]}`}
                  className="-mt-2 inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Open task
                </Link>
              )}

              <SidebarLabel icon={<Calendar />}>Requested Completion</SidebarLabel>
              <input
                type="date"
                value={
                  eir.requestedCompletionDate
                    ? eir.requestedCompletionDate.toISOString().slice(0, 10)
                    : ""
                }
                onChange={(e) =>
                  updateFields.mutate({
                    id: eir.id,
                    fields: { Requested_x0020_Completion_x0020: e.target.value || null },
                  })
                }
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />

              <SidebarLabel icon={<Calendar />}>LTB Date</SidebarLabel>
              <input
                type="date"
                value={eir.ltbDate ? eir.ltbDate.toISOString().slice(0, 10) : ""}
                onChange={(e) =>
                  updateFields.mutate({
                    id: eir.id,
                    fields: { LTBDate: e.target.value || null },
                  })
                }
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />

              <Field icon={<Calendar />} label="Created">
                {eir.createdAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Field>
              <Field icon={<User />} label="Created By">
                {eir.author?.displayName ?? <span className="text-fg-muted">Unknown</span>}
              </Field>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BodyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </h2>
      {body ? (
        <div
          className="comment-html"
          dangerouslySetInnerHTML={{ __html: sanitiseHtml(body) }}
        />
      ) : (
        <div className="text-sm text-fg-muted">Not set.</div>
      )}
    </div>
  );
}

function EditableTextCard({
  title,
  value,
  onSave,
}: {
  title: string;
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          {title}
        </h2>
        {!editing ? (
          <button
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-fg-muted underline-offset-2 hover:underline"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Save
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-md border border-border bg-bg p-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      ) : value ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{value}</div>
      ) : (
        <div className="text-sm text-fg-muted">Not set.</div>
      )}
    </div>
  );
}

function InlineTextField({
  label,
  value,
  onSave,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  if (draft !== value && document.activeElement?.tagName !== "INPUT") {
    setDraft(value);
  }
  return (
    <label className="flex flex-col gap-1">
      {label && (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          {label}
        </span>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        placeholder={placeholder}
        className={`w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}

function SidebarLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="-mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      {children}
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
      <SidebarLabel icon={icon}>{label}</SidebarLabel>
      <div className="mt-1.5 text-sm text-fg">{children}</div>
    </div>
  );
}

function SidebarSelect<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
  renderOption,
}: {
  icon: React.ReactNode;
  label: string;
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  renderOption?: (v: T) => string;
}) {
  return (
    <div>
      <SidebarLabel icon={icon}>{label}</SidebarLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1.5 w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        {options.map((o) => (
          <option key={o || "__empty"} value={o}>
            {renderOption ? renderOption(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}
