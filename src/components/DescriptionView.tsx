import { useState } from "react";
import { cn } from "@/lib/cn";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import {
  looksLikeHtml,
  parseChecklistItems,
  type ChecklistItem,
} from "@/lib/descriptionChecklist";

interface DescriptionViewProps {
  text: string;
  /**
   * Called with the line index when a checklist box toggle is CONFIRMED.
   * Omit to render read-only checkboxes (print view, or a locked field).
   */
  onToggle?: (lineIndex: number) => void;
  className?: string;
  /**
   * "theme" (default) uses the app's theme-aware text colors. "print" uses
   * fixed black/grey instead — the printable task view forces a white page
   * regardless of the viewer's dark/light setting, so theme-aware colors
   * could render invisible text there.
   */
  tone?: "theme" | "print";
}

/**
 * Renders a Description-shaped field: if it contains `- [ ]` / `- [x]`
 * checklist lines, each renders as a checkbox (mixed freely with any other
 * lines as plain text); otherwise falls back to the existing behavior —
 * sanitised HTML for legacy Power Apps content, or whitespace-preserved
 * plain text.
 *
 * Items carry a who/when attribution stamp (small detail next to the item —
 * see toggleChecklistItem): ✓ for who checked it, ✗ for who unchecked it.
 * Checking is instant (it just records the stamp); UNchecking asks for
 * confirmation first, so an accidental click doesn't undo recorded work.
 */
export function DescriptionView({ text, onToggle, className, tone = "theme" }: DescriptionViewProps) {
  const items = parseChecklistItems(text);
  const [pending, setPending] = useState<ChecklistItem | null>(null);
  const textColor = tone === "print" ? "text-black" : "text-fg";
  const mutedColor = tone === "print" ? "text-neutral-500" : "text-fg-muted";

  if (!items) {
    return looksLikeHtml(text) ? (
      <div
        className={cn("comment-html", className)}
        dangerouslySetInnerHTML={{ __html: sanitiseHtml(text) }}
      />
    ) : (
      <div className={cn("whitespace-pre-wrap text-sm leading-relaxed", textColor, className)}>
        {text}
      </div>
    );
  }

  const byLine = new Map(items.map((i) => [i.lineIndex, i]));
  const lines = text.split("\n");

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {lines.map((line, i) => {
        const item = byLine.get(i);
        if (item) {
          return (
            <label
              key={i}
              className={cn(
                "flex items-start gap-2 text-sm leading-relaxed",
                textColor,
                onToggle && "cursor-pointer",
              )}
            >
              <input
                type="checkbox"
                checked={item.checked}
                disabled={!onToggle}
                onChange={
                  onToggle
                    ? () =>
                        // Checking is instant; only UNchecking needs a confirm.
                        item.checked ? setPending(item) : onToggle(item.lineIndex)
                    : undefined
                }
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent"
              />
              <span className="min-w-0">
                <span className={cn(item.checked && [mutedColor, "line-through"])}>
                  {item.text || <span className={cn("italic", mutedColor)}>(empty item)</span>}
                </span>
                {item.stamp && (
                  <span
                    className={cn(
                      "ml-2 whitespace-nowrap align-middle text-[11px] no-underline",
                      mutedColor,
                    )}
                  >
                    {item.checked ? "✓" : "✗"} {item.stamp}
                  </span>
                )}
              </span>
            </label>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" aria-hidden="true" />;
        return (
          <div key={i} className={cn("whitespace-pre-wrap text-sm leading-relaxed", textColor)}>
            {line}
          </div>
        );
      })}

      {pending && onToggle && (
        <ConfirmToggleModal
          item={pending}
          onYes={() => {
            onToggle(pending.lineIndex);
            setPending(null);
          }}
          onNo={() => setPending(null)}
        />
      )}
    </div>
  );
}

/**
 * "Are you sure?" guard for UNchecking a box — it undoes recorded work, so
 * it deserves a deliberate click. (Checking is instant, no modal.)
 */
function ConfirmToggleModal({
  item,
  onYes,
  onNo,
}: {
  item: ChecklistItem;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onNo}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="font-display text-base font-semibold text-fg">
          Are you sure you want to uncheck this box?
        </h2>
        <p className="mt-2 break-words text-sm text-fg-muted">
          "{item.text || "(empty item)"}"
          {item.stamp ? ` — it was checked by ${item.stamp}.` : ""}
          {" "}Your name and the current time will be recorded as unchecking it.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onNo}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
          >
            No
          </button>
          <button
            onClick={onYes}
            autoFocus
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
