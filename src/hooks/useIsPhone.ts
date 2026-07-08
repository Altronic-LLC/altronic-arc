import { useEffect, useState } from "react";

// Tailwind's `sm` breakpoint is 640px. Anything narrower we treat as a
// phone for interaction purposes (drag disabled, touch-first layouts).
const PHONE_BREAKPOINT = 640;

/**
 * Returns true when the viewport is phone-width (< 640px).
 *
 * Re-evaluates on resize and orientationchange, so a tablet flipped to
 * portrait, a phone rotated to landscape, or a desktop window dragged
 * narrow all update correctly.
 *
 * SSR-safe: returns `false` on the server (we render desktop-first and
 * let the resize listener correct it on first paint).
 */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < PHONE_BREAKPOINT;
  });

  useEffect(() => {
    function handleResize() {
      setIsPhone(window.innerWidth < PHONE_BREAKPOINT);
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  return isPhone;
}

// Kanban is only offered on tablets larger than an iPad mini (mini portrait is
// 768px CSS wide; full-size iPads are 810px+). We require strictly wider than
// 768 so phones and the iPad mini are excluded while regular iPads, iPad Air,
// and Pro qualify. (Width-based, so an iPad mini rotated to landscape can slip
// past — acceptable; the intent is "no Kanban on phones / the smallest tablet".)
const KANBAN_MIN_WIDTH = 768;

/**
 * Returns true when the viewport is wide enough to use the Kanban board
 * (wider than an iPad mini). Re-evaluates on resize / orientation change.
 *
 * SSR-safe: returns `true` on the server so the desktop-first render includes
 * Kanban, then the resize listener corrects it on first paint if needed.
 */
export function useKanbanAvailable(): boolean {
  const [available, setAvailable] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth > KANBAN_MIN_WIDTH;
  });

  useEffect(() => {
    function handleResize() {
      setAvailable(window.innerWidth > KANBAN_MIN_WIDTH);
    }
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  return available;
}
