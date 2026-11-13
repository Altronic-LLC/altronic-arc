import { useLayoutEffect, useRef, useState, type RefObject } from "react";

// =============================================================================
// Fit a table to the window. Lifted out of PartsListView (2026-11-05) when the
// Panel SAP BOM Builder's parts table needed the same thing: one department
// can't import another's view. The page header stays put and the table scrolls
// in its own box, so a sticky column header is always in view.
// =============================================================================

/** Below this width the panel stacks above the table and the PAGE scrolls. */
const DESKTOP_QUERY = "(min-width: 1024px)";
/** Never squeeze the table below this on a short window — let the page scroll instead. */
const MIN_FIT_HEIGHT = 320;
/** Breathing room between the table's bottom edge and the footer. */
const FOOTER_GAP = 16;

/**
 * On a desktop, the height that fits an element between where it starts on
 * the page and the FIXED footer — so the search panel and the table each
 * scroll inside themselves, and the table's horizontal scrollbar sits just
 * above the footer instead of at the bottom of a long page (Tim, 2026-09-28).
 *
 * Measured, not a hard-coded calc(): the header, the update banner and the
 * footer all vary in height, and a guessed offset is wrong the day one of
 * them changes. Null on a phone (and wherever matchMedia is missing), which
 * leaves the ordinary page scroll alone.
 */
export function useFitToWindow(): [RefObject<HTMLDivElement>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    function measure() {
      const el = ref.current;
      if (!el || !mq.matches) return setHeight(null);
      const footer = document.querySelector("footer");
      const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
      // Document position, so a measure taken while scrolled still agrees.
      const top = el.getBoundingClientRect().top + window.scrollY;
      const fit = Math.floor(window.innerHeight - top - footerHeight - FOOTER_GAP);
      setHeight((prev) => {
        const next = Math.max(MIN_FIT_HEIGHT, fit);
        return prev === next ? prev : next;
      });
    }
    measure();
    window.addEventListener("resize", measure);
    mq.addEventListener?.("change", measure);
    // The header and footer can change height (the update banner appearing,
    // the footer wrapping) without a window resize.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    const header = document.querySelector("header");
    const footer = document.querySelector("footer");
    if (header) observer?.observe(header);
    if (footer) observer?.observe(footer);
    return () => {
      window.removeEventListener("resize", measure);
      mq.removeEventListener?.("change", measure);
      observer?.disconnect();
    };
  }, []);

  return [ref, height];
}
