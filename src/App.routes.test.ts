import { describe, it, expect } from "vitest";
// Vite's ?raw import, rather than node:fs — the app's tsconfig has no Node
// types, and this reads the same file the bundler does.
import APP from "./App.tsx?raw";

// =============================================================================
// Every lazy route needs a Suspense boundary.
//
// The Open Orders routes shipped without one (2026-08-24). React has nowhere to
// park a suspended lazy component, so rendering one threw, and with no error
// boundary in the app at the time the whole page went blank until a manual
// refresh — navigating away included, because the crash unmounts the router.
// That is exactly what Ray reported: "every navigation to and from requires me
// to refresh to load".
//
// The mistake was easy to make and invisible in review: the route was copied
// from `/sales/visit-reports`, whose view is EAGERLY imported and so needs no
// boundary. This test reads App.tsx and checks the two lists agree, because the
// difference isn't visible at the call site.
// =============================================================================

/** Component names declared with `lazy(() => import(...))`. */
function lazyComponents(source: string): string[] {
  return [...source.matchAll(/const\s+(\w+)\s*=\s*lazy\(/g)].map((m) => m[1]);
}

/**
 * Every `<Route ... />` block, split on the closing `/>` of the route itself.
 *
 * Crude on purpose: a real JSX parse would need a compiler, and what matters
 * here is only whether the words "Suspense" and "<TheComponent" appear in the
 * same route.
 */
function routeBlocks(source: string): string[] {
  const blocks: string[] = [];
  const re = /<Route\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    // Take everything up to the next <Route, which is that route's whole body.
    const next = source.indexOf("<Route", match.index + 6);
    blocks.push(source.slice(match.index, next === -1 ? source.length : next));
  }
  return blocks;
}

describe("App routes", () => {
  const lazies = lazyComponents(APP);

  it("has lazy components to check (guards against the regex silently matching nothing)", () => {
    expect(lazies.length).toBeGreaterThan(10);
  });

  it("wraps every lazy component in a Suspense boundary", () => {
    const blocks = routeBlocks(APP);
    const unwrapped: string[] = [];

    for (const name of lazies) {
      const used = blocks.filter((b) => b.includes(`<${name} `) || b.includes(`<${name}/>`) || b.includes(`<${name} />`));
      for (const block of used) {
        if (!block.includes("Suspense")) unwrapped.push(name);
      }
    }

    expect(
      unwrapped,
      `These lazy views are rendered without a <Suspense> boundary, which throws ` +
        `during render and blanks the app until a refresh: ${unwrapped.join(", ")}`,
    ).toEqual([]);
  });

  // A lazy view declared and never routed is dead weight that typecheck only
  // catches while nothing else references it. Caught while adding
  // AdminNotificationRecipientsView, where the route insertion silently missed
  // and this file stayed green.
  it("routes every lazy component it declares", () => {
    const blocks = routeBlocks(APP);
    const unrouted = lazies.filter(
      (name) =>
        !blocks.some(
          (b) => b.includes(`<${name} `) || b.includes(`<${name}/>`) || b.includes(`<${name} />`),
        ),
    );
    expect(
      unrouted,
      `These lazy views are declared but never rendered in a <Route>: ${unrouted.join(", ")}`,
    ).toEqual([]);
  });

  // The recovery net behind the above. Losing this is how a single render error
  // becomes a blank app again.
  it("wraps the whole route tree in the error boundary", () => {
    expect(APP).toContain("<RouteErrorBoundary");
    // Keyed on the path, so navigating away from a broken page clears it.
    expect(APP).toMatch(/<RouteErrorBoundary\s+resetKey=\{location\.pathname\}/);
  });

  it("routes the Open Orders screens", () => {
    expect(APP).toContain('path="/sales/open-orders"');
    expect(APP).toContain('path="/sales/open-orders/customers"');
  });
});
