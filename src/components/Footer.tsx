import { useEffect, useRef, useState, type TransitionEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, History, Info, Mail, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { CHANGELOG, CURRENT_VERSION } from "@/data/changelog";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { ListAccessIndicator } from "./ListAccessIndicator";

const MAINTAINER_EMAIL = "ray.white@altronic-llc.com";
// Shown instead of the address (BusinessIT#81, Jason Lamb): 9 characters, not
// 26, so the line fits on one row. The link still mails the address, and the
// tooltip shows it.
const MAINTAINER_NAME = "Ray White";
const VERSION_SEEN_KEY = "arc-version-seen";

export function Footer() {
  const [showHistory, setShowHistory] = useState(false);
  // The footer floats over the bottom of the page, which can hide what's
  // under it (BusinessIT#77, Alexander Masgras). The arrow slides it off to
  // the left; it stays hidden until the arrow is pressed again or the page
  // is reloaded — deliberately not remembered, so nobody loses the version
  // and access notices for good.
  const [hidden, setHidden] = useState(false);
  // Keyboard users follow the control: the tab once the footer has gone,
  // the footer's own arrow once it's back. Set on press, used when the
  // incoming control finishes sliding in (it can't take focus while it's
  // still `invisible`).
  const moveFocus = useRef(false);
  const hideButton = useRef<HTMLButtonElement>(null);
  const showTab = useRef<HTMLButtonElement>(null);
  const [versionSeen, setVersionSeen] = useState(false);
  const { updateAvailable } = useVersionCheck();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setVersionSeen(localStorage.getItem(VERSION_SEEN_KEY) === CURRENT_VERSION);
  }, [CURRENT_VERSION]);

  const highlightVersion = updateAvailable || !versionSeen;

  const openHistory = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(VERSION_SEEN_KEY, CURRENT_VERSION);
      setVersionSeen(true);
    }
    setShowHistory(true);
  };

  // Anything sized to sit above the footer (a table fitted to the window)
  // measures again once it has moved.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.dispatchEvent(new Event("resize"));
  }, [hidden]);

  function toggle(next: boolean) {
    moveFocus.current = true;
    setHidden(next);
  }

  /** Focus the control that just finished sliding in, if the press asked to. */
  function settle(e: TransitionEvent, el: HTMLButtonElement | null) {
    if (e.target !== e.currentTarget || e.propertyName !== "translate") return;
    if (!moveFocus.current) return;
    moveFocus.current = false;
    el?.focus({ preventScroll: true });
  }

  return (
    <>
      {/* `data-fixed-footer` only while it's on screen: dropdowns and fitted
          tables read it to stay clear of the footer, and a hidden footer
          covers nothing. `invisible` (visibility, transitioned) takes it out
          of the tab order once it has slid away. */}
      {/* The two move as one: hiding, the footer glides off to the left and
          fades, then the tab slides out from the edge once it's gone;
          showing, the tab tucks away first and the footer glides back in.
          The delays live on whichever one is ARRIVING. Reduced motion: no
          animation.

          Tailwind 4's translate-x-* set the CSS `translate` PROPERTY, not
          `transform`, so the transition must name `translate` — naming
          `transform` (the first version) made the footer jump, not slide.
          No fade on the footer: fading it as well made it look like it
          simply vanished. */}
      <footer
        data-fixed-footer={hidden ? undefined : ""}
        aria-hidden={hidden || undefined}
        onTransitionEnd={(e) => !hidden && settle(e, hideButton.current)}
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.08)]",
          "transition-[translate,visibility] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none",
          hidden ? "invisible -translate-x-full" : "translate-x-0 delay-200",
        )}
      >
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-6 py-4 text-xs text-fg-muted">
          <button
            ref={hideButton}
            type="button"
            onClick={() => toggle(true)}
            aria-label="Hide footer"
            title="Hide footer (until you reload the page)"
            className="group shrink-0 self-start rounded-md border border-border p-1 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg sm:self-center"
          >
            <ChevronLeft className="h-3.5 w-3.5 transition-[translate] duration-200 group-hover:-translate-x-0.5 motion-reduce:transition-none" />
          </button>
          {/* Two rows at most on a phone (BusinessIT#81): the maintainer line,
              then the access icon beside the buttons. One row from `sm`, where
              the maintainer line never wraps and never shrinks — the access
              sentence between it and the buttons is what gives way. */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <Mail className="h-3.5 w-3.5" />
              <span>
                Developed and managed by{" "}
                <a
                  href={`mailto:${MAINTAINER_EMAIL}`}
                  title={MAINTAINER_EMAIL}
                  className="font-medium text-fg underline-offset-2 hover:text-accent hover:underline"
                >
                  {MAINTAINER_NAME}
                </a>
              </span>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* Between the maintainer line and the About button (Tim,
                  2026-09-24). It takes the row's spare width (`lg:flex-1`) and
                  scrolls its sentence when that isn't enough. */}
              <ListAccessIndicator />

              <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
                <Link
                  to="/about"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                >
                  <Info className="h-3 w-3" />
                  About
                </Link>
                <button
                  onClick={openHistory}
                  className={
                    "inline-flex items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1 font-mono text-[11px] transition-colors " +
                    (highlightVersion
                      ? "border-cooper-red text-cooper-red hover:border-cooper-red/80 hover:text-cooper-red/90"
                      : "border-border text-fg-muted hover:border-fg-muted hover:text-fg")
                  }
                >
                  <History className="h-3 w-3" />
                  v{CURRENT_VERSION}
                  {highlightVersion && (
                    <span className="ml-1 rounded-full bg-cooper-red px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                      NEW
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Always rendered, so it can slide; out of reach (aria-hidden, no
          tab stop, invisible) while the footer is showing. */}
      <button
        ref={showTab}
        type="button"
        onClick={() => toggle(false)}
        onTransitionEnd={(e) => hidden && settle(e, showTab.current)}
        aria-hidden={!hidden || undefined}
        tabIndex={hidden ? undefined : -1}
        aria-label={highlightVersion ? "Show footer (new version)" : "Show footer"}
        title={highlightVersion ? "Show footer — there's a new version" : "Show footer"}
        className={cn(
          "group fixed bottom-3 left-0 z-30 inline-flex items-center gap-1 rounded-r-md border border-l-0 border-border bg-surface py-2 pl-1.5 pr-2 text-fg-muted shadow-md hover:pr-2.5 hover:text-fg",
          "transition-[translate,visibility,padding,color] duration-300 motion-reduce:transition-none",
          // Arriving: a small overshoot as it pops out from the edge.
          hidden
            ? "translate-x-0 delay-[450ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            : "pointer-events-none invisible -translate-x-full duration-200 ease-in",
        )}
      >
        <ChevronRight className="h-3.5 w-3.5 transition-[translate] duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
        {/* A new version is still worth seeing with the footer away. */}
        {highlightVersion && (
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cooper-red opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-cooper-red" />
          </span>
        )}
      </button>

      {showHistory && <ChangelogModal onClose={() => setShowHistory(false)} />}
    </>
  );
}

function ChangelogModal({ onClose }: { onClose: () => void }) {
  // Dismiss on a genuine backdrop click only — never when a text-selection
  // drag merely happens to end out here (see useOverlayDismiss).
  const overlayDismiss = useOverlayDismiss(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      {...overlayDismiss}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-lg font-semibold text-fg">Version History</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="scroll-elegant max-h-[calc(80vh-3.5rem)] overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {CHANGELOG.map((entry) => (
              <div key={entry.version} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                <div className="mb-2 flex items-baseline gap-3">
                  <span className="font-display text-base font-semibold text-fg">
                    v{entry.version}
                  </span>
                  <span className="text-xs text-fg-muted">{entry.date}</span>
                </div>
                <ul className="ml-5 list-disc space-y-1 text-sm text-fg">
                  {entry.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
