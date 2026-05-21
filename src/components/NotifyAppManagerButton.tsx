import { useEffect, useState } from "react";
import { LifeBuoy, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { sendErrorReport } from "@/api/errorReport";
import {
  clearRecentErrors,
  getRecentErrors,
  type CapturedError,
} from "@/lib/errorBuffer";
import { pushToast } from "@/components/Toast";
import { APP_MANAGER_EMAIL } from "@/api/config";

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

  async function handleSend() {
    if (sending) return;
    setSending(true);
    try {
      await sendErrorReport({
        description: description.trim(),
        reporter: user.email ? user : null,
        captured,
        pageUrl: typeof window !== "undefined" ? window.location.href : "(unknown)",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)",
      });
      clearRecentErrors();
      pushToast({
        message: `Report sent to the app manager.${user.email ? " You'll get a copy by email." : ""}`,
      });
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[notifyAppManager] send failed:", err);
      pushToast({
        message: `Couldn't send the report — please email ${APP_MANAGER_EMAIL} a screenshot.`,
        variant: "error",
      });
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="notify-title"
        className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
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

        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">
              What were you trying to do?
            </span>
            <textarea
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="e.g. I tried to drag a card to In Progress on the Kanban and the page reloaded."
              className="mt-1 block w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
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
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto rounded bg-bg p-2 font-mono text-[11px] leading-snug text-fg">
                {captured.map((e, i) => (
                  <li key={i} className="truncate" title={e.message}>
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
            Sent to <strong className="text-fg">{APP_MANAGER_EMAIL}</strong>
            {user.email && (
              <>
                . You ({user.email}) will be CC'd.
              </>
            )}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
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
            {sending ? "Sending…" : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}
