import { cn } from "@/lib/cn";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { looksLikeHtml, parseChecklistItems } from "@/lib/descriptionChecklist";

interface DescriptionViewProps {
  text: string;
  /**
   * Called with the line index when a checklist box is clicked. Omit to
   * render read-only checkboxes (print view, or a locked/disabled field).
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
 */
export function DescriptionView({ text, onToggle, className, tone = "theme" }: DescriptionViewProps) {
  const items = parseChecklistItems(text);
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
                onChange={onToggle ? () => onToggle(item.lineIndex) : undefined}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent"
              />
              <span className={cn(item.checked && [mutedColor, "line-through"])}>
                {item.text || <span className={cn("italic", mutedColor)}>(empty item)</span>}
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
    </div>
  );
}
