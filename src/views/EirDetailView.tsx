import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
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
import { useTasks, useProjects } from "@/hooks/useTasks";
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
import { EirStatusBadge, statusColor } from "@/components/atoms";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { cn } from "@/lib/cn";

export function EirDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const eirId = id ? parseInt(id, 10) : null;
  const { data: eir, isLoading } = useEir(eirId);
  const { data: tasks = [] } = useTasks();
  const currentUser = useCurrentUser();

  const updateFields = useUpdateEirFields();
  const setReporter = useSetEirReporter();
  const setEngineers = useSetEirAssignedEngineers();
  const setWatchers = useSetEirWatchers();
  const addComment = useAddEirComment();
  const editComment = useEditEirComment();

  // Match the EIR's Task Reference to a real task. The field can hold any
  // of three shapes — depending on whether the EIR was promoted via the
  // original Power Apps form, by hand, or via this app:
  //
  //   1. A Power Apps deep link, e.g.
  //      `https://apps.powerapps.com/.../?...&ItemID=2755`
  //      The `ItemID=` query param IS the SharePoint list-item id (== task.id).
  //   2. A task number prefix like `T115` or `T115-PROJ-Title`. Matched
  //      against task.numberedTitle.
  //   3. A bare SharePoint item id like `2755`. Matched against task.id.
  //
  // We try them in that order so a URL doesn't get accidentally parsed as
  // a bare id from a substring.
  const linkedTask = useMemo(() => {
    const raw = eir?.taskReference?.trim();
    if (!raw) return null;
    const fromUrl = extractItemIdFromUrl(raw);
    if (fromUrl != null) {
      const byId = tasks.find((t) => t.id === fromUrl);
      if (byId) return byId;
    }
    const prefix = (/^T\d+/i.exec(raw)?.[0] ?? "").toUpperCase();
    if (prefix) {
      const byNumber = tasks.find((t) =>
        t.numberedTitle?.toUpperCase().startsWith(prefix + "-") ||
        t.numberedTitle?.toUpperCase() === prefix,
      );
      if (byNumber) return byNumber;
    }
    const asId = parseInt(raw.replace(/^T/i, ""), 10);
    if (!Number.isNaN(asId)) {
      const byId = tasks.find((t) => t.id === asId);
      if (byId) return byId;
    }
    return null;
  }, [eir?.taskReference, tasks]);

  // True when the stored value is a Power Apps URL (vs a typed "T115").
  // Drives the UI swap below: instead of showing a hideous URL in a text
  // input, we render the linked task as a chip.
  const taskRefIsUrl = !!eir && extractItemIdFromUrl(eir.taskReference) != null;

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
    return <LoadingTasks noun="this EIR" />;
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
              <EirStatusBadge status={eir.status} />
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

          <EditableTextCard
            title="Where Used"
            value={eir.whereUsed}
            onSave={(next) =>
              updateFields.mutate({ id: eir.id, fields: { WhereUsed: next } })
            }
          />

          {/* Part details */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              <HardHat className="h-4 w-4" /> Part details
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          <LinkedTaskCard
            linkedTask={linkedTask}
            rawReference={eir.taskReference}
            referenceIsUrl={taskRefIsUrl}
            onSaveReference={(v) =>
              updateFields.mutate({ id: eir.id, fields: { TaskReference: v } })
            }
          />

          <AttachmentsSection parent="eir" itemId={eir.id} />

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

              <SidebarField icon={<User />} label="Reporter">
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
              </SidebarField>

              <SidebarField icon={<Users />} label="Assigned">
                <PersonMultiField
                  value={eir.assignedEngineers}
                  allPeople={allPeople}
                  onToggle={(p) => {
                    const key = (p.email ?? p.displayName).toLowerCase();
                    const isSelected = eir.assignedEngineers.some(
                      (x) => (x.email ?? x.displayName).toLowerCase() === key,
                    );
                    const next = isSelected
                      ? eir.assignedEngineers.filter(
                          (x) => (x.email ?? x.displayName).toLowerCase() !== key,
                        )
                      : [...eir.assignedEngineers, p];
                    setEngineers.mutate({ id: eir.id, people: next });
                  }}
                />
              </SidebarField>

              <SidebarField icon={<FolderOpen />} label="Project Reference">
                <ProjectChoicePicker
                  selectedTitle={eir.parentProject?.title ?? ""}
                  onChange={(titles) =>
                    updateFields.mutate({
                      id: eir.id,
                      fields: { ProjectReference: titles },
                    })
                  }
                />
              </SidebarField>


              <SidebarField icon={<Calendar />} label="Requested Completion">
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
              </SidebarField>

              <SidebarField icon={<Calendar />} label="LTB Date">
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
              </SidebarField>

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

              {/* Watchers live at the bottom of the sidebar to match the
                  Task detail layout — they're informational, not the kind
                  of thing you act on while triaging an EIR. */}
              <SidebarField icon={<Users />} label="Watchers">
                <PersonMultiField
                  value={eir.watchers}
                  allPeople={allPeople}
                  emptyLabel="Nobody is watching this EIR"
                  onToggle={(p) => {
                    const key = (p.email ?? p.displayName).toLowerCase();
                    const isSelected = eir.watchers.some(
                      (x) => (x.email ?? x.displayName).toLowerCase() === key,
                    );
                    const next = isSelected
                      ? eir.watchers.filter(
                          (x) => (x.email ?? x.displayName).toLowerCase() !== key,
                        )
                      : [...eir.watchers, p];
                    setWatchers.mutate({ id: eir.id, people: next });
                  }}
                />
              </SidebarField>
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
        // The Engineering Response field can be plain text or HTML (when
        // edits come from the original Power Apps form, they arrive as
        // <p>...</p>). Detect HTML by a tag presence test and render it
        // sanitised; otherwise treat as plain text and preserve newlines.
        looksLikeHtml(value) ? (
          <div
            className="comment-html text-sm leading-relaxed text-fg"
            dangerouslySetInnerHTML={{ __html: sanitiseHtml(value) }}
          />
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{value}</div>
        )
      ) : (
        <div className="text-sm text-fg-muted">Not set.</div>
      )}
    </div>
  );
}

