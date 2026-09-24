import { useRef, useState } from "react";
import { AlertTriangle, Lock, RotateCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { accessGapLabels, siteLabelForId } from "@/api/appAccess";
import { clearAccessDenials, useAccessDenials } from "@/hooks/useListAccess";
import { describeAccessGap } from "@/lib/listAccess";
import { cn } from "@/lib/cn";
import { dropdownKeyHandler, useDropdownClose } from "./useDropdownClose";

/**
 * A warning colour that works on BOTH grounds.
 *
 * NOT `text-ajax-yellow`: the brand yellows are a single fixed hex, which sits
 * well on the dark footer and washes out to near-invisible on the light one
 * (Tim, 2026-09-24). Amber 700/400 is the pair the admin role screens already
 * use for the same job, so this is the app's existing idiom rather than a new
 * colour — and it needs no new CSS variable.
 */
const WARNING_TEXT = "text-amber-700 dark:text-amber-400";

// =============================================================================
// "You don't have access to some of this" — in the FOOTER.
//
// It shipped as a full-width bar under the header, which put a permanent
// yellow stripe above every screen for anyone missing one list, and pushed the
// page down by a row (Tim, 2026-09-24: move it into the footer, between the
// maintainer line and the About button). It is a standing fact about the
// account, not news about this page, so the footer is where it belongs.
//
// Two renderings of the same thing:
//
//   - Wide enough: the sentence inline, with Check again beside it. The
//     sentence is also a button, because it TRUNCATES — naming three apps and
//     a site outruns a footer row, and a message you can't finish reading is
//     no message at all.
//   - Too narrow: one alert icon. Tapping it opens the same popup.
//
// The breakpoint is `lg`, not a measurement: below it the footer is already
// stacking its own two rows, and a sentence this long has nowhere to go.
// =============================================================================

export function ListAccessIndicator() {
  const denials = useAccessDenials();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  useDropdownClose(open, containerRef, close);

  if (denials.count === 0) return null;

  // Split by reason: an app whose data simply couldn't be READ is not one the
  // user has been refused, and telling them to ask for access would send them
  // after something they may already have.
  const { noAccess, unreadable } = accessGapLabels(denials);
  const sites = [...denials.implicatedSites]
    .map(siteLabelForId)
    .filter((label): label is string => label !== null);

  const message = describeAccessGap(noAccess, sites, unreadable);
  // Only a refusal is somebody's to grant.
  const showAskLine = sites.length > 0 && noAccess.length > 0;

  function checkAgain() {
    // Forget what we learned FIRST, so the refetch below starts from a clean
    // slate — anything still refused registers again a moment later, and
    // anything since granted stops being hidden straight away.
    clearAccessDenials();
    void queryClient.refetchQueries();
    setOpen(false);
  }

  return (
    <div
      ref={containerRef}
      className="relative flex min-w-0 items-center gap-2"
      onKeyDown={dropdownKeyHandler(open, close)}
    >
      {/* Wide: the sentence, truncated, plus the action. */}
      <div className="hidden min-w-0 items-center gap-2 lg:flex">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-left transition-colors hover:text-fg",
            WARNING_TEXT,
          )}
          title={message}
        >
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{message}</span>
        </button>
        <button
          type="button"
          onClick={checkAgain}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
        >
          <RotateCw className="h-3 w-3" />
          Check again
        </button>
      </div>

      {/* Narrow: the icon alone. Same popup behind it. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="SharePoint access notice"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-1 transition-colors hover:bg-amber-500/25 lg:hidden",
          WARNING_TEXT,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="SharePoint access notice"
          // Opens UPWARD: the footer is pinned to the bottom of the window, so
          // a panel below the trigger would be off-screen.
          className="absolute bottom-full left-0 z-40 mb-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-3 text-xs shadow-lg"
        >
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
            <div className="min-w-0">
              <p className="font-medium text-fg">{message}</p>
              {showAskLine && (
                <p className="mt-1 text-fg-muted">
                  Ask an admin for access to{" "}
                  <span className="font-mono text-[11px]">{sites.join(", ")}</span>.
                </p>
              )}
              <button
                type="button"
                onClick={checkAgain}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-medium text-fg transition-colors hover:bg-surface-2"
              >
                <RotateCw className="h-3 w-3" />
                Check again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
