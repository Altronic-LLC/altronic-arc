import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Calendar, PackageSearch, User } from "lucide-react";
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
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
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
// grayMarketFields.ts. Every field edits in place and saves its own column, so
// the four teams can each fill in their part without opening a form or
// stepping on each other's columns.
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

  function saveField(field: GrayMarketField, value: string) {
    save(grayMarketFieldPatch(field.key, value), (r) => ({
      ...r,
      values: { ...r.values, [field.key]: value },
    }));
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
              <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                {section}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fieldsInSection(section).map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={request.values[field.key] ?? ""}
                    onSave={(value) => saveField(field, value)}
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
    </div>
  );
}

/** One descriptor field, editable in place. */
function FieldRow({
  field,
  value,
  onSave,
}: {
  field: GrayMarketField;
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const long = field.kind === "multiline" || field.kind === "richText";

  function start() {
    // A rich-text column comes back as HTML; edit it as text rather than tags.
    setDraft(field.kind === "richText" ? toPlainTextForEditing(value) : value);
    setEditing(true);
  }

  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          {field.label}
        </span>
        {editing ? (
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
          field.kind !== "choice" && (
            <button
              onClick={start}
              className="text-xs text-accent underline-offset-2 hover:underline"
            >
              Edit
            </button>
          )
        )}
      </div>

      {field.kind === "choice" ? (
        <ChoiceSelect
          value={value}
          onChange={onSave}
          options={field.choices ?? []}
          emptyLabel="Not set"
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
