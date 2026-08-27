import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ClipboardCheck, FolderOpen, Pencil, User } from "lucide-react";
import {
  collectFaitPeople,
  useAddFaitComment,
  useEditFaitComment,
  useFait,
  useFaits,
  useSetFaitWatchers,
  useUpdateFaitAssignedEngineer,
  useUpdateFaitFields,
  useUpdateFaitKam,
} from "@/hooks/useFaits";
import type { Comment, Fait, Person } from "@/types/task";
import {
  FAIT_SECTIONS,
  FAIT_STATUSES,
  faitFieldsInSection,
  type FaitField,
  type FaitSection,
} from "@/lib/faitFields";
import { faitFieldPatch, faitProjectPatch } from "@/lib/faitMapper";
import { mergePeople, personKey } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useProjects } from "@/hooks/useTasks";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";
import { SingleSelect } from "@/components/SearchableSelect";
import { FaitStatusChip, FirstPassChip, SignOffChip } from "@/components/faitAtoms";

/**
 * Whether this FAIT needs a KAM sign-off at all. False only when there's
 * neither a KAM assigned nor any KAM sign-off data already on the record —
 * the detail page hides the KAM sign-off fields in that case, which is how
 * "this FAIT doesn't need a KAM" is expressed (Ray, 2026-08-27: "how to
 * hide/remove the KAM signoff when it is not required"). Checking the
 * existing data too, not just whether a KAM is assigned, means a FAIT
 * someone already signed off on before there was any way to assign a KAM
 * person never has its real sign-off hidden out from under it.
 */
function kamNeeded(fait: Fait): boolean {
  return (
    fait.kam !== null ||
    !!fait.values.kamSignOff ||
    !!fait.values.kamInitials ||
    !!fait.values.kamApprovalNotes
  );
}

const KAM_FIELD_KEYS = new Set(["kamSignOff", "kamInitials", "kamApprovalNotes"]);

/**
 * A section's fields, minus the KAM sign-off ones when this FAIT doesn't
 * need a KAM — used for both the read-only card and its Edit modal, so the
 * two never disagree about whether KAM fields are showing.
 */
function visibleFaitFields(section: FaitSection, fait: Fait): FaitField[] {
  const fields = faitFieldsInSection(section);
  if (section !== "Sign-off" || kamNeeded(fait)) return fields;
  return fields.filter((f) => !KAM_FIELD_KEYS.has(f.key));
}

// =============================================================================
// One FAIT.
//
// The page is the workflow: Part → Request → Inspection → Results → Sign-off,
// one card each, rendered from the descriptor table in faitFields.ts. Each
// card has a single Edit button behind the shared FieldEditModal, so quality,
// engineering and the KAM each fill in their own part without stepping on
// each other's columns.
//
// Nineteen of the fifty-one columns are Yes/No. Read-only they're spelled out
// rather than ticked, and in the editor they're the labelled Yes/No pills —
// see ChoicePills.
// =============================================================================

