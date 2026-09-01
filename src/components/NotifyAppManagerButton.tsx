import { useEffect, useState } from "react";
import { LifeBuoy, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { sendErrorReport } from "@/api/errorReport";
import {
  clearRecentErrors,
  getRecentErrors,
  type CapturedError,
} from "@/lib/errorBuffer";
import { pushToast } from "@/components/Toast";
import { APP_MANAGER_EMAIL } from "@/api/config";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// "Notify app manager" button + modal. Lives in the Header so it's reachable
// from every screen. Clicking it captures whatever console errors have
// accumulated in the in-memory buffer (see src/lib/errorBuffer.ts), shows
// the user a chance to describe what they were trying to do, and emails it
// all to the app maintainer with the reporter CC'd.
//
// Designed to fail-soft: if Graph sendMail fails, the toast tells the user
// the description was logged to console and asks them to send a screenshot
// instead. We never want a reporting button to itself produce an error the
// user can't recover from.
// =============================================================================

export function NotifyAppManagerButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Notify app manager about an issue"
        aria-label="Notify app manager"
        className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <LifeBuoy className="h-4 w-4" />
        <span className="hidden md:inline">Report issue</span>
      </button>
      {open && <NotifyAppManagerModal onClose={() => setOpen(false)} />}
    </>
  );
}

