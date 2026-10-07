import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Bell,
  BellOff,
  Calendar,
  ExternalLink,
  FolderOpen,
  Megaphone,
  Pencil,
  User,
} from "lucide-react";
import {
  collectScnPeople,
  useAddScnComment,
  useEditScnComment,
  useScn,
  useScns,
  useSetScnAssigned,
  useSetScnOwner,
  useSetScnWatchers,
  useUpdateScnFields,
} from "@/hooks/useScns";
import type { Comment, Person, Scn, ScnPatch } from "@/types/task";
import { SCN_APPROVAL_STATUSES, SCN_STATUSES } from "@/types/task";
import {
  SCN_SECTIONS,
  scnField,
  scnFieldLabel,
  scnFieldsInSection,
  type ScnField,
  type ScnSection,
} from "@/lib/scnFields";
import { scnLabel, scnValue } from "@/lib/scnMapper";
import { formatSpDate, fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { mergePeople, personKey } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { useCommentFileUpload } from "@/hooks/useAttachments";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { ChoicePills } from "@/components/ChoicePills";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";
import { ScnApprovalChip, ScnCategoryChip, ScnStatusChip } from "@/components/scnAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// One SCN — a Supply Chain Notice.
//
// Four cards from the descriptor table (Notice → Parts → Review → Outcome),
// each with ONE Edit button and the shared FieldEditModal behind it: the page
// reads, the modal writes, and only the keys that changed come back. The
// hook then diffs those against the row and sends only the columns that
// actually moved.
//
// The one exception to "nothing on the card commits a change" is the three
// review CHECKLISTS. They are progress checklists ticked as the work is done
// — the Build Request item checklist shape — and making somebody open a
// modal to tick one box 84 times over is how a checklist stops being kept.
// Each tick writes the whole array for that column, so the picture is always
// SharePoint's picture.
//
// Sidebar: the status pair (saving immediately), the two person columns,
// watchers, and who raised it. Comments, watchers and attachments are the
// standard ARC set.
// =============================================================================

export function ScnDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const scnId = id ? parseInt(id, 10) : null;
  // A screenshot pasted into a comment goes to the SAME list-item attachment
  // store as the Attachments card. Without this the composer discards it.
  const uploadCommentFile = useCommentFileUpload("scn", scnId);
  const { data: scn, isLoading } = useScn(scnId);
  const { data: scns = [] } = useScns();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const update = useUpdateScnFields();
  const setWatchers = useSetScnWatchers();
  const setAssigned = useSetScnAssigned();
  const setOwner = useSetScnOwner();
  const addComment = useAddScnComment();
  const editComment = useEditScnComment();

  const mentionCandidates = useMemo(
    () => mergePeople(collectScnPeople(scns), directory, [currentUser]),
    [scns, directory, currentUser],
  );
  // Which card's editor is open — one at a time.
  const [editing, setEditing] = useState<ScnSection | null>(null);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the SCN" />
      </div>
    );
  }

  if (!scn) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That SCN doesn't exist.</p>
        <button
          onClick={() => navigate("/supply-chain/scns")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to SCNs
        </button>
      </div>
    );
  }

  function patch(changes: ScnPatch) {
    if (!scn) return;
    update.mutate({ id: scn.id, patch: changes });
  }

  /** One card's worth of edits, as ONE write — only the keys that changed. */
  function saveFields(changed: Record<string, string>) {
    const changes: ScnPatch = {};
    for (const [key, value] of Object.entries(changed)) {
      const field = scnField(key);
      changes[key] = field?.kind === "date" ? fromDateInputValue(value) : value;
    }
    patch(changes);
  }

  /** Tick or untick one option; the whole array goes, in the column's own order. */
  function toggleCheck(field: ScnField, option: string) {
    if (!scn) return;
    const current = new Set(scn.checks[field.key] ?? []);
    if (current.has(option)) current.delete(option);
    else current.add(option);
    patch({ [field.key]: (field.options ?? []).filter((o) => current.has(o)) });
  }

  function handleAddComment(bodyHtml: string) {
    if (!scn) return;
    // Returned, so a comment that fails to post goes back in the composer.
    return addComment
      .mutateAsync({
        id: scn.id,
        comment: {
          authorName: currentUser.displayName,
          authorEmail: currentUser.email ?? "",
          bodyHtml,
        },
      })
      .then(() => undefined);
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!scn) return;
    await editComment.mutateAsync({
      id: scn.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  /** The picker toggles one person; the write replaces the whole list. */
  function toggled(list: Person[], person: Person): Person[] {
    const key = personKey(person);
    return list.some((p) => personKey(p) === key)
      ? list.filter((p) => personKey(p) !== key)
      : [...list, person];
  }

  const watching = scn.watchers.some((w) => personKey(w) === personKey(currentUser));

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="SCNs" listTo="/supply-chain/scns" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
          <Megaphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {scnLabel(scn)}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <ScnStatusChip status={scn.status} />
            <ScnApprovalChip approvalStatus={scn.approvalStatus} />
            <ScnCategoryChip category={scn.category} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setWatchers.mutate({ id: scn.id, people: toggled(scn.watchers, currentUser) })}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            watching
              ? "border-accent/40 bg-accent/10 text-fg hover:bg-accent/20"
              : "border-border bg-surface text-fg hover:bg-surface-2",
          )}
        >
          {watching ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {watching ? "Unwatch" : "Watch"}
        </button>
        <Link
          to="/supply-chain/scns/documents"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          <FolderOpen className="h-4 w-4" />
          Documents
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          {SCN_SECTIONS.map((section) => (
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
                {scnFieldsInSection(section).map((field) =>
                  field.kind === "multiChoice" ? (
                    <ChecklistField
                      key={field.key}
                      field={field}
                      checked={scn.checks[field.key] ?? []}
                      onToggle={(option) => toggleCheck(field, option)}
                    />
                  ) : (
                    <FieldRow key={field.key} field={field} scn={scn} />
                  ),
                )}
              </div>
            </section>
          ))}

          <AttachmentsSection parent="scn" itemId={scn.id} />

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer
              draftKey={`scn:${scnId}`}
              uploadFile={uploadCommentFile}
              onSubmit={handleAddComment}
              mentionablePeople={mentionCandidates}
            />
            <div className="mt-5">
              <CommentThread
                uploadFile={uploadCommentFile}
                comments={scn.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
                onReply={handleAddComment}
                draftKey={`scn:${scnId}`}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <SidebarGroup title="Workflow">
            <SidebarField label={scnFieldLabel("status")}>
              <ChoiceSelect
                value={scn.status}
                onChange={(v) => patch({ status: v })}
                options={SCN_STATUSES}
                emptyLabel="Not set"
                clearable={false}
                ariaLabel={scnFieldLabel("status")}
              />
            </SidebarField>

            <SidebarField label={scnFieldLabel("approvalStatus")}>
              {/* Two options and required by the column — pills, no Not set. */}
              <ChoicePills
                label={scnFieldLabel("approvalStatus")}
                name="scn-approval-status"
                options={SCN_APPROVAL_STATUSES}
                value={scn.approvalStatus}
                onChange={(v) => patch({ approvalStatus: v })}
              />
            </SidebarField>

            <SidebarField label="Year" icon={<Calendar className="h-3.5 w-3.5" />}>
              <p className="px-1 text-sm text-fg">
                {scn.year || <span className="text-fg-muted">Not set</span>}
              </p>
            </SidebarField>

            <SidebarField label="Raised by" icon={<User className="h-3.5 w-3.5" />}>
              <p className="px-1 text-sm text-fg">
                {scn.createdBy?.displayName ?? <span className="text-fg-muted">Unknown</span>}
                <span className="text-fg-muted"> · {formatSpDate(scn.createdAt)}</span>
              </p>
            </SidebarField>
          </SidebarGroup>

          <SidebarGroup title="People">
            <SidebarField label={scnFieldLabel("assignedTo")}>
              <PersonMultiField
                value={scn.assignedTo}
                allPeople={mentionCandidates}
                onToggle={(p) => setAssigned.mutate({ id: scn.id, people: toggled(scn.assignedTo, p) })}
                emptyLabel="Nobody assigned"
                searchPlaceholder="Assign someone…"
              />
            </SidebarField>

            <SidebarField label={scnFieldLabel("owner")}>
              <PersonMultiField
                value={scn.owner}
                allPeople={mentionCandidates}
                onToggle={(p) => setOwner.mutate({ id: scn.id, people: toggled(scn.owner, p) })}
                emptyLabel="No owner"
                searchPlaceholder="Pick an owner…"
              />
            </SidebarField>

            <SidebarField label="Watchers">
              <PersonMultiField
                value={scn.watchers}
                allPeople={mentionCandidates}
                onToggle={(p) => setWatchers.mutate({ id: scn.id, people: toggled(scn.watchers, p) })}
                emptyLabel="No watchers"
                searchPlaceholder="Add a watcher…"
              />
            </SidebarField>
          </SidebarGroup>

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Last edited {scn.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>

      {editing && (
        <FieldEditModal
          title={`Edit ${editing}`}
          fields={editableFields(editing).map(editSpec)}
          values={editValues(scn, editableFields(editing))}
          onClose={() => setEditing(null)}
          onSave={saveFields}
        />
      )}
    </div>
  );
}

/**
 * The fields a card's Edit modal offers: text, choice and date columns. The
 * checklists are ticked inline, the read-only Task List link is never
 * written, and the person columns live in the sidebar.
 */
function editableFields(section: ScnSection): ScnField[] {
  return scnFieldsInSection(section).filter(
    (f) => !f.readOnly && f.kind !== "multiChoice" && f.kind !== "person" && f.kind !== "link",
  );
}

/** A descriptor → what the shared editor needs to render it. */
function editSpec(field: ScnField): EditableFieldSpec {
  const kind =
    field.kind === "choice"
      ? "choice"
      : field.kind === "date"
        ? "date"
        : field.kind === "multiline"
          ? "multiline"
          : "text";
  return {
    key: field.key,
    label: field.label,
    kind,
    choices: field.options,
    hint: field.maxLength ? `Up to ${field.maxLength} characters.` : undefined,
  };
}

/** The values to seed the editor with — a date as `yyyy-mm-dd`, the rest as text. */
function editValues(scn: Scn, fields: ScnField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.kind === "date") values[field.key] = toDateInputValue(scn.dates[field.key] ?? null);
    else {
      const v = scnValue(scn, field.key);
      values[field.key] = typeof v === "string" ? v : "";
    }
  }
  return values;
}

