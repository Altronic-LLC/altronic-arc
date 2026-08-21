import { useEffect } from "react";

// =============================================================================
// When a dropdown panel closes.
//
// Every dropdown in ARC used to close two ways only: an outside click, or
// Escape. So after picking in a multi-select — or after opening one and
// changing your mind — the only way out was to click some empty part of the
// page, and tabbing to the next field left the panel hanging open behind you
// (Ray, 2026-08-19: "all drop downs make you click away to close").
//
// The rules now, all in this one hook so no dropdown drifts from the others:
//
//   1. **Focus leaves the control** → close. Tab to the next field, or click
//      into another input, and the panel goes with you.
//   2. **Another dropdown opens** → close. Only one panel is ever open, which
//      matters most on a filter bar with four of them in a row.
//   3. Outside mousedown → close (as before).
//   4. Escape → close — and STOP THERE. See dropdownKeyHandler.
//
// Deliberately NOT closing on mouse-leave: it fires while you're reading a
// long list and your cursor drifts, and it means nothing on a touchscreen —
// which is half of how ARC gets used.
// =============================================================================

/**
 * The one open panel, app-wide.
 *
 * A module-level variable rather than context: dropdowns are scattered across
 * unrelated trees (filter bars, modals, sidebars) and there is exactly one
 * document, so threading a provider through every screen would buy nothing.
 */
let closeCurrent: (() => void) | null = null;

/** Register a panel as the open one, closing whichever was open before. */
export function claimOpenDropdown(close: () => void): void {
  if (closeCurrent && closeCurrent !== close) closeCurrent();
  closeCurrent = close;
}

/** Give up the claim — on close, or on unmount while still open. */
export function releaseOpenDropdown(close: () => void): void {
  if (closeCurrent === close) closeCurrent = null;
}

/** Test seam: forget any claim, so one test's dropdown can't close another's. */
export function resetOpenDropdown(): void {
  closeCurrent = null;
}

/**
 * Wire an open panel to rules 1–4. `containerRef` must wrap BOTH the trigger
 * and the panel, since focus moving between them is movement *within* the
 * control and mustn't close anything.
 */
export function useDropdownClose(
  open: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    claimOpenDropdown(close);
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      releaseOpenDropdown(close);
    };
    // `close` is a stable setState wrapper at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/**
 * The `onKeyDown` handler for the container — rule 4.
 *
 * Escape closes the panel and **stops there**. This used to be a listener on
 * `document`, which meant an open dropdown inside a modal had TWO document
 * listeners waiting on the same key: the dropdown's and the modal's. Escape
 * fired both, so closing a dropdown you'd opened by mistake also closed the
 * dialog and threw away everything typed into it.
 *
 * Alexander Masgras lost a part-filled New Task that way on 2026-08-20 —
 * "hitting escape erases everything from the task you were creating!" — while
 * trying to dismiss the Parent Task menu.
 *
 * Handling it on the container and calling `stopPropagation` keeps the key
 * from reaching the modal at all: React's root sits inside `document`, so
 * stopping the native event there ends its journey. When no panel is open the
 * handler does nothing and Escape reaches the modal as it should — closing a
 * dropdown and closing a dialog are the same keystroke, one step apart.
 */
export function dropdownKeyHandler(open: boolean, close: () => void) {
  return (e: React.KeyboardEvent) => {
    if (!open || e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };
}

/**
 * The `onBlur` handler for the container — rule 1.
 *
 * Spread onto the element `containerRef` points at. React's onBlur is
 * focusout, so it bubbles up from the trigger, the search box and the options.
 *
 * **A blur with no `relatedTarget` is ignored.** That's what you get when the
 * click landed on something unfocusable — the panel's own padding, a
 * scrollbar, the page background — and closing on those would shut the panel
 * mid-use. Real outside clicks are already covered by the mousedown handler;
 * this exists for focus that genuinely went somewhere else, which always
 * names where it went.
 */
export function dropdownBlurHandler(
  containerRef: React.RefObject<HTMLElement | null>,
  close: () => void,
) {
  return (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next) return;
    if (containerRef.current?.contains(next)) return;
    close();
  };
}
