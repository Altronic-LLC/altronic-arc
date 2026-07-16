import { useEffect, useRef, useState } from "react";
import { ChevronDown, ClipboardCheck, Eye, Hash, Link2, Printer, Trash2 } from "lucide-react";
import type { BuildRequestItem, Comment, Person } from "@/types/task";
import {
  BUILD_REQUEST_ASSEMBLY_OPTIONS,
  BUILD_REQUEST_DISPOSITIONS,
  BUILD_REQUEST_OPERATIONS_OPTIONS,
  BUILD_REQUEST_PART_STATUSES,
  BUILD_REQUEST_PART_TYPES,
  BUILD_REQUEST_TESTING_OPTIONS,
} from "@/types/task";
import { checklistForPartType, checklistProgress } from "@/lib/buildRequestChecklist";
import {
  useAddBuildRequestItemComment,
  useDeleteBuildRequestItem,
  useEditBuildRequestItemComment,
  useSetBuildRequestItemWatchers,
  useUpdateBuildRequestItemFields,
} from "@/hooks/useBuildRequests";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PartStatusBadge } from "./buildRequestAtoms";
import { MultiSelect } from "./SearchableSelect";
import { PersonMultiField } from "./PersonMultiField";
import { CommentComposer } from "./CommentComposer";
import { CommentThread } from "./CommentThread";
import { AttachmentsSection } from "./AttachmentsSection";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { cn } from "@/lib/cn";
import { markAsSeen, useIsMentioned } from "@/hooks/useUnseenMentions";

interface BuildRequestItemCardProps {
  item: BuildRequestItem;
  /** People directory for watchers + @-mentions (headers + items + admins). */
  mentionCandidates: Person[];
  /** Auto-expand (deep link ?item=<id> from notification emails). */
  defaultExpanded?: boolean;
}

/**
 * One part on the Build Request detail page. Collapsed: a summary row.
 * Expanded: every item field inline-editable, the Part-Type-gated checklist
 * (PCB → data package, Harness → terminals/tooling), multi-choice Assembly /
 * Operations / Testing pickers, per-item watchers, attachments, and the
 * item's own comment thread.
 */
