import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface DetailTopBarProps {
  /** Section name shown as the "you are here" label, e.g. "Panel Tasks". */
  category: string;
  /** Route of that section's list — the category chip links to it. */
  listTo: string;
}

/**
 * Standard top bar for every detail page. A Back arrow (returns to wherever
 * the user came from) sits next to the section category rendered as a chip
 * that links to that section's list. On a deep detail page this is the
 * orientation cue — you always know which part of ARC you're in, and can
 * jump straight to its list. Rendered as the first element of each detail
 * view, just beneath the app header.
 */
export function DetailTopBar({ category, listTo }: DetailTopBarProps) {
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
    </div>
  );
}
