import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// =============================================================================
// One line of text that SCROLLS when it doesn't fit (BusinessIT#81).
//
// The footer's SharePoint access notice can name several apps and a site — far
// more than a footer row holds. Truncating it hid most of the message; letting
// it wrap made the footer taller and pushed the maintainer line onto two rows.
// So: if the text fits, it sits still; if it doesn't, it scrolls sideways in a
// loop, with the edges faded so it reads as moving rather than cut off.
//
// - **Measured, not guessed.** The text's natural width is compared with the
//   box's on every resize (ResizeObserver), so widening the window past the
//   point where it fits stops the scroll.
// - **Two copies, the second `aria-hidden`.** The track holds the text twice
//   and slides by exactly half its width, which is where the second copy sits
//   where the first started — a seamless loop. A screen reader hears it once.
// - **Constant speed, not constant duration.** A long message mustn't race.
// - **Pauses on hover and keyboard focus** of the nearest `group` (the button
//   it sits in), so it can be read where it stands.
// - **Reduced motion: no scrolling**, the old ellipsis instead. The full text
//   is still a click away in the popup.
// =============================================================================

/** How fast the text moves, in px per second. */
export const MARQUEE_SPEED_PX_PER_S = 40;
/** The space between the end of one copy and the start of the next. */
const GAP_PX = 48;

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function Marquee({ text, className }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  // The text's natural width when it overflows; 0 when it fits.
  const [overflowWidth, setOverflowWidth] = useState(0);
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      // scrollWidth is the FULL content width even while the span is clipped.
      const natural = textRef.current?.scrollWidth ?? 0;
      setOverflowWidth(natural > box.clientWidth + 1 ? natural : 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text]);

  const scrolling = overflowWidth > 0 && !reduced;

  if (!scrolling) {
    return (
      <span ref={boxRef} className={cn("block min-w-0 overflow-hidden", className)}>
        <span ref={textRef} className="block truncate">
          {text}
        </span>
      </span>
    );
  }

  const seconds = Math.max(8, (overflowWidth + GAP_PX) / MARQUEE_SPEED_PX_PER_S);
  const fade = "linear-gradient(to right, transparent, black 1rem, black calc(100% - 1rem), transparent)";
  return (
    <span
      ref={boxRef}
      data-marquee="scrolling"
      className={cn("block min-w-0 overflow-hidden whitespace-nowrap", className)}
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      <span
        className="inline-flex animate-marquee group-hover:[animation-play-state:paused] group-focus-visible:[animation-play-state:paused]"
        // Inline, not a CSS variable: a var() inside the theme's
        // `--animate-marquee` resolves at :root, so a per-element value
        // would never reach it.
        style={{ animationDuration: `${seconds}s` }}
      >
        {/* Padding on the outer span, the ref on the inner one, so the
            measurement is the text alone and not text + gap. */}
        <span className="inline-block" style={{ paddingRight: GAP_PX }}>
          <span ref={textRef} className="inline-block">
            {text}
          </span>
        </span>
        <span aria-hidden className="inline-block" style={{ paddingRight: GAP_PX }}>
          {text}
        </span>
      </span>
    </span>
  );
}
