import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Calendar, PackageSearch, Pencil, User } from "lucide-react";
import {
  collectGrayMarketPeople,
  useAddGrayMarketComment,
  useEditGrayMarketComment,
  useGrayMarketRequest,
  useGrayMarketRequests,
  useSetGrayMarketWatchers,
  useUpdateGrayMarketFields,
} from "@/hooks/useGrayMarketRequests";
import type { Comment, GrayMarketRequest, Person } from "@/types/task";
import {
  GRAY_MARKET_SECTIONS,
  GRAY_MARKET_STATUSES,
  GRAY_MARKET_TESTING_REQUIRED,
  fieldsInSection,
  type GrayMarketField,
  type GrayMarketSection,
} from "@/lib/grayMarketFields";
import { grayMarketFieldPatch, grayMarketLabel } from "@/lib/grayMarketMapper";
import { formatSpDate, fromDateInputValue, toDateInputValue, toSpDateOnly } from "@/lib/spDates";
import { looksLikeHtml } from "@/lib/descriptionChecklist";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { toPlainTextForEditing } from "@/lib/richText";
import { mergePeople } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DateField } from "@/components/DateField";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";
import { GrayMarketStatusChip, TestResultChip } from "@/components/grayMarketAtoms";

// =============================================================================
// One gray market request.
//
// The page is the workflow: Request → Purchasing → Engineering → Inspection →
// Production, one card each, rendered from the descriptor table in
// grayMarketFields.ts. The four teams each fill in their own stage, and a
// stage writes only its own columns, so they don't step on each other.
//
// The page READS; the card's Edit button opens the shared FieldEditModal,
// which writes. It used to edit field by field — an Edit link per text column,
// and choice columns that saved the instant you touched them — which put edit
// affordances in six different places on one card (Ray, 2026-08-19).
//
// Comments, watchers and attachments are the standard ARC set.
// =============================================================================

