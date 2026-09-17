import { useCallback, useEffect, useRef, useState } from "react";

// =============================================================================
// Keeping what you typed when you navigate away.
//
// Reported by Alexander Masgras, 2026-09-17: he references other tasks while
// writing a comment, goes to look one up, and loses the comment — "sometimes
// multiple paragraphs, full lists". The original request was for ctrl+click to
// open Back in a new tab; the real problem is that a half-written draft lives
// in component state and dies the moment the view unmounts.
//
// **localStorage, not a store.** Redux (or lifting the state a layer) would
// survive NAVIGATION and nothing else — a refresh, a crashed tab or a closed
// browser still loses the draft, which is most of what people actually want
// protection from. localStorage survives all four, is per-browser-profile
// (a draft is yours, not the record's), and ARC already uses it for the
// theme.
//
// Three rules that make a restored draft helpful rather than unsettling:
//
//  - **It is announced.** Text appearing in a box by itself is indistinguish-
//    able from a bug, so every caller shows a "draft restored" line with a way
//    to discard it. The hook reports `restored` for exactly that.
//  - **It is cleared on a successful save.** Otherwise a draft resurrects over
//    the thing it became.
//  - **It expires.** A draft abandoned last month reappearing is noise, not
//    help. `MAX_AGE_MS` is 7 days.
//
// **Attachments are NOT persisted.** A `File` can't be serialised, and
// pretending otherwise would restore a comment whose attachments silently
// vanished. Callers say so in the restored-draft notice.
// =============================================================================

const PREFIX = "arc:draft:";

/** Older than this and a draft is noise rather than help. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** How long typing pauses before the draft is written. */
const SAVE_DELAY_MS = 500;

interface StoredDraft {
  /** The draft value. Plain text, or HTML when `rich` is true. */
  value: string;
  /** Was this typed in rich-text mode? The mode is part of the draft. */
  rich?: boolean;
  /** When it was last written, for the age check. */
  at: number;
}

function keyFor(draftKey: string): string {
  return `${PREFIX}${draftKey}`;
}

/**
 * Read a stored draft, or null.
 *
 * Every access is wrapped: `localStorage` THROWS in a private window, with
 * site data blocked, and during a thumbnail capture — and a detail page must
 * not fail to render because a draft couldn't be read.
 */
function readDraft(draftKey: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(draftKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const draft = parsed as Partial<StoredDraft>;
    if (typeof draft.value !== "string" || !draft.value) return null;
    if (typeof draft.at !== "number" || Date.now() - draft.at > MAX_AGE_MS) {
      // Expired — clear it rather than leaving it to be re-checked for ever.
      try {
        localStorage.removeItem(keyFor(draftKey));
      } catch {
        /* nothing to do */
      }
      return null;
    }
    return { value: draft.value, rich: draft.rich === true, at: draft.at };
  } catch {
    return null;
  }
}

function writeDraft(draftKey: string, draft: StoredDraft): void {
  try {
    localStorage.setItem(keyFor(draftKey), JSON.stringify(draft));
  } catch {
    // Quota exceeded, or storage blocked. A lost draft is the status quo, so
    // failing quietly is correct — there is nothing useful to tell the user
    // here, and a toast on every keystroke would be worse than the problem.
  }
}

function removeDraft(draftKey: string): void {
  try {
    localStorage.removeItem(keyFor(draftKey));
  } catch {
    /* nothing to do */
  }
}

export interface UseDraftResult {
  /** The restored draft's value, or "" when there wasn't one. */
  initialValue: string;
  /** Was the restored draft written in rich-text mode? */
  initialRich: boolean;
  /** True while a restored draft is on screen and hasn't been discarded. */
  restored: boolean;
  /** Record the current value. Debounced; pass `rich` when in rich mode. */
  save: (value: string, rich?: boolean) => void;
  /** Forget the draft — call after a successful post, or on Discard. */
  clear: () => void;
  /** Drop the "restored" notice without touching the stored draft. */
  dismissNotice: () => void;
}

/**
 * Persist one field's draft under `draftKey`.
 *
 * **`draftKey` must identify the FIELD AND THE RECORD** — `"task:47:comment"`,
 * not `"comment"`. Without the record in the key every composer in ARC shares
 * one draft, and opening task B shows the half-written comment for task A.
 *
 * Pass `null` to disable persistence entirely (a form with no record yet, say)
 * — the hook then behaves as if there were never a draft.
 */
export function useDraft(draftKey: string | null): UseDraftResult {
  // Read ONCE, on mount: re-reading on every render would fight the user's
  // own typing, and the restored value is only ever needed as an initial.
  const initial = useRef<StoredDraft | null | undefined>(undefined);
  if (initial.current === undefined) {
    initial.current = draftKey ? readDraft(draftKey) : null;
  }

  const [restored, setRestored] = useState(initial.current !== null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush a pending write on unmount — navigating away is the exact moment
  // this feature exists for, and the debounce would otherwise swallow the
  // last half-second of typing.
  const pending = useRef<StoredDraft | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current && draftKey) writeDraft(draftKey, pending.current);
    },
    [draftKey],
  );

  const save = useCallback(
    (value: string, rich = false) => {
      if (!draftKey) return;
      if (!value.trim()) {
        // An emptied box means "no draft", not "a draft of nothing" —
        // otherwise clearing the field leaves a draft that restores itself.
        pending.current = null;
        if (timer.current) clearTimeout(timer.current);
        removeDraft(draftKey);
        return;
      }
      const draft: StoredDraft = { value, rich, at: Date.now() };
      pending.current = draft;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        writeDraft(draftKey, draft);
        pending.current = null;
      }, SAVE_DELAY_MS);
    },
    [draftKey],
  );

  const clear = useCallback(() => {
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    if (draftKey) removeDraft(draftKey);
    setRestored(false);
  }, [draftKey]);

  const dismissNotice = useCallback(() => setRestored(false), []);

  return {
    initialValue: initial.current?.value ?? "",
    initialRich: initial.current?.rich ?? false,
    restored,
    save,
    clear,
    dismissNotice,
  };
}

/** Exported for tests and for a "clear all drafts" action, if one is ever wanted. */
export const DRAFT_STORAGE_PREFIX = PREFIX;
export const DRAFT_MAX_AGE_MS = MAX_AGE_MS;
