import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ORIGIN_MARKER_CLASS } from "@/lib/commentMirror";

// =============================================================================
// Making the "open the part to reply" link in a MIRRORED comment route.
//
// A mirrored comment's origin banner is part of the stored HTML body (see
// `lib/commentMirror.ts` for why it has to be), and that body is rendered
// through `dangerouslySetInnerHTML` — so its anchor is a plain `<a href>`
// outside React's tree. Clicked as-is it triggers a FULL PAGE LOAD: the whole
// bundle re-downloads, the MSAL cache is re-read, and anything half-typed
// elsewhere on the page is gone.
//
// The href is deliberately a ROUTER PATH with no origin and no deploy
// sub-path, so it cannot be navigated to directly anyway — it is resolved
// against the router at CLICK time, here.
//
// Delegated from the thread's container rather than bound per anchor, since
// the anchors don't exist as React elements to attach a handler to.
// =============================================================================

/**
 * A click handler for the element wrapping rendered comment bodies.
 *
 * Only intercepts an anchor INSIDE an origin banner. Every other link in a
 * comment — a pasted URL, a mention chip, an attachment — is left completely
 * alone, including the `target="_blank"` links `linkify` produces.
 */
export function useCommentOriginLink(): (e: React.MouseEvent<HTMLElement>) => void {
  // `useNavigate` throws outside a router, so this hook — and therefore
  // `CommentThread` — requires one above it. Every real call site has one
  // (the whole app is inside `BrowserRouter`, the print views included), and
  // a TEST that renders a comment thread must wrap it in a router; that is
  // what `renderWithProviders` already does, and what `CommentThread`'s own
  // test file does explicitly.
  //
  // Reading the navigator out of context to avoid the requirement was tried
  // and reverted: it traded a loud, obvious failure in one test file for a
  // silently dead link in production, which is the wrong way round.
  const navigate = useNavigate();

  return useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      // Let the browser handle a deliberate "open elsewhere": ctrl/cmd-click
      // for a new tab, shift for a window, middle-click, or any modified
      // click. Swallowing those is exactly the complaint that started the
      // draft-persistence work.
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;

      // Only OUR banner's link. `closest` rather than a parent check, because
      // the click may land on text inside the anchor.
      if (!anchor.closest(`.${ORIGIN_MARKER_CLASS}`)) return;

      // `getAttribute`, not `.href` — the latter is resolved by the browser
      // into an absolute URL against the current page, which would defeat the
      // whole point of storing a bare path.
      const path = anchor.getAttribute("href");
      if (!path || !path.startsWith("/")) return;

      e.preventDefault();
      navigate(path);
    },
    [navigate],
  );
}