export function BuildRequestItemCard({
  item,
  mentionCandidates,
  defaultExpanded = false,
}: BuildRequestItemCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const currentUser = useCurrentUser();
  const updateFields = useUpdateBuildRequestItemFields();
  const setWatchers = useSetBuildRequestItemWatchers();
  const deleteItem = useDeleteBuildRequestItem();
  const addComment = useAddBuildRequestItemComment();
  const editComment = useEditBuildRequestItemComment();

  const hasMention = useIsMentioned(`buildRequestItem:${item.id}`);
  const cardRef = useRef<HTMLDivElement>(null);

  // Deep-link scroll: when auto-expanded via ?item=, bring the card into view.
  useEffect(() => {
    if (defaultExpanded && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark the item's mention as seen once its card is expanded.
  useEffect(() => {
    if (expanded && hasMention) markAsSeen(`buildRequestItem:${item.id}`);
  }, [expanded, hasMention, item.id]);

  const checklistDefs = checklistForPartType(item.partType);
  const progress = checklistProgress(item.partType, item.checklist);

  function patch(fields: Record<string, unknown>) {
    updateFields.mutate({ id: item.id, fields });
  }

  function handleAddComment(bodyHtml: string) {
    addComment.mutate({
      id: item.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string, renotify: boolean) {
    await editComment.mutateAsync({
      id: item.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      newBodyHtml,
      renotify,
    });
  }

  function handleWatcherToggle(p: Person) {
    const key = (p.email ?? p.displayName).toLowerCase();
    const has = item.watchers.some((w) => (w.email ?? w.displayName).toLowerCase() === key);
    const next = has
      ? item.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...item.watchers, p];
    setWatchers.mutate({ id: item.id, people: next });
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-lg border bg-surface transition-colors",
        expanded ? "border-accent/40" : "border-border hover:border-fg-muted",
      )}
    >
      {/* Summary row — always visible; click to expand/collapse. */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left sm:flex-nowrap"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-fg">{item.partNumber}</span>
            <PartStatusBadge status={item.partStatus} />
            {hasMention && (
              <span className="rounded-full bg-cooper-red px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                Mentioned
              </span>
            )}
            {item.partType && (
              <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {item.partType}
              </span>
            )}
            {checklistDefs.length > 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  progress.done === progress.total
                    ? "border-cooper-green/40 bg-cooper-green/10 text-cooper-green"
                    : "border-border bg-surface-2 text-fg-muted",
                )}
              >
                <ClipboardCheck className="h-3 w-3" />
                {progress.done}/{progress.total}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-sm text-fg-muted">{item.partDesc || "—"}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <Hash className="h-3 w-3" />
            Qty {item.qty ?? "—"}
          </span>
          {item.woNo && <span className="font-mono">WO {item.woNo}</span>}
          {item.comments.length > 0 && <span>{item.comments.length} 💬</span>}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
            {/* Left: fields + comments. */}
            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <InlineText label="Part Number" value={item.partNumber} onSave={(v) => patch({ Title: v })} mono />
                <InlineText label="Qty" value={item.qty != null ? String(item.qty) : ""} onSave={(v) => {
                  const n = parseInt(v, 10);
                  patch({ Qty: Number.isNaN(n) ? null : n });
                }} />
                <InlineText label="WO No." value={item.woNo} onSave={(v) => patch({ WONo_x002e_: v })} mono />
                <InlineText label="Drawing No" value={item.drawingNo} onSave={(v) => patch({ DrawingNo: v })} mono />
                <InlineText label="Drawing Rev" value={item.drawingRev} onSave={(v) => patch({ DrawingRev: v })} mono />
                <InlineText label="Revision Date" value={item.revisionDate} onSave={(v) => patch({ RevisionDate: v })} />
              </div>

              <InlineText
                label="Part Description"
                value={item.partDesc}
                onSave={(v) => patch({ PartDesc: v })}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SelectField
                  label="Part Type"
                  value={item.partType ?? ""}
                  options={BUILD_REQUEST_PART_TYPES}
                  onChange={(v) => patch({ PartType: v || null })}
                />
                <SelectField
                  label="Part Status"
                  value={item.partStatus ?? ""}
                  options={BUILD_REQUEST_PART_STATUSES}
                  onChange={(v) => patch({ Part_x0020_Status: v || null })}
                />
                <SelectField
                  label="Disposition"
                  value={item.disposition ?? ""}
                  options={BUILD_REQUEST_DISPOSITIONS}
                  onChange={(v) => patch({ Disposition: v || null })}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MultiChoiceField
                  label="Assembly"
                  selected={item.assembly}
                  options={BUILD_REQUEST_ASSEMBLY_OPTIONS}
                  onChange={(next) => patch({ Assembly: next })}
                />
                <MultiChoiceField
                  label="Operations"
                  selected={item.operations}
                  options={BUILD_REQUEST_OPERATIONS_OPTIONS}
                  onChange={(next) => patch({ Operations: next })}
                />
                <MultiChoiceField
                  label="Testing"
                  selected={item.testing}
                  options={BUILD_REQUEST_TESTING_OPTIONS}
                  onChange={(next) => patch({ Testing: next })}
                />
              </div>

              {/* Part-Type-gated checklist: PCB → data package, Harness → terminals. */}
              {checklistDefs.length > 0 && (
                <div className="rounded-md border border-border bg-surface-2/50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    {item.partType === "PCB" ? "PCB Data Package Checklist" : "Harness Checklist"}
                    <span className="ml-auto normal-case tracking-normal">
                      {progress.done}/{progress.total} complete
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {checklistDefs.map((def) => (
                      <label
                        key={def.field}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-fg hover:bg-surface"
                      >
                        <input
                          type="checkbox"
                          checked={!!item.checklist[def.field]}
                          onChange={(e) => patch({ [def.field]: e.target.checked })}
                          className="h-4 w-4 rounded border-border"
                        />
                        <span className={cn(item.checklist[def.field] && "text-fg-muted line-through")}>
                          {def.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <TextAreaField
                label="Special Instructions"
                value={item.specialInstructions}
                onSave={(v) => patch({ SpecialInstructions: v })}
              />
              <TextAreaField
                label="Test Plan"
                value={item.testPlan}
                onSave={(v) => patch({ TestPlan: v })}
              />
              <TextAreaField
                label="OP Summary"
                value={item.opSummary}
                onSave={(v) => patch({ OPSummary: v })}
              />
              <TextAreaField
                label="Serial Nos"
                value={item.serialNos}
                onSave={(v) => patch({ SerialNos: v })}
              />

              <AttachmentsSection parent="buildRequestItem" itemId={item.id} />

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  Comments on this part
                </h4>
                <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
                <div className="mt-4">
                  <CommentThread
                    comments={item.comments}
                    currentUserEmail={currentUser.email}
                    mentionablePeople={mentionCandidates}
                    onEdit={handleEditComment}
                  />
                </div>
              </div>
            </div>

            {/* Right: watchers + meta + delete. */}
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  <Eye className="h-3.5 w-3.5" /> Watchers
                </div>
                <PersonMultiField
                  value={item.watchers}
                  allPeople={mentionCandidates}
                  onToggle={handleWatcherToggle}
                  emptyLabel="Nobody is watching this part"
                />
              </div>

              {item.taskRefLookupId != null && (
                <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <Link2 className="h-3.5 w-3.5" />
                  Task Ref:{" "}
                  <a
                    href={`${import.meta.env.BASE_URL}task/${item.taskRefLookupId}`}
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    #{item.taskRefLookupId}
                  </a>
                </div>
              )}

              <div className="text-[11px] leading-relaxed text-fg-muted">
                Added{" "}
                {item.createdAt.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {item.author?.displayName ? ` by ${item.author.displayName}` : ""}
              </div>

              <button
                onClick={() =>
                  window.open(
                    `${import.meta.env.BASE_URL}build-request-item/${item.id}/print`,
                    "_blank",
                  )
                }
                className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
                title="Open a printer-friendly page for this part (production floor copy)"
              >
                <Printer className="h-3.5 w-3.5" />
                Print part
              </button>

              <button
                onClick={() => {
                  if (window.confirm(`Remove part "${item.partNumber}" from this build request?`)) {
                    deleteItem.mutate(item.id);
                  }
                }}
                className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-cooper-red hover:text-cooper-red"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove part
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- small inline-edit helpers (file-local by convention, like EirDetailView's) ----

function InlineText({
  label,
  value,
  onSave,
  mono,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  mono?: boolean;
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
        className={cn("select", mono && "font-mono")}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select">
        <option value="">Not set</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function MultiChoiceField({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: string[];
  options: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <MultiSelect
        allLabel="None"
        searchPlaceholder={`Search ${label.toLowerCase()}…`}
        options={options.map((o) => ({ value: o, label: o }))}
        selected={selected}
        onChange={onChange}
        variant="chips"
      />
    </div>
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
      <AutoGrowTextarea
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
