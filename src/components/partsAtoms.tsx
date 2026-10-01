import type { ReactNode } from "react";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { cn } from "@/lib/cn";

// =============================================================================
// Altronic Parts List chips, and the one loading/error gate its three screens
// share — so "SharePoint refused it", "it failed" and "it's empty" read the
// same on the Parts Book, a list and a part page.
// =============================================================================

/**
 * Where a part is in its approval. Nothing is drawn for a blank status in a
 * table — that is every row loaded from the old app, and a column of "Not
 * tracked" chips down 14,000 rows would bury the handful that ARE pending.
 * The detail page explains the blank instead (`showUntracked`).
 */
export function SignOffChip({
  status,
  showUntracked = false,
}: {
  status: string | null;
  showUntracked?: boolean;
}) {
  if (!status) {
    if (!showUntracked) return null;
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
        Not tracked
      </span>
    );
  }
  const approved = status === "Approved";
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        approved
          ? "border-cooper-green/40 bg-cooper-green/10 text-cooper-green"
          : "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg",
      )}
    >
      {status}
    </span>
  );
}

/** The component category, or "Part List" for a non-HCO part. */
export function PartKindChip({ label }: { label: string }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
      {label}
    </span>
  );
}

export interface PartsQueryState {
  isLoading: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Loading / refused / failed, for one or both of the Parts List queries.
 * Renders its children only once every query has loaded without an error.
 *
 * `listNames` names the SharePoint list(s) in the access notice. A refusal of
 * EITHER list is reported — a screen reading both would otherwise show half
 * its parts and say nothing about the other half.
 */
export function PartsDataGate({
  queries,
  listNames,
  noun = "parts",
  children,
}: {
  queries: PartsQueryState[];
  listNames: string;
  noun?: string;
  children: ReactNode;
}) {
  const retry = () => queries.forEach((q) => void q.refetch());
  if (queries.some((q) => q.isLoading)) return <LoadingTasks noun={noun} />;
  const failed = queries.find((q) => q.error);
  if (failed) {
    if (isPermissionDenied(failed.error)) {
      return <ListAccessNotice list={listNames} site="Altronic_Engineering" onRetry={retry} />;
    }
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
        <p className="font-medium text-fg">Couldn't load the parts list.</p>
        <p className="mt-1">{failed.error instanceof Error ? failed.error.message : "Unknown error"}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
        >
          Try again
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
