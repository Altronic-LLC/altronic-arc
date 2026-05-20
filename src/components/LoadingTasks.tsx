import { useEffect, useState } from "react";

/**
 * Whimsical loader for the tasks list / kanban board. Rotates through a
 * small set of action verbs (Claude Code-style) so the user has something
 * to read while SharePoint pages through the list, plus a small note that
 * the first load is the slow one — subsequent loads are cached.
 */
const VERBS = [
  "Wrangling",
  "Cogitating",
  "Untangling",
  "Excavating",
  "Marinating",
  "Pondering",
  "Conjuring",
  "Harvesting",
  "Whispering to",
  "Reticulating",
  "Synthesizing",
  "Persuading",
  "Cajoling",
  "Bamboozling",
  "Negotiating with",
  "Polishing",
  "Herding",
  "Unfurling",
  "Brewing",
  "Coaxing",
  "Reverse-engineering",
] as const;

export function LoadingTasks({ noun = "tasks" }: { noun?: string }) {
  const [verb, setVerb] = useState(() => randomVerb());

  // Rotate every 2 seconds so users don't stare at the same word during the
  // first multi-second load. Cheap setInterval; cleared on unmount.
  useEffect(() => {
    const id = window.setInterval(() => setVerb(randomVerb()), 2000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="py-16 text-center">
      <div className="font-display text-lg font-medium text-fg">
        {verb} {noun}
        <DotDot />
      </div>
      <div className="mt-2 text-xs text-fg-muted">
        The first load is a moment — subsequent loads come straight from cache.
      </div>
    </div>
  );
}

function randomVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)];
}

/** Animated three-dot ellipsis. CSS-only, no extra packages. */
function DotDot() {
  return (
    <span className="ml-0.5 inline-block">
      <span className="dot dot-1">.</span>
      <span className="dot dot-2">.</span>
      <span className="dot dot-3">.</span>
      <style>{`
        .dot { animation: blink 1.4s infinite; opacity: 0; }
        .dot-1 { animation-delay: 0s; }
        .dot-2 { animation-delay: 0.2s; }
        .dot-3 { animation-delay: 0.4s; }
        @keyframes blink {
          0%, 60%, 100% { opacity: 0; }
          30% { opacity: 1; }
        }
      `}</style>
    </span>
  );
}
