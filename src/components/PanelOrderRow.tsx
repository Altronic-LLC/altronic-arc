import { ChevronRight, FolderOpen, Hash, User } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PanelOrder } from "@/types/task";
import { AttachmentIndicator, CommentCount } from "./atoms";
import { PanelOrderStatusBadge } from "./panelAtoms";
import { markAsSeen, useIsMentioned } from "@/hooks/useUnseenMentions";

interface PanelOrderRowProps {
  order: PanelOrder;
  onOpen: (id: number) => void;
}

/**
 * Panel order row in the list view. Same 3-column layout as TaskRow/EirRow
 * so all the department lists feel like the same product — left column is
 * identity, middle is project + people + order numbers, right (lg+) is the
 * most recent comment.
 */
export function PanelOrderRow({ order, onOpen }: PanelOrderRowProps) {
  const lastComment = order.comments[0];
  const hasMention = useIsMentioned(`panelOrder:${order.id}`);
  const rowRef = useRef<HTMLButtonElement>(null);

  // Mark mention as read when the row becomes visible on screen.
  useEffect(() => {
    if (!hasMention || !rowRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        markAsSeen(`panelOrder:${order.id}`);
        observer.disconnect();
      }
    });
    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [hasMention, order.id]);

  return (
    <button
      ref={rowRef}
      onClick={() => onOpen(order.id)}
      className="group flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-all hover:border-fg-muted hover:shadow-md sm:flex-row sm:items-stretch sm:gap-4 sm:p-4"
    >
      {/* Left column: identity. */}
      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <PanelOrderStatusBadge status={order.status} />
          {hasMention && (
            <span className="rounded-full bg-cooper-red px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              Mentioned
            </span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:hidden" />
        </div>
        <div className="font-display text-sm font-semibold leading-snug text-fg">{order.title}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {order.salesOrder && (
            <span className="inline-flex items-center gap-1 font-mono font-semibold uppercase tracking-wider">
              <Hash className="h-3 w-3" />
              SO {order.salesOrder}
            </span>
          )}
          {order.customer && (
            <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              {order.customer}
            </span>
          )}
        </div>
      </div>

      {/* Middle column: project + people + PO. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <FolderOpen className="h-4 w-4 shrink-0 text-fg-muted" />
          {order.projectRef ? (
            <span
              title={order.projectRef.title}
              className="inline-flex max-w-[16rem] truncate rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg"
            >
              {order.projectRef.title || `Project #${order.projectRef.lookupId}`}
            </span>
          ) : (
            <span className="text-fg-muted">No project reference</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 shrink-0 text-fg-muted" />
          <span className="truncate text-fg">
            <span className="text-fg-muted">Engineer · </span>
            {order.engineerAssigned?.displayName || "Unassigned"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          {order.purchaseOrder && <span>PO {order.purchaseOrder}</span>}
          {order.customerReference && (
            <span className="truncate">Ref · {order.customerReference}</span>
          )}
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <CommentCount count={order.comments.length} />
            <AttachmentIndicator has={order.hasAttachments} />
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
          <CommentCount count={order.comments.length} />
          <AttachmentIndicator has={order.hasAttachments} />
        </div>
      </div>

      <ChevronRight className="my-auto hidden h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:block" />
    </button>
  );
}