function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(s);
}

/**
 * Pull a SharePoint item id out of a Power Apps deep link. Promoted EIRs
 * stamp the Task Reference field with a long URL whose `ItemID=` query
 * param is the underlying SP list-item id (== `task.id` in this app).
 * Returns null if `raw` isn't a Power Apps URL with an ItemID.
 */
function extractItemIdFromUrl(raw: string): number | null {
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  const match = /[?&]ItemID=(\d+)/i.exec(raw);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

/**
 * Linked-Task card — main-column section that mirrors the "Child tasks"
 * card on the task detail view. One row per linked task (just one for
 * now; we keep the array shape so multi-link is a small upgrade later).
 * Each row is a clickable button with the numbered title on the left and
 * a status badge on the right.
 *
 * Editing: a small "Edit" button toggles an inline text input so users
 * can replace the reference. For Power Apps URLs we don't expose the raw
 * URL in the input (would only invite typos) — just an "Edit" → empty
 * input flow.
 */
function LinkedTaskCard({
  linkedTask,
  rawReference,
  referenceIsUrl,
  onSaveReference,
}: {
  linkedTask: import("@/types/task").Task | null;
  rawReference: string;
  referenceIsUrl: boolean;
  onSaveReference: (next: string) => void;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(
    referenceIsUrl ? "" : rawReference,
  );

  const hasReference = !!rawReference;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Linked Task
        </h2>
        {!editing ? (
          <button
            onClick={() => {
              setDraft(referenceIsUrl ? "" : rawReference);
              setEditing(true);
            }}
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            {hasReference ? "Edit" : "Add"}
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
                onSaveReference(draft.trim());
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
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. T115 — or paste a Power Apps task link"
          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      ) : linkedTask ? (
        <button
          onClick={() => navigate(`/task/${linkedTask.id}`)}
          className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-fg-muted hover:bg-surface-2"
        >
          <span className="truncate font-medium text-fg">
            {linkedTask.numberedTitle || `Task #${linkedTask.id}`}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              statusColor(linkedTask.status),
            )}
          >
            {linkedTask.status}
          </span>
        </button>
      ) : hasReference ? (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-fg-muted">
          Reference is set but the linked task hasn't loaded yet (or it lives outside
          this list). Raw value: <code className="break-all">{rawReference}</code>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border py-4 text-center text-xs text-fg-muted">
          No task linked. Click "Add" to set one.
        </div>
      )}
    </div>
  );
}

/**
 * Sidebar picker for the multi-select Project Reference column. Reads the
 * comma-joined title string the mapper packs the chosen choices into,
 * splits it back into individual selections, and writes the change back as
 * a string array (the Choice column's native write shape). Options come
 * from the Projects list — its titles are the values configured as
 * allowed choices in SharePoint.
 */
function ProjectChoicePicker({
  selectedTitle,
  onChange,
}: {
  selectedTitle: string;
  onChange: (titles: string[]) => void;
}) {
  const { data: projects = [] } = useProjects();
  const selected = selectedTitle
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Options = every project title from the Projects list, deduped. Then
  // surface any currently-selected value that ISN'T in the projects list,
  // so chips still render for archived/renamed projects.
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const p of projects) {
    if (!p.title || seen.has(p.title)) continue;
    seen.add(p.title);
    options.push({ value: p.title, label: p.title });
  }
  for (const s of selected) {
    if (!seen.has(s)) {
      seen.add(s);
      options.push({ value: s, label: `${s} (not in projects list)` });
    }
  }

  return (
    <MultiSelect
      allLabel="No project assigned"
      searchPlaceholder="Search projects…"
      options={options}
      selected={selected}
      onChange={onChange}
    />
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
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      {children}
    </div>
  );
}

/**
 * Sidebar grouping: keeps a label tightly bound to its control so neighbouring
 * controls don't visually mix in (no more negative-margin hacks). Optional
 * footer node renders a small "View task →" / "View project →" link below
 * the control.
 */
function SidebarField({
  icon,
  label,
  children,
  footer,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SidebarLabel icon={icon}>{label}</SidebarLabel>
      {children}
      {footer}
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
    <SidebarField icon={icon} label={label}>
      <div className="text-sm text-fg">{children}</div>
    </SidebarField>
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
    <SidebarField icon={icon} label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        {options.map((o) => (
          <option key={o || "__empty"} value={o}>
            {renderOption ? renderOption(o) : o}
          </option>
        ))}
      </select>
    </SidebarField>
  );
}
