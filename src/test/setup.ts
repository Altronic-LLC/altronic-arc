// Vitest global setup. Loaded once per test file via vite.config.ts → test.setupFiles.
//
// - Pulls in @testing-library/jest-dom so matchers like `toBeInTheDocument`
//   are available in expect().
// - Cleans up the DOM between tests so React Testing Library renders don't
//   leak into each other.
// - Forgets the app-wide open-dropdown claim, for the same reason: it is a
//   module-level variable (useDropdownClose.ts), so a panel a test leaves
//   open closes the NEXT test's panel the moment that one claims. Doing it
//   here rather than per-file means a new test file can't forget it.
// - Stubs out browser APIs that jsdom doesn't implement but our code touches
//   (matchMedia, IntersectionObserver, ResizeObserver). Add to this list as
//   we discover more.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetOpenDropdown } from "@/components/useDropdownClose";

afterEach(() => {
  cleanup();
  resetOpenDropdown();
});

// jsdom doesn't ship matchMedia. Some libraries (lucide-react animations,
// Tailwind responsive utilities used in component effects) probe for it.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// IntersectionObserver — used by some virtualised list libraries.
if (typeof window !== "undefined" && !("IntersectionObserver" in window)) {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).IntersectionObserver = MockIntersectionObserver;
}

// ResizeObserver — referenced by some component libs on mount.
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ResizeObserver = MockResizeObserver;
}
