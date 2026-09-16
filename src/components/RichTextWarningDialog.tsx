import { AlertTriangle } from "lucide-react";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// "Switching to rich text turns off @-mention autocomplete."
//
// Rich text is opt-in per comment, and pressing the button costs something
// real, so it is stated before the switch rather than discovered afterwards
// (Ray, 2026-09-16: "a warning pop up needs to say pressing this disabled the
// @mention feature for this comment. Current Watchers are still notified").
//
// WHY the feature is lost: the @-mention picker reads the CARET POSITION in a
// plain `<textarea>` (`detectMentionQuery(text, caret)`). A rich editor is a
// contentEditable with no equivalent, so there is nothing to drive the
// dropdown from. Anyone already picked before the switch still becomes a
// chip — `injectMentionsIntoHtml` handles that — so the loss is the
// AUTOCOMPLETE, not the mentions already made.
//
// **The watcher line is conditional, because three threads have no watchers.**
// ECNs, Customer Notes and Cost Impact Notices notify the submitter (and
// anyone mentioned) and nobody else — there is no Watchers column on those
// lists. Telling somebody "watchers are still notified" there would be a
// confident lie about the one thing they are being asked to weigh up, so the
// caller says which rule applies via `notifyNote`.
// =============================================================================

export function RichTextWarningDialog({
  /**
   * The headline. Comments lose @-mention autocomplete; a description loses
   * checklists too, so it says something different — a dialog that names the
   * wrong cost is worse than none.
   */
  title = "Rich text turns off @-mention autocomplete",
  /** The body line naming what stops working. */
  detail = "With rich text on, typing @ no longer opens the name picker for this comment, so you can't add a new mention.",
  /**
   * Who still hears about this comment, in the caller's own words. Every
   * thread states its own rule — "watchers" is not universal.
   */
  notifyNote,
  trailing = "Anyone you already picked before switching is still mentioned and still emailed. You can switch back at any time.",
  onConfirm,
  onCancel,
}: {
  title?: string;
  detail?: string;
  notifyNote: string;
  trailing?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const overlayDismiss = useOverlayDismiss(onCancel);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[15vh]"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rich-text-warning-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-start gap-3 p-5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ajax-yellow/15 text-ajax-yellow-fg">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2
              id="rich-text-warning-title"
              className="font-display text-base font-semibold text-fg"
            >
              {title}
            </h2>
            <p className="mt-2 text-sm text-fg-muted">{detail}</p>
            <p className="mt-2 text-sm text-fg-muted">{notifyNote}</p>
            {trailing && <p className="mt-2 text-sm text-fg-muted">{trailing}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-muted"
          >
            Keep plain text
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent/90"
          >
            Use rich text
          </button>
        </div>
      </div>
    </div>
  );
}

/** The usual rule: watchers and assignees hear about a comment regardless. */
export const WATCHERS_STILL_NOTIFIED =
  "Current watchers are still notified, as normal — that doesn't depend on mentions.";

/**
 * For ECNs / Customer Notes / Cost Impact Notices, which have NO Watchers
 * column. Their comments reach the submitter plus anyone mentioned, so losing
 * the picker genuinely narrows who hears — and it says so.
 */
export const SUBMITTER_STILL_NOTIFIED =
  "This list has no watchers: a comment reaches whoever submitted the record, " +
  "plus anyone already mentioned. They are still notified.";
