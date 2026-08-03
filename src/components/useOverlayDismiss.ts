import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

/**
 * Click-outside-to-dismiss handlers for a modal's backdrop.
 *
 * WHY THIS EXISTS — the bug it fixes:
 *
 * Every modal in the app is an overlay `<div>` with the dialog nested inside
 * it, and the naive dismissal is `onClick={onClose}` on the overlay. That
 * loses users' work, because the browser fires `click` on the nearest common
 * ancestor of `mousedown` and `mouseup` — NOT on the element under the
 * pointer when the button went down. So selecting text in a field and
 * releasing the mouse a few pixels past the dialog's edge (dragging
 * bottom-up or right-to-left, which is how most people highlight backwards)
 * dispatches a `click` whose target is the OVERLAY. The handler reads that as
 * "clicked outside" and throws away everything the user typed.
 *
 * `e.target === e.currentTarget` alone does not save you: on that drag the
 * click's target genuinely IS the overlay. The missing piece is where the
 * interaction STARTED.
 *
 * So we require all three: the press started on the overlay, the release
 * happened on the overlay, and the resulting click targets the overlay. A
 * selection drag that begins or ends inside the dialog fails one of those and
 * is ignored. A clean click on the backdrop passes all three and dismisses,
 * exactly as before.
 *
 * `mousedown`/`mouseup` bubble from inside the dialog up to the overlay (the
 * dialogs only stop propagation on `click`), which is what lets us see where
 * the drag began.
 *
 * Unknown history is treated as "fine to dismiss": a `click` with no
 * `mousedown`/`mouseup` seen (programmatic clicks, some assistive tech,
 * keyboard-synthesised clicks) still closes. We only ever suppress a click we
 * have positive evidence started or ended inside the dialog.
 *
 * Usage — spread onto the overlay element:
 *
 * ```tsx
 * <div className="fixed inset-0 …" {...useOverlayDismiss(onClose, busy)}>
 *   <div onClick={(e) => e.stopPropagation()}>…dialog…</div>
 * </div>
 * ```
 *
 * Escape-to-close is unrelated and stays wherever the modal already handles it.
 *
 * @param onDismiss Called when the backdrop is genuinely clicked.
 * @param disabled  Pass the modal's `busy` flag to block dismissal while saving.
 */
export function useOverlayDismiss(
  onDismiss: () => void,
  disabled = false,
): OverlayDismissHandlers {
  // `null` = not observed. `true` = on the overlay itself. `false` = somewhere
  // inside the dialog (the event bubbled up to us).
  const pressedOverlay = useRef<boolean | null>(null);
  const releasedOverlay = useRef<boolean | null>(null);

  const onMouseDown = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    pressedOverlay.current = e.target === e.currentTarget;
    // A fresh press invalidates the previous release.
    releasedOverlay.current = null;
  }, []);

  const onMouseUp = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    releasedOverlay.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      const startedInsideDialog = pressedOverlay.current === false;
      const endedInsideDialog = releasedOverlay.current === false;
      // Consume the observation either way, so a suppressed drag can't leak
      // into the next interaction.
      pressedOverlay.current = null;
      releasedOverlay.current = null;

      if (disabled) return;
      if (e.target !== e.currentTarget) return;
      if (startedInsideDialog || endedInsideDialog) return;
      onDismiss();
    },
    [disabled, onDismiss],
  );

  return { onMouseDown, onMouseUp, onClick };
}

/** Handlers to spread onto a modal's overlay element. */
export interface OverlayDismissHandlers {
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
  onMouseUp: (e: ReactMouseEvent<HTMLElement>) => void;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
}
