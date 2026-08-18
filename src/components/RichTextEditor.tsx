import { useEffect, useRef } from "react";
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { cn } from "@/lib/cn";

// =============================================================================
// Small rich-text editor for the EIR long-text fields.
//
// It exists because users couldn't bold anything ("Could not Bold any words",
// Jerrod Waldron, 2026-08-18) — the old Power Apps EIR form had a rich editor,
// and the SharePoint columns behind these fields are Enhanced rich text, so
// the formatting has somewhere real to live.
//
// Deliberately NOT a dependency (Tiptap/Quill/etc). What's needed is bold,
// italic, underline and lists over a field a few paragraphs long;
// contentEditable plus execCommand does that in every browser Altronic runs,
// in a file you can read in one sitting. execCommand is formally deprecated
// but universally implemented, and there is no replacement API — if it ever
// stops working the fallback is a real editor library, not a rewrite of this.
//
// Two rules that keep it safe:
//   - Everything emitted goes through sanitiseHtml, so what reaches SharePoint
//     is the same restricted markup the read path already renders.
//   - The DOM is written from `value` only when the editor doesn't have focus.
//     Re-writing innerHTML mid-type moves the caret to the start, which reads
//     as the field typing backwards.
// =============================================================================

interface RichTextEditorProps {
  /** Current value as HTML. */
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Minimum body height, e.g. "8rem". */
  minHeight?: string;
  "aria-label"?: string;
}

type Command = "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList";

const TOOLS: { command: Command; label: string; icon: React.ReactNode }[] = [
  { command: "bold", label: "Bold", icon: <Bold className="h-3.5 w-3.5" /> },
  { command: "italic", label: "Italic", icon: <Italic className="h-3.5 w-3.5" /> },
  { command: "underline", label: "Underline", icon: <Underline className="h-3.5 w-3.5" /> },
  { command: "insertUnorderedList", label: "Bulleted list", icon: <List className="h-3.5 w-3.5" /> },
  { command: "insertOrderedList", label: "Numbered list", icon: <ListOrdered className="h-3.5 w-3.5" /> },
];

export function RichTextEditor({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  minHeight = "8rem",
  "aria-label": ariaLabel,
}: RichTextEditorProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Push `value` into the DOM only while the user isn't typing in it. On the
  // first render this seeds the editor; afterwards it only matters when the
  // value is replaced from outside (a cancel, a reset after save).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const next = sanitiseHtml(value);
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  function emit() {
    const el = bodyRef.current;
    if (el) onChange(sanitiseHtml(el.innerHTML));
  }

  function run(command: Command) {
    if (disabled) return;
    bodyRef.current?.focus();
    // execCommand is the only cross-browser way to apply formatting to the
    // current selection; there is no modern replacement.
    document.execCommand?.(command);
    emit();
  }

  /**
   * Paste keeps formatting but not the sender's styling — Word and Outlook
   * paste a wall of inline styles and fixed colours, which would render as
   * black-on-black in dark mode. sanitiseHtml already strips `style`/`color`,
   * so pasting through it keeps the bold and the bullets and drops the rest.
   */
  function handlePaste(e: React.ClipboardEvent) {
    if (disabled) return;
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (!html && !text) return;
    e.preventDefault();
    const clean = html
      ? sanitiseHtml(html)
      : text
          .split(/\n{2,}/)
          .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
          .join("");
    document.execCommand?.("insertHTML", false, clean);
    emit();
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-bg focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20",
        disabled && "opacity-60",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-2 px-1.5 py-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.command}
            type="button"
            // mousedown default would blur the editor and drop the selection
            // before the command ever runs.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(tool.command)}
            disabled={disabled}
            title={tool.label}
            aria-label={tool.label}
            className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-50"
          >
            {tool.icon}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10px] uppercase tracking-wider text-fg-muted">
          Ctrl+B / I / U
        </span>
      </div>
      <div
        ref={bodyRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel ?? "Rich text editor"}
        data-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onPaste={handlePaste}
        style={{ minHeight }}
        className="comment-html w-full resize-y overflow-y-auto p-3 text-sm leading-relaxed text-fg focus:outline-none empty:before:text-fg-muted empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
