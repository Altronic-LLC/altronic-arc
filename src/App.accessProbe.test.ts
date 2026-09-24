import { describe, it, expect } from "vitest";
// Vite's ?raw import, same approach as App.routes.test.ts.
import APP from "./App.tsx?raw";

// =============================================================================
// The access probe has to be MOUNTED, and there is exactly one place for it.
//
// Everything else in this feature is testable in isolation — the probe builds
// its batch, the store records denials, the cards and the menu read them — and
// all of it does nothing at all if nobody calls the hook. Deleting one line in
// App.tsx would take the feature out with no test anywhere going red, and the
// symptom (apps lock only AFTER you've been turned away) is exactly the
// behaviour the probe was added to fix, so it would read as "unchanged" rather
// than "broken".
// =============================================================================

describe("App mounts the access probe", () => {
  it("imports and calls useAccessProbe", () => {
    expect(APP).toMatch(/import\s*\{[^}]*useAccessProbe[^}]*\}\s*from\s*"@\/hooks\/useListAccess"/);
    // Anchored to the start of a line so a COMMENTED-OUT call doesn't satisfy
    // it — the first version of this test passed with `// useAccessProbe();`
    // in place, which is the exact failure it exists to catch.
    expect(APP).toMatch(/^\s*useAccessProbe\(\);\s*$/m);
  });

  it("renders the banner that reports what the probe found", () => {
    expect(APP).toMatch(/<ListAccessBanner\s*\/>/);
  });
});
