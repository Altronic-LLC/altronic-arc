import { FileClock } from "lucide-react";

// =============================================================================
// "Draft restored from earlier."
//
// Every restored draft is ANNOUNCED. Text appearing in a form by itself is
// indistinguishable from a bug — and worse on a create form, where it looks
// like the record already exists. The user also needs a way to say "not that"
// without selecting it all and deleting.
//
// Shared so the wording and the Discard/Keep pair are identical everywhere
// rather than re-invented per form.
// =============================================================================

export function DraftRestoredNotice({
  onDiscard,
  onKeep,
  /** Extra sentence for what could NOT be restored (attachments, pickers). */
  note,
}: {
  onDiscard: () => void;
  onKeep: () => void;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-2.5 py-1.5 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-fg">
        <FileClock className="h-3.5 w-3.5 shrink-0 text-ajax-yellow-fg" />
        <span>
          Draft restored from earlier.
          {note ? ` ${note}` : ""}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="font-medium text-cooper-red underline-offset-2 hover:underline"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="font-medium text-fg-muted underline-offset-2 hover:underline"
        >
          Keep
        </button>
      </div>
    </div>
  );
}
