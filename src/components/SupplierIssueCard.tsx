import { useEffect, useRef, useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import {
  SUPPLIER_ISSUE_SEVERITIES,
  SUPPLIER_ISSUE_STATUSES,
  type Comment,
  type Person,
  type SupplierIssue,
} from "@/types/task";
import {
  useAddSupplierIssueComment,
  useEditSupplierIssueComment,
  useSetSupplierIssueWatchers,
  useUpdateSupplierIssueFields,
} from "@/hooks/useSupplierIssues";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supplierIssueLabel } from "@/lib/supplierIssueMapper";
import { PersonMultiField } from "./PersonMultiField";
import { ChoiceSelect } from "./SearchableSelect";
import { CommentComposer } from "./CommentComposer";
import { CommentThread } from "./CommentThread";
import { AttachmentsSection } from "./AttachmentsSection";
import { cn } from "@/lib/cn";

interface SupplierIssueCardProps {
  issue: SupplierIssue;
  mentionCandidates: Person[];
  /** Auto-expand (deep link ?issue=<id> from notification emails). */
  defaultExpanded?: boolean;
}

/**
 * One issue on the Supplier detail page — same collapsed/expanded shape as
 * `SupplierContactCard` and `BuildRequestItemCard`. No delete: an issue is a
 * record that something happened, closed by resolving it.
 */
export function SupplierIssueCard({
  issue,
  mentionCandidates,
  defaultExpanded = false,
}: SupplierIssueCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const currentUser = useCurrentUser();
  const updateFields = useUpdateSupplierIssueFields();
  const setWatchers = useSetSupplierIssueWatchers();
  const addComment = useAddSupplierIssueComment();
  const editComment = useEditSupplierIssueComment();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (defaultExpanded && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(changed: Parameters<typeof updateFields.mutate>[0]["changed"]) {
    updateFields.mutate({ id: issue.id, changed });
  }

  function handleAddComment(bodyHtml: string) {
    addComment.mutate({
      id: issue.id,
      comment: { authorName: currentUser.displayName, authorEmail: currentUser.email ?? "", bodyHtml },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    await editComment.mutateAsync({
      id: issue.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  function handleWatcherToggle(p: Person) {
    const key = (p.email ?? p.displayName).toLowerCase();
    const has = issue.watchers.some((w) => (w.email ?? w.displayName).toLowerCase() === key);
    const next = has
      ? issue.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...issue.watchers, p];
    setWatchers.mutate({ id: issue.id, people: next });
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-lg border bg-surface transition-colors",
        expanded ? "border-accent/40" : "border-border hover:border-fg-muted",
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left sm:flex-nowrap"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-fg">{supplierIssueLabel(issue)}</span>
            {issue.status && (
              <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {issue.status}
              </span>
            )}
            {issue.severity && (
              <span className="inline-flex items-center rounded border border-cooper-red/30 bg-cooper-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cooper-red">
                {issue.severity}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-sm text-fg-muted">{issue.description || "—"}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-fg-muted">
          {issue.comments.length > 0 && <span>{issue.comments.length} 💬</span>}
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <InlineText label="Title" value={issue.title} onSave={(v) => patch({ title: v })} />

              <TextAreaField
                label="Description"
                value={issue.description}
                onSave={(v) => patch({ description: v })}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold uppercase tracking-wider text-fg-muted">Status</span>
                  <ChoiceSelect
                    value={issue.status ?? ""}
                    onChange={(v) => patch({ status: (v || null) as SupplierIssue["status"] })}
                    options={SUPPLIER_ISSUE_STATUSES}
                    emptyLabel="Not set"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold uppercase tracking-wider text-fg-muted">Severity</span>
                  <ChoiceSelect
                    value={issue.severity ?? ""}
                    onChange={(v) => patch({ severity: (v || null) as SupplierIssue["severity"] })}
                    options={SUPPLIER_ISSUE_SEVERITIES}
                    emptyLabel="Not set"
                  />
                </label>
              </div>

              <TextAreaField
                label="Resolution"
                value={issue.resolution}
                onSave={(v) => patch({ resolution: v })}
              />

              <AttachmentsSection parent="supplierIssue" itemId={issue.id} />

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  Comments
                </h4>
                <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
                <div className="mt-4">
                  <CommentThread
                    comments={issue.comments}
                    currentUserEmail={currentUser.email}
                    currentUserName={currentUser.displayName}
                    mentionablePeople={mentionCandidates}
                    onEdit={handleEditComment}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  <Eye className="h-3.5 w-3.5" /> Watchers
                </div>
                <PersonMultiField
                  value={issue.watchers}
                  allPeople={mentionCandidates}
                  onToggle={handleWatcherToggle}
                  emptyLabel="Nobody is watching this issue"
                />
              </div>

              <div className="text-[11px] leading-relaxed text-fg-muted">
                Logged{" "}
                {issue.createdAt.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineText({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(value);
        }}
        className="select"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        rows={2}
        className="w-full resize-y rounded-md border border-border bg-bg p-2.5 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
      />
    </label>
  );
}
