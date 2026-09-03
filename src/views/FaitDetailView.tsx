import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarClock, ClipboardCheck, FolderOpen, Pencil, User } from "lucide-react";
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
// kamNeeded lives in lib/ because the alert chain asks the same question —
// a rule enforced only in a view is a rule that isn't enforced.
import { kamNeeded } from "@/lib/faitSignOff";
import { mergePeople, personKey } from "@/lib/people";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useProjects } from "@/hooks/useTasks";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { useUploadAttachment } from "@/hooks/useAttachments";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";
import { ChoiceSelect, SingleSelect } from "@/components/SearchableSelect";
import { FaitStatusChip, FirstPassChip, SignOffChip } from "@/components/faitAtoms";

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
  // Real upload, not the legacy in-memory blob attachments — same list-item
  // attachment store the "Attachments" card above the comments already uses
  // (parent="fait"), so a screenshot pasted/dropped into a comment survives
  // a refresh instead of vanishing (Ray, 2026-09-03).
  const uploadCommentFile = useUploadAttachment("fait", faitId);
  async function uploadFaitCommentFile(file: File): Promise<{ name: string; webUrl: string }> {
    const uploaded = await uploadCommentFile.mutateAsync(file);
    return { name: uploaded.fileName, webUrl: uploaded.downloadUrl };
  }

  // Which stage's editor is open — one at a time. Status and Project are NOT
  // in here: they're live sidebar controls, see the note on the aside below.
  const [editing, setEditing] = useState<FaitSection | null>(null);

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

  /**
   * Status, from the sidebar picker — saved the moment it's picked.
   *
   * It used to live inside a "Details" edit modal behind an unlabelled pencil,
   * with the sidebar showing only a read-only chip, so the page offered no
   * visible way to move a FAIT along its own workflow and it was reported as
   * "cannot change status" (2026-08-27). Every other workflow record in ARC —
   * gray market requests, EIRs — puts its status picker right here.
   */
  function saveStatus(status: string) {
    save({ Status: status }, (f) => ({ ...f, status }));
  }

  /** The project lookup, same arrangement. A bare integer, null to clear. */
  function saveProject(value: string) {
    const lookupId = value ? parseInt(value, 10) : null;
    save(faitProjectPatch(lookupId), (f) => ({
      ...f,
      parentProject: lookupId ? { lookupId, title: "" } : null,
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
    // The initiator always watches their own FAIT — they raised it, so they
    // hear what happens to it. Refuse to uncheck them here rather than
    // silently letting the picker remove them; the write layer
    // (setFaitWatchers) re-adds them regardless, as defence in depth, but
    // the toast is what tells the person clicking WHY nothing happened.
    if (watching && fait.initiator && personKey(fait.initiator) === key) {
      pushToast({
        message: "The initiator always watches their own FAIT and can't be removed.",
      });
      return;
    }
    const people = watching
      ? fait.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...fait.watchers, person];
    setWatchers.mutate({ id: fait.id, people, initiator: fait.initiator });
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

      {/* Icon + identity in ONE block, chips in another — not five siblings of
          a single flex-wrap row. A wrap point calculated across the title text
          AND the chips at once is what squeezed the Suppliers header into a
          one-word-per-line column on a phone. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
              {fait.values.sapPartNumber || `FAIT #${fait.id}`}
            </h1>
            <p className="text-sm text-fg-muted">
              {fait.values.description || "No description"}
              {fait.values.supplierName && ` · ${fait.values.supplierName}`}
            </p>
          </div>
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
            <CommentComposer
              onSubmit={handleAddComment}
              mentionablePeople={mentionCandidates}
              uploadFile={uploadFaitCommentFile}
            />
            <div className="mt-5">
              <CommentThread
                comments={fait.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
                uploadFile={uploadFaitCommentFile}
              />
            </div>
          </section>
        </div>

        {/* The sidebar is where a FAIT is STEERED: status, project and the
            three people, each saving the moment it changes — the same
            arrangement as every other workflow record in ARC. The five
            workflow cards beside it are the read-then-Edit half of the page.
            Status and Project used to be in a modal behind an unlabelled
            pencil in this header, so the page offered no visible way to move
            a FAIT along (2026-08-27). */}
        <aside className="flex h-fit flex-col gap-4 rounded-xl border border-border bg-surface p-4 lg:sticky lg:top-4">
          <SidebarGroup label="Workflow">
            <SidebarField label="Status">
              <ChoiceSelect
                value={fait.status}
                onChange={saveStatus}
                options={FAIT_STATUSES}
                emptyLabel="Open"
                clearable={false}
                ariaLabel="Status"
              />
            </SidebarField>

            <SidebarField label="Sign-offs">
              <div className="flex flex-wrap gap-1.5 px-1">
                <SignOffChip label="SQE" value={fait.values.sqeSignOff ?? ""} />
                <SignOffChip label="Eng" value={fait.values.engSignOff ?? ""} />
                {/* Hidden entirely when no KAM sign-off is needed — see kamNeeded. */}
                {kamNeeded(fait) && <SignOffChip label="KAM" value={fait.values.kamSignOff ?? ""} />}
              </div>
            </SidebarField>

            <SidebarField label="Project" icon={<FolderOpen className="h-3.5 w-3.5" />}>
              <ChoiceSelect
                value={fait.parentProject ? String(fait.parentProject.lookupId) : ""}
                onChange={saveProject}
                options={projectOptions}
                emptyLabel="No project"
                searchPlaceholder="Search projects…"
                ariaLabel="Project"
              />
              {fait.parentProject && !projectTitle && (
                <p className="mt-1 px-1 text-[11px] text-fg-muted">
                  Project #{fait.parentProject.lookupId} — not in the loaded project list.
                </p>
              )}
            </SidebarField>
          </SidebarGroup>

          <SidebarGroup label="People">
            <SidebarField label="Initiator" icon={<User className="h-3.5 w-3.5" />}>
              <p className="px-1 text-sm text-fg">
                {fait.initiator?.displayName || <span className="text-fg-muted">Not set</span>}
              </p>
              <p className="mt-1 px-1 text-[11px] text-fg-muted">
                Set to whoever raises the FAIT.
              </p>
            </SidebarField>

            <SidebarField label="Assigned Engineer" icon={<User className="h-3.5 w-3.5" />}>
              <PersonPicker
                label="Assigned Engineer"
                selected={fait.assignedEngineer}
                candidates={mentionCandidates}
                onPick={(person) => updateAssignedEngineer.mutate({ id: fait.id, person })}
              />
            </SidebarField>

            <SidebarField label="KAM" icon={<User className="h-3.5 w-3.5" />}>
              <PersonPicker
                label="KAM"
                selected={fait.kam}
                candidates={mentionCandidates}
                onPick={(person) => updateKam.mutate({ id: fait.id, person })}
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
          </SidebarGroup>

          <div className="flex items-start gap-1.5 border-t border-border pt-3 text-[11px] text-fg-muted">
            <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              Raised {fait.createdAt.toLocaleDateString()} · last edited{" "}
              {fait.modifiedAt.toLocaleDateString()}
            </span>
          </div>
        </aside>
      </div>

      {editing && (
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

/**
 * A descriptor → what the shared editor needs to render it.
 *
 * Every kind maps straight across, dates included. They used to edit as free
 * TEXT with a "YYYY-MM-DD" hint, because the shared editor had no date
 * control — and `columnValue` writes `null` for anything it can't parse, so a
 * date typed in any other order (or with a typo) silently cleared the column
 * instead of saving it. The editor has a `date` kind now, backed by the same
 * DateField every other date in ARC uses.
 */
function editSpec(field: FaitField): EditableFieldSpec {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    choices: field.choices,
    hint: field.hint,
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
      {field.key === "notifyInitiator" && (
        // Ray, 2026-09-03: checking this closes the FAIT, once every
        // sign-off it owes is Approved (faitFullySignedOff in
        // lib/faitSignOff.ts) — an incomplete FAIT refuses the write
        // (FaitNotFullySignedOffError in useFaits.ts) rather than closing.
        <p className="mt-1 text-xs text-fg-muted">
          Checking this closes the FAIT and emails the initiator and watchers that all sign-offs
          are complete. It only works once SQE, Engineering and (if one is assigned) KAM have all
          signed off — otherwise the change is refused.
        </p>
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

/**
 * A titled run of sidebar fields.
 *
 * The sidebar was eleven controls and chips in one undivided column, which is
 * why the status picker had nowhere obvious to live. Two groups — what the
 * FAIT IS doing, and who is doing it — give each half a heading you can aim
 * at.
 */
function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * One of the two single-person pickers.
 *
 * **The person already on the FAIT is always an option**, even when they
 * aren't among the candidates — the candidate list is built from the tenant
 * directory plus the people on the loaded FAITs, and a SharePoint person
 * column can hold somebody neither covers: a leaver, or an account whose
 * mailbox differs from the address the directory lists (Steve Pirko signs in
 * as one and receives mail at another). Without the stand-in the picker falls
 * back to its "Not set" placeholder, so an assignment that IS set reads as
 * empty and the next person to touch it overwrites somebody silently. Same
 * reasoning as the Teradyne clock-number stand-in.
 */
function PersonPicker({
  label,
  selected,
  candidates,
  onPick,
}: {
  label: string;
  selected: Person | null;
  candidates: Person[];
  onPick: (person: Person | null) => void;
}) {
  const pool = useMemo(() => {
    if (!selected) return candidates;
    const key = personKey(selected);
    return candidates.some((p) => personKey(p) === key) ? candidates : [selected, ...candidates];
  }, [candidates, selected]);

  return (
    <SingleSelect
      allLabel="Not set"
      searchPlaceholder="Search people…"
      ariaLabel={label}
      options={pool.map((p) => ({
        value: personKey(p),
        label: p.displayName || p.email || "Unknown",
      }))}
      selected={selected ? personKey(selected) : null}
      onChange={(key) => onPick(key ? pool.find((p) => personKey(p) === key) ?? null : null)}
    />
  );
}
