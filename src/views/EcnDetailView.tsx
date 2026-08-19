import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileDiff, User } from "lucide-react";
import {
  collectEcnPeople,
  useAddEcnComment,
  useEcn,
  useEcns,
  useEditEcnComment,
  useUpdateEcnFields,
} from "@/hooks/useEcns";
import type { Comment, Ecn } from "@/types/task";
import {
  ECN_SECTIONS,
  ecnFieldsInSection,
  stockDispositions,
  type EcnField,
} from "@/lib/ecnFields";
import { ecnFieldPatch } from "@/lib/ecnMapper";
import { looksLikeHtml } from "@/lib/descriptionChecklist";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { toPlainTextForEditing } from "@/lib/richText";
import { mergePeople } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { SuggestInput } from "@/components/SuggestInput";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { EcnFlagChip, EcnOnHoldChip } from "@/components/ecnAtoms";

// =============================================================================
// One ECN.
//
// Change → Disposition → Sign-off, one card each, rendered from the descriptor
// table in ecnFields.ts. Every field edits in place and saves its own column.
//
// The comment thread is the standard one with ONE difference, and the page
// says so out loud above the composer: there are no watchers, so a comment
// reaches the person who submitted the ECN and anyone @-mentioned. Telling
// people who will hear them matters more here than anywhere else in ARC,
// because the rule is different from every other screen they use.
// =============================================================================