function NotifyAppManagerModal({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser();
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  // Snapshot the buffer at modal-open time so the list the user sees in the
  // preview matches exactly what gets sent — even if more errors stream in
  // while they're typing.
  const [captured] = useState<CapturedError[]>(() => getRecentErrors());
  const [showCaptured, setShowCaptured] = useState(false);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !sending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  // Two send paths:
  //   1. Signed in → Graph sendMail via the shared mailbox (preferred, no
  //      user action needed beyond clicking Send).
  //   2. Not signed in → open a mailto: draft in the user's default mail
  //      client. We can't post to Graph without a token, but the sign-in
  //      screen is also exactly where users are most likely to hit
  //      something they need to report. So this is the fallback that
  //      keeps the button useful on the unauthenticated landing page.
  const useMailto = !user.email;

  async function handleSend() {
    if (sending) return;
    setSending(true);
    const pageUrl = typeof window !== "undefined" ? window.location.href : "(unknown)";
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)";

    if (useMailto) {
      openMailtoDraft({
        description: description.trim(),
        captured,
        pageUrl,
        userAgent,
      });
      clearRecentErrors();
      pushToast({
        message: "Opened a draft in your email client — please review and send.",
      });
      onClose();
      return;
    }

    try {
      await sendErrorReport({
        description: description.trim(),
        reporter: user,
        captured,
        pageUrl,
        userAgent,
      });
      clearRecentErrors();
      pushToast({
        message: "Report sent to the app manager. You'll get a copy by email.",
      });
      onClose();
    } catch (err) {
      // Graph send failed (usually a shared-mailbox permission/config issue
      // — 404 ErrorItemNotFound, 403 Forbidden, or 401 SessionExpired). The
      // report itself is too important to drop on the floor, so fall back
      // to opening a mailto: draft in the user's own mail client. The
      // maintainer still gets the message; the user's mailbox is the
      // From address; we don't need any Exchange config to work for this
      // path to succeed.
      // eslint-disable-next-line no-console
      console.error("[notifyAppManager] Graph send failed, opening mailto fallback:", err);
      openMailtoDraft({
        description: description.trim(),
        captured,
        pageUrl,
        userAgent,
      });
      clearRecentErrors();
      pushToast({
        message:
          "Direct send failed — opened a draft in your email client. Please review and send.",
      });
      onClose();
    }
  }

  // Dismiss on a genuine backdrop click only — never when a text-selection
  // drag merely happens to end out here (see useOverlayDismiss). Losing a
  // half-typed bug report to a backwards highlight is exactly the kind of
  // thing people then can't be bothered to report twice.
  const overlayDismiss = useOverlayDismiss(onClose, sending);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      {...overlayDismiss}
    >
      {/*
        Capped to the viewport with the BODY scrolling inside, not the whole
        dialog: the description box grows with what you type, and without this
        a long report pushed the Send button off the bottom of the screen.
      */}
      <div
        role="dialog"
        aria-labelledby="notify-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="notify-title" className="text-base font-semibold text-fg">
              Report an issue
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              Describe what went wrong. Any browser console errors will be attached
              automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="scroll-elegant flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">
              What were you trying to do?
            </span>
            {/* Grows with the description — people writing out what they did
                shouldn't be typing into a three-line letterbox. `resize-y` is
                deliberately absent: the height is managed. */}
            <AutoGrowTextarea
              autoFocus
              style={{ minHeight: "8rem" }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="e.g. I tried to drag a card to In Progress on the Kanban and the page reloaded."
              className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent sm:text-sm"
            />
          </label>

          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <div className="text-fg-muted">
                <span className="font-medium text-fg">{captured.length}</span>{" "}
                console {captured.length === 1 ? "entry" : "entries"} captured this
                session.
              </div>
              <button
                type="button"
                onClick={() => setShowCaptured((s) => !s)}
                className="text-accent hover:underline"
                disabled={captured.length === 0}
              >
                {showCaptured ? "Hide" : "Preview"}
              </button>
            </div>
            {showCaptured && captured.length > 0 && (
              // Messages wrap instead of being clipped: the useful half of a
              // console error is usually past the width of this box, and the
              // person reading the preview is deciding whether it's the error
              // they just hit.
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto rounded bg-bg p-2 font-mono text-[11px] leading-snug text-fg">
                {captured.map((e, i) => (
                  <li key={i} className="whitespace-pre-wrap break-words" title={e.message}>
                    <span
                      className={cn(
                        "mr-1 font-semibold uppercase",
                        e.level === "warn"
                          ? "text-ajax-yellow"
                          : e.level === "error" ||
                            e.level === "uncaught" ||
                            e.level === "rejection"
                          ? "text-cooper-red"
                          : "text-fg-muted",
                      )}
                    >
                      {e.level}
                    </span>
                    {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[11px] text-fg-muted">
            {useMailto ? (
              <>
                You're not signed in, so we'll open a draft email to{" "}
                <strong className="text-fg">{APP_MANAGER_EMAIL}</strong> in your
                mail client — review it and hit Send.
              </>
            ) : (
              <>
                Sent to <strong className="text-fg">{APP_MANAGER_EMAIL}</strong>.
                You ({user.email}) will be CC'd.
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || (!description.trim() && captured.length === 0)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending…" : useMailto ? "Open email draft" : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Format one captured console entry for a plain-text report. Whole — message
 * and stack — because a half-quoted error is a maintainer asking the reporter
 * to try again with DevTools open.
 */
export function formatCapturedEntry(e: CapturedError): string {
  const head = `[${e.level.toUpperCase()}] ${e.at.toISOString()} ${e.message}`;
  const source = e.source ? `\n    at ${e.source}` : "";
  const stack = e.stack ? `\n${indent(e.stack)}` : "";
  return `${head}${source}${stack}`;
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

/**
 * Practical ceiling for what we put in a mailto: URL. Windows caps the whole
 * shell command around 2,000 chars and other clients aren't much more
 * generous, so past this the mail client itself starts silently chopping the
 * body — the failure mode we're trying to avoid. Newest entries are kept
 * (they're the ones next to the failure), whole, and anything left out is
 * stated in the body AND dumped to the console rather than vanishing.
 */
const MAILTO_MAX_CAPTURED_CHARS = 6000;

/**
 * Build the plain-text report body for the mailto: fallback.
 *
 * Every captured entry that fits goes in whole. Exported for tests: the
 * "don't drop console entries" rule is the point of this function, so it's
 * asserted directly rather than through an encoded URL.
 */
export function buildMailtoBody(input: {
  description: string;
  captured: CapturedError[];
  pageUrl: string;
  userAgent: string;
}): string {
  const lines: string[] = [];
  lines.push("Description:");
  lines.push(input.description || "(no description provided)");
  lines.push("");
  lines.push(`Page: ${input.pageUrl}`);
  lines.push(`Browser: ${input.userAgent}`);
  lines.push("");

  if (input.captured.length === 0) {
    lines.push("No console errors were captured during this session.");
    return lines.join("\n");
  }

  // Newest first, so what the mail client shows first is what happened last.
  const newestFirst = input.captured.slice().reverse();
  const included: string[] = [];
  let chars = 0;
  for (const e of newestFirst) {
    const chunk = formatCapturedEntry(e);
    if (included.length > 0 && chars + chunk.length > MAILTO_MAX_CAPTURED_CHARS) break;
    included.push(chunk);
    chars += chunk.length;
  }

  const omitted = input.captured.length - included.length;
  lines.push(
    omitted > 0
      ? `Captured console output — newest first, ${included.length} of ${input.captured.length} below:`
      : `Captured console output (${input.captured.length}), newest first:`,
  );
  lines.push(...included);
  if (omitted > 0) {
    lines.push("");
    lines.push(
      `NOTE: ${omitted} older ${omitted === 1 ? "entry" : "entries"} would push this ` +
        `draft past what an email client can carry in a mailto link, so ${omitted === 1 ? "it is" : "they are"} ` +
        `not pasted above. The full list was printed to the browser console — press F12, ` +
        `open Console, and copy the "[notifyAppManager] full captured console output" entry.`,
    );
  }
  return lines.join("\n");
}

/**
 * Open a mailto: draft pre-filled with the description + captured errors.
 * Used as the fallback when there's no signed-in user (so Graph sendMail
 * isn't reachable), or when Graph sendMail failed. The user composes from
 * their own mailbox, which is actually a nice side effect — the maintainer
 * knows exactly who reported what.
 *
 * The Graph path (src/api/errorReport.ts) sends every captured entry with its
 * stack. This path can't always: mailto URLs have a hard practical length
 * limit. So we fit as many whole entries as we safely can, say in the body
 * exactly how many were left out, and log the complete set to the console so
 * it's still recoverable.
 */
function openMailtoDraft(input: {
  description: string;
  captured: CapturedError[];
  pageUrl: string;
  userAgent: string;
}): void {
  const subject = "[ARC] Issue report";
  const body = buildMailtoBody(input);

  if (input.captured.length > 0) {
    // Always dump the lot before the buffer is cleared — this is the copy
    // that is guaranteed complete.
    // eslint-disable-next-line no-console
    console.info(
      "[notifyAppManager] full captured console output:\n" +
        input.captured.map(formatCapturedEntry).join("\n"),
    );
  }

  const href = `mailto:${APP_MANAGER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (typeof window !== "undefined") {
    window.location.href = href;
  }
}
