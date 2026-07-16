import { ChevronRight, FileText, FolderOpen, Package, User } from "lucide-react";
import { useEffect, useRef } from "react";
import type { BuildRequest } from "@/types/task";
import { AttachmentIndicator, CommentCount } from "./atoms";
import { BuildRequestStatusBadge, LeadTimeChip } from "./buildRequestAtoms";
import { markAsSeen, useIsMentioned } from "@/hooks/useUnseenMentions";

interface BuildRequestRowProps {
  br: BuildRequest;
  /** Count of parts on this request (items live in their own query). */
  itemCount: number;
  /** True when the signed-in user has an unseen mention on any of this request's parts. */
  hasItemMention?: boolean;
  onOpen: (id: number) => void;
}

/**
 * Build Request row in the list view — same 3-column layout as EirRow so
 * the Engineering lists all feel like the same product.
 */
export function BuildRequestRow({ br, itemCount, hasItemMention, onOpen }: BuildRequestRowProps) {
  const lastComment = br.comments[0];
  const hasHeaderMention = useIsMentioned(`buildRequest:${br.id}`);
  const hasMention = hasHeaderMention || !!hasItemMention;
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hasHeaderMention || !rowRef.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        markAsSeen(`buildRequest:${br.id}`);
        observer.disconnect();
      }
    });

    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [hasHeaderMention, br.id]);

  return (
    <button
      ref={rowRef}
      onClick={() => onOpen(br.id)}
      className="group flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-all hover:border-fg-muted hover:shadow-md sm:flex-row sm:items-stretch sm:gap-4 sm:p-4"
    >
      {/* Left column: identity. */}
      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <BuildRequestStatusBadge status={br.status} />
          {hasMention && (
            <span className="rounded-full bg-cooper-red px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              Mentioned
            </span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:hidden" />
        </div>
        <div className="font-display text-sm font-semibold leading-snug text-fg">{br.title}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1 font-mono font-semibold uppercase tracking-wider">
            <FileText className="h-3 w-3" />
            {br.brNo || `#${br.id}`}
          </span>
          {br.brType && (
            <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              {br.brType}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadTimeChip leadTime={br.requiredLeadTime} />
          <span className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            <Package className="h-3 w-3" />
            {itemCount} {itemCount === 1 ? "part" : "parts"}
          </span>
        </div>
      </div>

      {/* Middle column: project + people. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start gap-2 text-sm">
          <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
          <ProjectChips br={br} maxVisible={3} />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 shrink-0 text-fg-muted" />
          <span className="truncate text-fg">
            <span className="text-fg-muted">Requestor · </span>
            {br.requestor?.displayName || "—"}
          </span>
        </div>
        <div className="truncate text-sm text-fg">
          <span className="text-fg-muted">Engineer · </span>
          {br.engineerAssigned?.displayName || "Unassigned"}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {br.customerName && (
            <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              {br.customerName}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <CommentCount count={br.comments.length} />
            <AttachmentIndicator has={br.hasAttachments} />
          </div>
        </div>
      </div>

      {/* Right column: last comment preview (lg+ only). */}
      <div className="hidden w-80 shrink-0 flex-col gap-1 lg:flex">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Last Comment
        </div>
        {lastComment ? (
          <>
            <div
              className="line-clamp-2 text-xs text-fg"
              title={lastComment.bodyHtml.replace(/<[^>]+>/g, "")}
            >
              {lastComment.bodyHtml.replace(/<[^>]+>/g, "").trim() || "(empty)"}
            </div>
            <div className="text-[11px] text-fg-muted">
              {lastComment.timestamp.toLocaleString(undefined, {
                month: "numeric",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              by {lastComment.authorName}
            </div>
          </>
        ) : (
          <div className="text-xs text-fg-muted">No comments yet</div>
        )}
        <div className="mt-auto flex items-center gap-3 pt-1">
          <CommentCount count={br.comments.length} />
          <AttachmentIndicator has={br.hasAttachments} />
        </div>
      </div>

      <ChevronRight className="my-auto hidden h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:block" />
    </button>
  );
}

/** Multi-project chips with "+N more" overflow — same idea as EirRow's. */
function ProjectChips({ br, maxVisible }: { br: BuildRequest; maxVisible: number }) {
  const all = br.parentProjects
    .map((p) => p.title || `Project #${p.lookupId}`)
    .filter(Boolean);
  if (all.length === 0) return <span className="text-fg-muted">—</span>;
  const visible = all.slice(0, maxVisible);
  const overflow = all.length - visible.length;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {visible.map((label) => (
        <span
          key={label}
          title={label}
          className="inline-flex max-w-[14rem] truncate rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg"
        >
          {label}
        </span>
      ))}
      {overflow > 0 && (
        <span
          title={all.slice(maxVisible).join("\n")}
          className="inline-flex rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] font-medium text-fg-muted"
        >
          +{overflow} more
        </span>
      )}
    </div>
  );
}