export function EcnDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ecnId = id ? parseInt(id, 10) : null;
  const { data: ecn, isLoading } = useEcn(ecnId);
  const { data: ecns = [] } = useEcns();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const updateFields = useUpdateEcnFields();
  const addComment = useAddEcnComment();
  const editComment = useEditEcnComment();

  const mentionCandidates = useMemo(
    () => mergePeople(collectEcnPeople(ecns), directory),
    [ecns, directory],
  );
  const stockOptions = useMemo(
    () => stockDispositions(ecns.map((e) => e.values.inHouseStock ?? "")),
    [ecns],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the ECN" />
      </div>
    );
  }

  if (!ecn) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That ECN doesn't exist.</p>
        <button
          onClick={() => navigate("/engineering/ecns")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to ECNs
        </button>
      </div>
    );
  }

  function save(fields: Record<string, unknown>, patch: (e: Ecn) => Ecn) {
    if (!ecn) return;
    updateFields.mutate({ id: ecn.id, fields, patch });
  }

  function saveField(field: EcnField, value: string) {
    save(ecnFieldPatch(field.key, value), (e) => ({
      ...e,
      values: { ...e.values, [field.key]: value },
    }));
  }

  function handleAddComment(bodyHtml: string) {
    if (!ecn) return;
    addComment.mutate({
      id: ecn.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!ecn) return;
    await editComment.mutateAsync({
      id: ecn.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  const submitter = ecn.submittedBy?.displayName;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="ECNs" listTo="/engineering/ecns" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <FileDiff className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {ecn.logNo ? `ECN ${ecn.logNo}` : `ECN #${ecn.id}`}
          </h1>
          <p className="text-sm text-fg-muted">{ecn.title || "No title"}</p>
        </div>
        <EcnOnHoldChip onHold={ecn.values.onHold ?? ""} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          {ECN_SECTIONS.map((section) => (
            <section
              key={section}
              className="rounded-xl border border-border bg-surface p-4 sm:p-5"
            >
              <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                {section}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ecnFieldsInSection(section).map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={ecn.values[field.key] ?? ""}
                    stockOptions={stockOptions}
                    onSave={(value) => saveField(field, value)}
                  />
                ))}
              </div>
            </section>
          ))}

          <AttachmentsSection parent="ecn" itemId={ecn.id} />

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <p className="mb-3 text-[11px] text-fg-muted">
              {submitter
                ? `Posting here emails ${submitter}, who submitted this ECN, and anyone you @-mention. ECNs have no watchers.`
                : "Posting here emails anyone you @-mention. ECNs have no watchers."}
            </p>
            <CommentComposer
              onSubmit={handleAddComment}
              mentionablePeople={mentionCandidates}
            />
            <div className="mt-5">
              <CommentThread
                comments={ecn.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <SidebarField label="Log#">
            <InlineText
              value={ecn.logNo}
              placeholder="Not set"
              ariaLabel="Log#"
              onSave={(v) => save({ field_2: v.trim() }, (e) => ({ ...e, logNo: v.trim() }))}
            />
          </SidebarField>

          <SidebarField label="Title">
            <InlineText
              value={ecn.title}
              placeholder="Not set"
              ariaLabel="Title"
              onSave={(v) => save({ Title: v.trim() }, (e) => ({ ...e, title: v.trim() }))}
            />
          </SidebarField>

          <SidebarField label="Submitted by" icon={<User className="h-3.5 w-3.5" />}>
            <p className="px-1 text-sm text-fg">
              {submitter ?? <span className="text-fg-muted">Unknown</span>}
            </p>
          </SidebarField>

          <SidebarField label="Flags">
            <div className="flex flex-wrap gap-1.5 px-1">
              <EcnFlagChip
                label="Field returns"
                value={ecn.values.fieldReturnsImpacted ?? ""}
                tone="warn"
              />
              <EcnFlagChip
                label="Drawings"
                value={ecn.values.drawingsComplete ?? ""}
                tone="good"
              />
            </div>
          </SidebarField>

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Added {ecn.createdAt.toLocaleDateString()} · last edited{" "}
            {ecn.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** One descriptor field, editable in place. */
function FieldRow({
  field,
  value,
  stockOptions,
  onSave,
}: {
  field: EcnField;
  value: string;
  stockOptions: string[];
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const long = field.kind === "richText";

  function start() {
    // A rich-text column comes back as HTML; edit it as text rather than tags.
    setDraft(field.kind === "richText" ? toPlainTextForEditing(value) : value);
    setEditing(true);
  }

  // The controls that ARE the value need no Edit/Save dance.
  const selfEditing = field.kind === "boolean" || field.kind === "choice" || field.kind === "suggest";

  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          {field.label}
        </span>
        {!selfEditing &&
          (editing ? (
            <span className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setEditing(false)}
                className="text-fg-muted underline-offset-2 hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onSave(draft);
                  setEditing(false);
                }}
                className="font-medium text-accent underline-offset-2 hover:underline"
              >
                Save
              </button>
            </span>
          ) : (
            <button
              onClick={start}
              className="text-xs text-accent underline-offset-2 hover:underline"
            >
              Edit
            </button>
          ))}
      </div>

      {field.kind === "boolean" ? (
        <label className="inline-flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={value === "Yes"}
            onChange={(e) => onSave(e.target.checked ? "Yes" : "")}
            aria-label={field.label}
            className="h-4 w-4 rounded border-border accent-cooper-red"
          />
          {value === "Yes" ? "Yes" : "No"}
        </label>
      ) : field.kind === "choice" ? (
        <ChoiceSelect
          value={value}
          onChange={onSave}
          options={field.choices ?? []}
          emptyLabel="Not set"
        />
      ) : field.kind === "suggest" ? (
        <SuggestInput
          value={value}
          onChange={onSave}
          options={stockOptions}
          ariaLabel={field.label}
        />
      ) : editing ? (
        long ? (
          <AutoGrowTextarea
            style={{ minHeight: "5rem" }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            aria-label={field.label}
            className="input resize-y"
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={field.label}
            className="input"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSave(draft);
                setEditing(false);
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
        )
      ) : value ? (
        field.kind === "richText" && looksLikeHtml(value) ? (
          <div
            className="comment-html text-sm leading-relaxed text-fg"
            dangerouslySetInnerHTML={{ __html: sanitiseHtml(value) }}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-fg">{value}</p>
        )
      ) : (
        <p className="text-sm text-fg-muted">Not set</p>
      )}
    </div>
  );
}

/** A one-line value in the sidebar that edits in place. */
function InlineText({
  value,
  placeholder,
  ariaLabel,
  onSave,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="w-full rounded px-1 py-0.5 text-left text-sm text-fg transition-colors hover:bg-surface-2"
        aria-label={`Edit ${ariaLabel}`}
      >
        {value || <span className="text-fg-muted">{placeholder}</span>}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onSave(draft);
          setEditing(false);
        }
        if (e.key === "Escape") setEditing(false);
      }}
      className="input"
    />
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
