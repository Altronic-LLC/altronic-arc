import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileDiff, Pencil, User } from "lucide-react";
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
  type EcnSection,
} from "@/lib/ecnFields";
import { ecnFieldPatch } from "@/lib/ecnMapper";
import { looksLikeHtml } from "@/lib/descriptionChecklist";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { toPlainTextForEditing } from "@/lib/richText";
import { mergePeople } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
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
  // Which card's editor is open — one at a time, keyed by section name plus
  // the pseudo-section "Details" for the Log# / Title pair in the sidebar.
  const [editing, setEditing] = useState<EcnSection | "Details" | null>(null);

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

  /**
   * One card's worth of edits, as ONE write.
   *
   * The modal hands back only the fields that changed, so a card of nine
   * columns PATCHes the two that were touched — and the optimistic patch
   * moves the same keys, so the page reads correctly before the round-trip.
   */
  function saveFields(changed: Record<string, string>) {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changed)) {
      Object.assign(fields, ecnFieldPatch(key, value));
    }
    save(fields, (e) => ({ ...e, values: { ...e.values, ...changed } }));
  }

  /** The Log# and the Title, which are columns of their own rather than descriptors. */
  function saveDetails(changed: Record<string, string>) {
    const fields: Record<string, unknown> = {};
    if ("logNo" in changed) fields.field_2 = changed.logNo.trim();
    if ("title" in changed) fields.Title = changed.title.trim();
    save(fields, (e) => ({
      ...e,
      logNo: "logNo" in changed ? changed.logNo.trim() : e.logNo,
      title: "title" in changed ? changed.title.trim() : e.title,
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
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                  {section}
                </h2>
                <EditButton label={section} onClick={() => setEditing(section)} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ecnFieldsInSection(section).map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={ecn.values[field.key] ?? ""}
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
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Details
            </span>
            <EditButton label="Details" onClick={() => setEditing("Details")} />
          </div>

          <SidebarField label="Log#">
            <p className="px-1 text-sm text-fg">
              {ecn.logNo || <span className="text-fg-muted">Not set</span>}
            </p>
          </SidebarField>

          <SidebarField label="Title">
            <p className="px-1 text-sm text-fg">
              {ecn.title || <span className="text-fg-muted">Not set</span>}
            </p>
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

      {editing === "Details" && (
        <FieldEditModal
          title="Edit Details"
          fields={[
            {
              key: "logNo",
              label: "Log#",
              kind: "text",
              hint: "A revision keeps the number of the notice it revises — 260059R1.",
            },
            { key: "title", label: "Title", kind: "text" },
          ]}
          values={{ logNo: ecn.logNo, title: ecn.title }}
          onClose={() => setEditing(null)}
          onSave={saveDetails}
        />
      )}

      {editing && editing !== "Details" && (
        <FieldEditModal
          title={`Edit ${editing}`}
          fields={ecnFieldsInSection(editing).map((field) =>
            editSpec(field, stockOptions),
          )}
          values={editValues(ecn, ecnFieldsInSection(editing))}
          onClose={() => setEditing(null)}
          onSave={saveFields}
        />
      )}
    </div>
  );
}

/** A descriptor → what the shared editor needs to render it. */
function editSpec(field: EcnField, stockOptions: string[]): EditableFieldSpec {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    choices: field.choices,
    suggestions: field.kind === "suggest" ? stockOptions : undefined,
    hint: field.hint,
  };
}

/**
 * The values to seed the editor with.
 *
 * A rich-text column is handed over as PLAIN TEXT — it's stored as HTML, and
 * editing raw `<div class="ExternalClass…">` markup in a textarea is how you
 * corrupt it. `ecnFieldPatch` turns it back into paragraphs on the way out.
 */
function editValues(ecn: Ecn, fields: EcnField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = ecn.values[field.key] ?? "";
    values[field.key] = field.kind === "richText" ? toPlainTextForEditing(raw) : raw;
  }
  return values;
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

/**
 * One descriptor field, read-only.
 *
 * Nothing on the card commits a change any more — the card's Edit button and
 * the shared modal do. That's the whole point of the rework: a page you read,
 * and one obvious way to change it.
 */
function FieldRow({ field, value }: { field: EcnField; value: string }) {
  const long = field.kind === "richText";
  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {field.label}
      </span>
      {field.kind === "boolean" ? (
        // Spelled out rather than shown as a tick — "Yes" / "No" is what the
        // question asks for, and a checkbox here would look editable.
        <p className="text-sm text-fg">{value === "Yes" ? "Yes" : "No"}</p>
      ) : value ? (
        long && looksLikeHtml(value) ? (
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