export function FaitDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const faitId = id ? parseInt(id, 10) : null;
  const { data: fait, isLoading } = useFait(faitId);
  const { data: faits = [] } = useFaits();
  const { data: projects = [] } = useProjects();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const updateFields = useUpdateFaitFields();
  const setWatchers = useSetFaitWatchers();
  const updateAssignedEngineer = useUpdateFaitAssignedEngineer();
  const updateKam = useUpdateFaitKam();
  const addComment = useAddFaitComment();
  const editComment = useEditFaitComment();

  const [editing, setEditing] = useState<FaitSection | "Details" | null>(null);

  const mentionCandidates = useMemo(
    () => mergePeople(collectFaitPeople(faits), directory),
    [faits, directory],
  );
  const projectOptions = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
        .map((p) => ({ value: String(p.lookupId), label: p.title })),
    [projects],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the FAIT" />
      </div>
    );
  }

  if (!fait) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That FAIT doesn't exist.</p>
        <button
          onClick={() => navigate("/supply-chain/faits")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to FAITs
        </button>
      </div>
    );
  }

  const projectTitle =
    projects.find((p) => p.lookupId === fait.parentProject?.lookupId)?.title ?? null;

  function save(fields: Record<string, unknown>, patch: (f: Fait) => Fait) {
    if (!fait) return;
    updateFields.mutate({ id: fait.id, fields, patch });
  }

  /** One card's worth of edits, as ONE write. */
  function saveFields(changed: Record<string, string>) {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changed)) {
      Object.assign(fields, faitFieldPatch(key, value));
    }
    save(fields, (f) => ({ ...f, values: { ...f.values, ...changed } }));
  }

  /** Status and project — columns of their own rather than descriptors. */
  function saveDetails(changed: Record<string, string>) {
    const fields: Record<string, unknown> = {};
    if ("status" in changed) fields.Status = changed.status;
    const nextProject =
      "project" in changed
        ? changed.project
          ? { lookupId: parseInt(changed.project, 10), title: "" }
          : null
        : undefined;
    if (nextProject !== undefined) {
      Object.assign(fields, faitProjectPatch(nextProject?.lookupId ?? null));
    }
    save(fields, (f) => ({
      ...f,
      status: "status" in changed ? changed.status : f.status,
      parentProject: nextProject === undefined ? f.parentProject : nextProject,
    }));
  }

  function handleAddComment(bodyHtml: string) {
    if (!fait) return;
    addComment.mutate({
      id: fait.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  function handleWatcherToggle(person: Person) {
    if (!fait) return;
    const key = (person.email ?? person.displayName).toLowerCase();
    const watching = fait.watchers.some(
      (w) => (w.email ?? w.displayName).toLowerCase() === key,
    );
    const people = watching
      ? fait.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...fait.watchers, person];
    setWatchers.mutate({ id: fait.id, people });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!fait) return;
    await editComment.mutateAsync({
      id: fait.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="FAITs" listTo="/supply-chain/faits" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <ClipboardCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {fait.values.sapPartNumber || `FAIT #${fait.id}`}
          </h1>
          <p className="text-sm text-fg-muted">
            {fait.values.description || "No description"}
            {fait.values.supplierName && ` · ${fait.values.supplierName}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FirstPassChip
            passed={fait.values.meetsFirstPass ?? ""}
            failed={fait.values.failedFirstPass ?? ""}
          />
          <FaitStatusChip status={fait.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          {FAIT_SECTIONS.map((section) => (
            <section
              key={section}
              className="rounded-xl border border-border bg-surface p-4 sm:p-5"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                  {section}
                </h2>
                <EditButton label={section} onClick={() => setEditing(section)} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {visibleFaitFields(section, fait).map((field) => (
                  <FieldRow key={field.key} field={field} value={fait.values[field.key] ?? ""} />
                ))}
              </div>
            </section>
          ))}

          <AttachmentsSection parent="fait" itemId={fait.id} />

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
            <div className="mt-5">
              <CommentThread
                comments={fait.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Details
            </span>
            <EditButton label="Details" onClick={() => setEditing("Details")} />
          </div>

          <SidebarField label="Status">
            <p className="px-1">
              <FaitStatusChip status={fait.status} />
            </p>
          </SidebarField>

          <SidebarField label="Project" icon={<FolderOpen className="h-3.5 w-3.5" />}>
            <p className="px-1 text-sm text-fg">
              {projectTitle ?? <span className="text-fg-muted">No project</span>}
            </p>
          </SidebarField>

          <SidebarField label="Sign-offs">
            <div className="flex flex-wrap gap-1.5 px-1">
              <SignOffChip label="SQE" value={fait.values.sqeSignOff ?? ""} />
              <SignOffChip label="Eng" value={fait.values.engSignOff ?? ""} />
              {/* Hidden entirely when no KAM sign-off is needed — see kamNeeded. */}
              {kamNeeded(fait) && <SignOffChip label="KAM" value={fait.values.kamSignOff ?? ""} />}
            </div>
          </SidebarField>

          <SidebarField label="Initiator" icon={<User className="h-3.5 w-3.5" />}>
            <p className="px-1 text-sm text-fg">
              {fait.initiator?.displayName ?? <span className="text-fg-muted">Not set</span>}
            </p>
          </SidebarField>

          <SidebarField label="Assigned Engineer" icon={<User className="h-3.5 w-3.5" />}>
            <SingleSelect
              allLabel="Not set"
              searchPlaceholder="Search people…"
              options={mentionCandidates.map((p) => ({ value: personKey(p), label: p.displayName }))}
              selected={fait.assignedEngineer ? personKey(fait.assignedEngineer) : null}
              onChange={(key) => {
                const person = key ? mentionCandidates.find((p) => personKey(p) === key) ?? null : null;
                updateAssignedEngineer.mutate({ id: fait.id, person });
              }}
            />
          </SidebarField>

          <SidebarField label="KAM" icon={<User className="h-3.5 w-3.5" />}>
            <SingleSelect
              allLabel="Not set"
              searchPlaceholder="Search people…"
              options={mentionCandidates.map((p) => ({ value: personKey(p), label: p.displayName }))}
              selected={fait.kam ? personKey(fait.kam) : null}
              onChange={(key) => {
                const person = key ? mentionCandidates.find((p) => personKey(p) === key) ?? null : null;
                updateKam.mutate({ id: fait.id, person });
              }}
            />
            {!kamNeeded(fait) && (
              <p className="mt-1 px-1 text-[11px] text-fg-muted">
                No KAM needed — assign one only if this FAIT requires a KAM sign-off.
              </p>
            )}
          </SidebarField>

          <SidebarField label="Watchers">
            <PersonMultiField
              value={fait.watchers}
              allPeople={mentionCandidates}
              onToggle={handleWatcherToggle}
              emptyLabel="No watchers"
            />
          </SidebarField>

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Raised {fait.createdAt.toLocaleDateString()} · last edited{" "}
            {fait.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>

      {editing === "Details" && (
        <FieldEditModal
          title="Edit Details"
          fields={[
            { key: "status", label: "Status", kind: "choice", choices: FAIT_STATUSES },
            { key: "project", label: "Project", kind: "select", options: projectOptions },
          ]}
          values={{
            status: fait.status,
            project: fait.parentProject ? String(fait.parentProject.lookupId) : "",
          }}
          onClose={() => setEditing(null)}
          onSave={saveDetails}
        />
      )}

      {editing && editing !== "Details" && (
        <FieldEditModal
          title={`Edit ${editing}`}
          fields={visibleFaitFields(editing, fait).map(editSpec)}
          values={editValues(fait, visibleFaitFields(editing, fait))}
          onClose={() => setEditing(null)}
          onSave={saveFields}
        />
      )}
    </div>
  );
}

/** A descriptor → what the shared editor needs to render it. */
function editSpec(field: FaitField): EditableFieldSpec {
  return {
    key: field.key,
    label: field.label,
    // The editor has no date control, so a date edits as text (ISO) — see
    // the note on FieldRow. Everything else maps straight across.
    kind: field.kind === "date" ? "text" : field.kind,
    choices: field.choices,
    hint: field.kind === "date" ? "YYYY-MM-DD" : field.hint,
  };
}

function editValues(fait: Fait, fields: FaitField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = fait.values[field.key] ?? "";
    values[field.key] = field.kind === "date" ? isoDay(raw) : raw;
  }
  return values;
}

/** An ISO instant → the yyyy-mm-dd a person types. */
function isoDay(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** The one way to change anything on a card. */
function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
    >
      <Pencil className="h-3 w-3" />
      Edit
    </button>
  );
}

/** One descriptor field, read-only. */
function FieldRow({ field, value }: { field: FaitField; value: string }) {
  const long = field.kind === "multiline";
  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {field.label}
      </span>
      {field.kind === "boolean" ? (
        // Spelled out rather than ticked — the question asks Yes or No, and a
        // checkbox on a read-only page looks like a control.
        <p className="text-sm text-fg">{value === "Yes" ? "Yes" : "No"}</p>
      ) : field.kind === "date" ? (
        <p className="text-sm text-fg">
          {value ? new Date(value).toLocaleDateString() : <span className="text-fg-muted">Not set</span>}
        </p>
      ) : value ? (
        <p className="whitespace-pre-wrap text-sm text-fg">{value}</p>
      ) : (
        <p className="text-sm text-fg-muted">Not set</p>
      )}
    </div>
  );
}

function SidebarField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}
