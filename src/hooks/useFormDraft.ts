import { useCallback, useEffect, useRef, useState } from "react";
import { useDraft } from "./useDraft";

// =============================================================================
// A whole form's draft — title AND description together.
//
// Wraps `useDraft` for the create/edit modals (Ray, 2026-09-17: drafts for
// "comments and descriptions. and titles"). One key per form rather than one
// per field, because the fields are saved together and restoring half of one
// is worse than restoring none: a title with no description reads as though
// the description was deliberately cleared.
//
// **CREATE ONLY, by default.** An EDIT form is seeded from the record, and a
// stale draft silently overwriting the real title is the one outcome worse
// than losing a draft — you would be editing text that looks like the record
// and isn't. Callers pass `null` for the key in edit mode.
//
// Values are JSON, so this holds any string fields a form wants. It does NOT
// hold pickers, dates or people: those are cheap to re-choose, they are the
// part most likely to go stale against a changing list, and serialising them
// would mean restoring a project reference that has since been renamed.
// =============================================================================

export interface UseFormDraftResult<T extends Record<string, string>> {
  /** The restored values, or `{}` when there was no draft. */
  initial: Partial<T>;
  /** True while a restored draft is on screen. */
  restored: boolean;
  /** Record the current values. Debounced. */
  save: (values: T) => void;
  /** Forget the draft — call on a successful submit. */
  clear: () => void;
  /** Drop the notice, keep the draft. */
  dismissNotice: () => void;
}

export function useFormDraft<T extends Record<string, string>>(
  draftKey: string | null,
): UseFormDraftResult<T> {
  const draft = useDraft(draftKey);

  // Parse once. A malformed or non-object payload restores nothing rather
  // than throwing a modal away.
  const parsed = useRef<Partial<T> | undefined>(undefined);
  if (parsed.current === undefined) {
    let out: Partial<T> = {};
    if (draft.initialValue) {
      try {
        const raw = JSON.parse(draft.initialValue) as unknown;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          // Keep only string fields — anything else is from an older shape.
          const entries = Object.entries(raw as Record<string, unknown>).filter(
            ([, v]) => typeof v === "string" && v !== "",
          );
          out = Object.fromEntries(entries) as Partial<T>;
        }
      } catch {
        out = {};
      }
    }
    parsed.current = out;
  }

  const hasAny = Object.keys(parsed.current).length > 0;
  const [restored, setRestored] = useState(hasAny && draft.restored);

  // A draft that parsed to nothing shouldn't leave a stored key behind.
  useEffect(() => {
    if (draft.restored && !hasAny) draft.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    (values: T) => {
      const meaningful = Object.entries(values).filter(([, v]) => v.trim() !== "");
      if (meaningful.length === 0) {
        // An empty form is not a draft — otherwise opening and closing a
        // modal leaves one behind that restores itself next time.
        draft.save("");
        return;
      }
      draft.save(JSON.stringify(Object.fromEntries(meaningful)), false);
    },
    [draft],
  );

  const clear = useCallback(() => {
    draft.clear();
    setRestored(false);
  }, [draft]);

  const dismissNotice = useCallback(() => setRestored(false), []);

  return { initial: parsed.current, restored, save, clear, dismissNotice };
}
