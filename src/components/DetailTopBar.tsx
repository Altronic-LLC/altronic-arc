import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAX_OPEN_ITEMS, OPEN_ITEMS_FULL_MESSAGE } from "@/lib/openItems";
import { closeOpenItem, keepOpen, renameOpenItemLabel, useOpenItems } from "@/hooks/useOpenItems";
import { pushToast } from "@/components/Toast";

interface DetailTopBarProps {
  /** Section name shown as the "you are here" label, e.g. "Panel Tasks". */
  category: string;
  /** Route of that section's list — the category chip links to it. */
  listTo: string;
  /**
   * The record's tab label — offer "Keep open" (BusinessIT#74). Only a RECORD
   * page passes it: a settings or admin screen using this bar has nothing to
   * keep open. Leave it undefined until the record has loaded, so a tab is
   * never saved as "Loading…".
   */
  keepOpenLabel?: string;
}

/**
 * Standard top bar for every detail page. A Back arrow (returns to wherever
 * the user came from) sits next to the section category rendered as a chip
 * that links to that section's list. On a deep detail page this is the
 * orientation cue — you always know which part of ARC you're in, and can
 * jump straight to its list. Rendered as the first element of each detail
 * view, just beneath the app header.
 *
 * A record page also gets **Keep open** on the right, which adds it to the
 * strip of tabs under the header (components/OpenItemsBar).
 */
export function DetailTopBar({ category, listTo, keepOpenLabel }: DetailTopBarProps) {
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex items-center gap-3">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <Link
        to={listTo}
        title={`Go to ${category}`}
        className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-wider text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
      >
        {category}
      </Link>
      {keepOpenLabel?.trim() && <KeepOpenButton label={keepOpenLabel} category={category} />}
    </div>
  );
}

function KeepOpenButton({ label, category }: { label: string; category: string }) {
  const { pathname } = useLocation();
  const items = useOpenItems();
  const kept = items.some((i) => i.path === pathname);
  const full = !kept && items.length >= MAX_OPEN_ITEMS;

  // A kept record's tab follows its title — a renamed task shouldn't keep
  // showing its old name in the strip. Does nothing for a record not kept.
  useEffect(() => {
    if (kept) renameOpenItemLabel(pathname, label);
  }, [kept, pathname, label]);

  function toggle() {
    if (kept) {
      closeOpenItem(pathname);
      return;
    }
    const result = keepOpen({ path: pathname, label, category });
    if (!result.ok && result.reason === "full") pushToast({ message: OPEN_ITEMS_FULL_MESSAGE });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={kept}
      // aria-disabled, not disabled: a disabled button loses its tooltip and
      // leaves the tab order, and the click still explains why (a toast).
      aria-disabled={full || undefined}
      title={
        kept
          ? "Remove this from the tabs under the header"
          : full
            ? OPEN_ITEMS_FULL_MESSAGE
            : "Add this to the tabs under the header, to come back to it in one click"
      }
      className={cn(
        "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
        kept
          ? "border-accent bg-accent/10 text-fg"
          : "border-border text-fg-muted hover:border-fg-muted hover:text-fg",
        full && "cursor-not-allowed opacity-60",
      )}
    >
      {kept ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      {kept ? "Kept open" : "Keep open"}
    </button>
  );
}
