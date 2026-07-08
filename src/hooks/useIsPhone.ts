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

// Kanban is only offered on tablets larger than an iPad mini (and on desktop).
// iPad mini's shorter screen side is 768px (mini 6 is 744); full-size iPads are
// 810px+. We require the qualifying dimension to be strictly greater than 768.
const KANBAN_MIN_WIDTH = 768;

/**
 * Whether the Kanban board should be offered on this device.
 *
 * The check is deliberately ORIENTATION-INDEPENDENT for touch devices: a phone
 * rotated to landscape is wider than 768px, but it's still a phone. So for
 * touch devices we gate on the *shorter* physical screen dimension (which never
 * changes with rotation) — a phone's short side is always small, an iPad mini's
 * is 744–768, a full-size iPad's is 810+. Non-touch devices (laptops/desktops,
 * incl. small 1366×768 laptops) are gated on the window width instead, so a
 * narrow browser window is the only way to lose Kanban there.
 */
function computeKanbanAvailable(): boolean {
  if (typeof window === "undefined") return true;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  if (!coarse) {
    // Desktop / laptop (fine pointer): gate on window width only.
    return window.innerWidth > KANBAN_MIN_WIDTH;
  }
  // Touch device: use the shorter physical screen side so orientation can't
  // flip a phone into Kanban.
  const shortSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
  return shortSide > KANBAN_MIN_WIDTH;
}

/**
 * Returns true when the Kanban board should be available (tablet larger than an
 * iPad mini, or desktop). Re-evaluates on resize / orientation change.
 *
 * SSR-safe: returns `true` on the server so the desktop-first render includes
 * Kanban, then the listener corrects it on first paint if needed.
 */
export function useKanbanAvailable(): boolean {
  const [available, setAvailable] = useState(computeKanbanAvailable);

  useEffect(() => {
    function handleResize() {
      setAvailable(computeKanbanAvailable());
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
