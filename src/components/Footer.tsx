import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { History, Info, Mail, X } from "lucide-react";
import { CHANGELOG, CURRENT_VERSION } from "@/data/changelog";
import { useVersionCheck } from "@/hooks/useVersionCheck";

const MAINTAINER_EMAIL = "ray.white@altronic-llc.com";
const VERSION_SEEN_KEY = "arc-version-seen";

export function Footer() {
  const [showHistory, setShowHistory] = useState(false);
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

  return (
    <>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-6 py-4 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            <span>
              Developed and managed by{" "}
              <a
                href={`mailto:${MAINTAINER_EMAIL}`}
                className="font-medium text-fg underline-offset-2 hover:text-accent hover:underline"
              >
                {MAINTAINER_EMAIL}
              </a>
            </span>
          </div>

          <div className="flex items-center gap-2">
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
      </footer>

      {showHistory && <ChangelogModal onClose={() => setShowHistory(false)} />}
    </>
  );
}

function ChangelogModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
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