export function GrayMarketRequestDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const requestId = id ? parseInt(id, 10) : null;
  const { data: request, isLoading } = useGrayMarketRequest(requestId);
  const { data: requests = [] } = useGrayMarketRequests();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const updateFields = useUpdateGrayMarketFields();
  const setWatchers = useSetGrayMarketWatchers();
  const addComment = useAddGrayMarketComment();
  const editComment = useEditGrayMarketComment();

  const mentionCandidates = useMemo(
    () => mergePeople(collectGrayMarketPeople(requests), directory),
    [requests, directory],
  );
  // Which stage's editor is open — one at a time.
  const [editing, setEditing] = useState<GrayMarketSection | null>(null);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the request" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That request doesn't exist.</p>
        <button
          onClick={() => navigate("/supply-chain/gray-market-requests")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to Gray Market Requests
        </button>
      </div>
    );
  }

  function save(
    fields: Record<string, unknown>,
    patch: (r: GrayMarketRequest) => GrayMarketRequest,
  ) {
    if (!request) return;
    updateFields.mutate({ id: request.id, fields, patch });
  }

  /**
   * One stage's worth of edits, as ONE write.
   *
   * The modal hands back only the fields that changed, which matters here
   * beyond tidiness: several of this list's choice columns hold values that
   * have drifted outside their own choice lists, and re-sending one makes
   * SharePoint reject the whole PATCH.
   */
  function saveFields(changed: Record<string, string>) {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changed)) {
      Object.assign(fields, grayMarketFieldPatch(key, value));
    }
    save(fields, (r) => ({ ...r, values: { ...r.values, ...changed } }));
  }

  function handleAddComment(bodyHtml: string) {
    if (!request) return;
    addComment.mutate({
      id: request.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  /** Add or remove one watcher — the picker toggles, the write replaces. */
  function handleWatcherToggle(person: Person) {
    if (!request) return;
    const key = (person.email ?? person.displayName).toLowerCase();
    const watching = request.watchers.some(
      (w) => (w.email ?? w.displayName).toLowerCase() === key,
    );
    const people = watching
      ? request.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...request.watchers, person];
    setWatchers.mutate({ id: request.id, people });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!request) return;
    await editComment.mutateAsync({
      id: request.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar
        category="Gray Market Requests"
        listTo="/supply-chain/gray-market-requests"
      />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <PackageSearch className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {grayMarketLabel(request)}
          </h1>
          <p className="text-sm text-fg-muted">
            {request.title}
            {request.values.partDescription && ` · ${request.values.partDescription}`}
          </p>
        </div>
        <GrayMarketStatusChip status={request.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          {GRAY_MARKET_SECTIONS.map((section) => (
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
                {fieldsInSection(section).map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={request.values[field.key] ?? ""}
                  />
                ))}
              </div>
            </section>
          ))}

          <AttachmentsSection parent="grayMarketRequest" itemId={request.id} />

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer
              onSubmit={handleAddComment}
              mentionablePeople={mentionCandidates}
            />
            <div className="mt-5">
              <CommentThread
                comments={request.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <SidebarField label="Request Status">
            <ChoiceSelect
              value={request.status}
              onChange={(v) => save({ RequestStatus: v }, (r) => ({ ...r, status: v }))}
              options={GRAY_MARKET_STATUSES}
              emptyLabel="Open"
              clearable={false}
            />
          </SidebarField>

          <SidebarField label="Testing Required">
            <ChoiceSelect
              value={request.testingRequired}
              onChange={(v) =>
                save({ ProductionTest: v }, (r) => ({ ...r, testingRequired: v }))
              }
              options={GRAY_MARKET_TESTING_REQUIRED}
              emptyLabel="Not set"
            />
          </SidebarField>

          <SidebarField label="Request Date" icon={<Calendar className="h-3.5 w-3.5" />}>
            <DateField
              value={toDateInputValue(request.requestDate)}
              onChange={(v) => {
                const next = fromDateInputValue(v);
                save({ TodaysDate: toSpDateOnly(next) }, (r) => ({ ...r, requestDate: next }));
              }}
              aria-label="Request Date"
            />
          </SidebarField>

          <SidebarField label="Date Completed" icon={<Calendar className="h-3.5 w-3.5" />}>
            <DateField
              value={toDateInputValue(request.dateCompleted)}
              onChange={(v) => {
                const next = fromDateInputValue(v);
                save({ DateCompleted: toSpDateOnly(next) }, (r) => ({
                  ...r,
                  dateCompleted: next,
                }));
              }}
              aria-label="Date Completed"
            />
          </SidebarField>

          <SidebarField label="Requestor" icon={<User className="h-3.5 w-3.5" />}>
            <p className="px-1 text-sm text-fg">
              {request.requestor?.displayName ?? (
                <span className="text-fg-muted">Not set</span>
              )}
            </p>
          </SidebarField>

          <SidebarField label="Parts Location" icon={<User className="h-3.5 w-3.5" />}>
            <p className="px-1 text-sm text-fg">
              {request.partsLocation?.displayName ?? (
                <span className="text-fg-muted">Not set</span>
              )}
            </p>
          </SidebarField>

          <SidebarField label="Test results">
            <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-fg-muted">
              <span>In circuit</span>
              <TestResultChip result={request.values.inCircuitResults ?? ""} />
              <span>Final assy</span>
              <TestResultChip result={request.values.finalAssyResults ?? ""} />
            </div>
          </SidebarField>

          <SidebarField label="Watchers">
            <PersonMultiField
              value={request.watchers}
              allPeople={mentionCandidates}
              onToggle={handleWatcherToggle}
              emptyLabel="No watchers"
            />
          </SidebarField>

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Raised {formatSpDate(request.requestDate)} · last edited{" "}
            {request.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>

      {editing && (
        <FieldEditModal
          title={`Edit ${editing}`}
          fields={fieldsInSection(editing).map(editSpec)}
          values={editValues(request, fieldsInSection(editing))}
          onClose={() => setEditing(null)}
          onSave={saveFields}
        />
      )}
    </div>
  );
}

/** A descriptor → what the shared editor needs to render it. */
function editSpec(field: GrayMarketField): EditableFieldSpec {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    choices: field.choices,
  };
}

/**
 * The values to seed the editor with.
 *
 * A rich-text column is handed over as PLAIN TEXT — it's stored as HTML, and
 * editing raw `<div class="ExternalClass…">` markup in a textarea is how you
 * corrupt it. `grayMarketFieldPatch` turns it back into paragraphs on save.
 */
function editValues(
  request: GrayMarketRequest,
  fields: GrayMarketField[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = request.values[field.key] ?? "";
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
 * the shared modal do.
 */
function FieldRow({ field, value }: { field: GrayMarketField; value: string }) {
  const long = field.kind === "multiline" || field.kind === "richText";
  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {field.label}
      </span>
      {value ? (
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
