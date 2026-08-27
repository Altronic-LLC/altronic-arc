import { useEffect, useState } from "react";
import { LOADING_FACTS } from "@/data/loadingFacts";

/**
 * ARC's ONE loading screen — every list, board, detail page and lazy-loaded
 * route Suspense fallback renders this (see App.tsx and the many `noun="…"`
 * call sites), so a change here reaches every load in the app at once.
 *
 * Three layers, each rotating at its own pace:
 *  - A verb + noun headline, themed around what Altronic actually builds
 *    (natural gas engine ignition — sparking, arcing (ARC!), cranking,
 *    priming), rotating every 2s so a slow first load doesn't sit on one word.
 *  - A "did you know" fact about ARC itself — what it is, how it's built
 *    (Claude, from a plain-English description — "vibe coding"), and real
 *    numbers about the app and its data (see `data/loadingFacts.ts`) —
 *    rotating every 4.5s, since a full sentence takes longer to read than a
 *    verb does. The goal is to give people something true and specific to
 *    read instead of watching dots blink.
 *  - A small fixed note that the first load is the slow one.
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
  // Starts on a random fact rather than always the same one first — with
  // dozens of short loads across a session, always leading with fact #0
  // would make it the only one most people ever read.
  const [factIndex, setFactIndex] = useState(() => randomFactIndex());

  // Rotate every 2 seconds so users don't stare at the same word during the
  // first multi-second load. Cheap setInterval; cleared on unmount.
  useEffect(() => {
    const id = window.setInterval(() => setVerb(randomVerb()), 2000);
    return () => window.clearInterval(id);
  }, []);

  // Facts are full sentences, so they get longer to read than a verb does —
  // advancing SEQUENTIALLY (not re-randomizing) means a load that outlasts
  // one fact moves on to a new one instead of a coin-flip chance of repeating
  // the same line twice in a row.
  useEffect(() => {
    const id = window.setInterval(
      () => setFactIndex((i) => (i + 1) % LOADING_FACTS.length),
      4500,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="py-16 text-center">
      <div className="font-display text-lg font-medium text-fg">
        {verb} {noun}
        <DotDot />
      </div>
      <p className="mx-auto mt-3 max-w-md px-4 text-xs text-fg-muted">
        {LOADING_FACTS[factIndex]}
      </p>
      <div className="mt-2 text-[11px] text-fg-muted/70">
        Cold starts take a moment — once the engine's warm, loads come straight from cache.
      </div>
    </div>
  );
}

function randomVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)];
}

function randomFactIndex(): number {
  return Math.floor(Math.random() * LOADING_FACTS.length);
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
