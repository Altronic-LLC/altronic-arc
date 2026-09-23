import { useState } from "react";
import { Type } from "lucide-react";
import { RichTextEditor } from "./RichTextEditor";
import { RichTextWarningDialog } from "./RichTextWarningDialog";
import { plainTextToHtml } from "@/lib/richText";
import { parseChecklistItems } from "@/lib/descriptionChecklist";
import { cn } from "@/lib/cn";

// =============================================================================
// A long-text field that can switch between plain text and rich text.
//
// For DESCRIPTIONS (the comment composer has its own copy of this, because it
// also owns the @-mention picker and the attachment tray). Plain text is what
// loads; rich text is opt-in per field.
//
// **THE CHECKLIST GUARD IS THE WHOLE REASON THIS ISN'T A PLAIN TOGGLE.**
//
// A description's `- [ ]` lines are parsed LINE BY LINE out of the raw stored
// string (`parseChecklistItems`, on `text.split("\n")`). Rich text wraps
// everything in `<p>`/`<div>` and drops the newlines, so converting a
// description that has checkboxes DELETES EVERY CHECKBOX — silently, and in a
// SharePoint column, so the tick state and its name/time stamps go with them.
// CLAUDE.md flags this exact hazard on `keepsPlainText`.
//
// Two behaviours, and the difference is whether WORK ALREADY EXISTS
// (Ray, 2026-09-16: "No block is if already created but if someone goes to
// enable mention that feature disappears"):
//
//  - **A description that ALREADY HAS checkboxes: BLOCKED.** The button is
//    disabled with the reason on it. There is real work in those ticks —
//    who checked what, and when — and no undo once a rich body is saved over
//    them, so "are you sure" is the wrong shape.
//  - **A description with none: WARNED.** Nothing is at stake yet; the dialog
//    just says the checklist syntax won't be available, and the switch is
//    reversible.
//
// The button is disabled rather than hidden: a control that vanishes reads as
// a bug, and the explanation is the useful part.
// =============================================================================

export function RichTextToggleField({
  value,
  onChange,
  disabled,
  placeholder,
  minHeight = "6.5rem",
  /** The plain-text control to render when rich mode is off. */
  renderPlain,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: string;
  renderPlain: () => React.ReactNode;
  ariaLabel?: string;
}) {
  const [rich, setRich] = useState(false);
  const [warn, setWarn] = useState(false);

  // A description holding checkboxes can't be converted — see the file note.
  const hasChecklist = parseChecklistItems(value) !== null;
  const blocked = hasChecklist && !rich;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => {
            if (rich) setRich(false);
            else setWarn(true);
          }}
          disabled={disabled || blocked}
          aria-pressed={rich}
          title={
            blocked
              ? "Not available while this description has a checklist — rich text would remove the checkboxes."
              : rich
                ? "Back to plain text"
                : "Bold, italic, underline and lists"
          }
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
            rich
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-border bg-surface text-fg-muted hover:text-fg",
            (disabled || blocked) && "cursor-not-allowed opacity-50 hover:text-fg-muted",
          )}
        >
          <Type className="h-3.5 w-3.5" />
          Rich text
        </button>
      </div>

      {rich ? (
        <RichTextEditor
          value={value}
          onChange={onChange}
          disabled={disabled}
          minHeight={minHeight}
          placeholder={placeholder}
          aria-label={ariaLabel}
        />
      ) : (
        renderPlain()
      )}

      {blocked && (
        // Says why the button is off, at the point of use. The title attribute
        // alone isn't enough — it needs a hover, and on a phone there isn't
        // one.
        <p className="text-[11px] text-fg-muted">
          Rich text is unavailable while this description has a checklist —
          formatting it would remove the checkboxes.
        </p>
      )}

      {rich && (
        // At the point of use. The dialog is gone by the time somebody wants
        // a checkbox, and a title attribute needs a hover a phone hasn't got.
        <p className="text-[11px] font-medium text-ajax-yellow-fg">
          Checklists are off in rich text — switch back to plain text to use them.
        </p>
      )}

      {warn && (
        <RichTextWarningDialog
          title="Rich text turns off the checklist function"
          detail="With rich text on, this description can't use the - [ ] checklist syntax, so you won't be able to add checkboxes."
          notifyNote="Everything else about the description is unaffected."
          trailing="Switch back to plain text at any time to use checklists again."
          onConfirm={() => {
            // Carry the draft across as paragraphs rather than discarding it.
            onChange(plainTextToHtml(value));
            setRich(true);
            setWarn(false);
          }}
          onCancel={() => setWarn(false)}
        />
      )}
    </div>
  );
}