/** The one way to change the text on a card. */
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

/** One descriptor field, read-only — text, a date, or the Planner link. */
function FieldRow({ field, scn }: { field: ScnField; scn: Scn }) {
  const long = field.kind === "multiline";
  let body: React.ReactNode;
  if (field.kind === "link") {
    body = scn.taskList ? (
      <a
        href={scn.taskList.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-accent underline-offset-2 hover:underline"
      >
        {scn.taskList.description}
        <ExternalLink className="h-3 w-3" />
      </a>
    ) : null;
  } else if (field.kind === "date") {
    const date = scn.dates[field.key] ?? null;
    body = date ? <p className="text-sm tabular-nums text-fg">{formatSpDate(date)}</p> : null;
  } else {
    const value = scnValue(scn, field.key);
    body =
      typeof value === "string" && value ? (
        <p className="whitespace-pre-wrap text-sm text-fg">{value}</p>
      ) : null;
  }
  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {field.label}
      </span>
      {body ?? <p className="text-sm text-fg-muted">Not set</p>}
    </div>
  );
}

/**
 * A multi-choice column as a checklist — every option, ticked or not, in the
 * column's own order, and tickable in place. The count in the header is the
 * progress figure the paper form never had.
 */
function ChecklistField({
  field,
  checked,
  onToggle,
}: {
  field: ScnField;
  checked: string[];
  onToggle: (option: string) => void;
}) {
  const options = field.options ?? [];
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {field.label}
        <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">
          {checked.length}/{options.length}
        </span>
      </legend>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {options.map((option) => {
          const on = checked.includes(option);
          return (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
                on ? "border-accent/40 bg-accent/10 text-fg" : "border-border bg-surface text-fg-muted hover:bg-surface-2",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(option)}
                className="h-3.5 w-3.5 accent-cooper-red"
              />
              {option}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SidebarGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </h3>
      {children}
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
