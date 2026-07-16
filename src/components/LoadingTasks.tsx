import { useEffect, useState } from "react";

/**
 * Whimsical loader for the tasks list / kanban board. Rotates through a
 * small set of action verbs so the user has something to read while
 * SharePoint pages through the list, plus a small note that the first load
 * is the slow one — subsequent loads are cached.
 *
 * Verbs are themed around what Altronic actually builds: natural gas engine
 * ignition. Sparking, arcing (ARC!), cranking, priming — every one should
 * read like something you'd do to an engine or an ignition system.
 */
const VERBS = [
  "Sparking",
  "Arcing",
  "Igniting",
  "Starting",
  "Loading",
  "Producing",
  "Cranking",
  "Priming",
  "Firing up",
  "Warming up",
  "Revving",
  "Compressing",
  "Energizing",
  "Charging up",
  "Pressurizing",
  "Turbocharging",
  "Spooling up",
  "Timing",
  "Gapping the plugs on",
  "Advancing the timing on",
  "Checking compression on",
  "Torquing down",
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
        Cold starts take a moment — once the engine's warm, loads come straight from cache.
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
