import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteErrorBoundary, looksLikeStaleChunk } from "./RouteErrorBoundary";

// =============================================================================
// Until this boundary existed, any render error blanked the whole app until a
// manual refresh — navigating away included, because the crash unmounts the
// router (Ray, 2026-08-24: "every navigation to and from requires me to
// refresh to load").
// =============================================================================

function Boom({ error }: { error: Error }): never {
  throw error;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error itself; silencing keeps the run readable.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("looksLikeStaleChunk", () => {
  // Each of these is a real wording from a browser or bundler for "that chunk
  // isn't on the server any more". One check would only catch one browser.
  it.each([
    "Failed to fetch dynamically imported module: https://x/assets/OpenOrdersView-abc.js",
    "error loading dynamically imported module",
    "Importing a module script failed.",
    "ChunkLoadError: Loading chunk 42 failed.",
    "Expected a JavaScript module script but the server responded with a MIME type of 'text/html' is not a valid JavaScript MIME type",
  ])("recognises %s", (message) => {
    expect(looksLikeStaleChunk(new Error(message))).toBe(true);
  });

  it("doesn't mistake an ordinary error for a stale build", () => {
    expect(looksLikeStaleChunk(new TypeError("x is not a function"))).toBe(false);
  });

  it("copes with something that isn't an Error at all", () => {
    expect(looksLikeStaleChunk("just a string")).toBe(false);
    expect(looksLikeStaleChunk(null)).toBe(false);
  });
});

describe("RouteErrorBoundary", () => {
  it("renders its children when nothing is wrong", () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <p>the page</p>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("the page")).toBeInTheDocument();
  });

  it("shows a recovery screen instead of a blank page", () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <Boom error={new TypeError("x is not a function")} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/didn't load/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload ARC/i })).toBeInTheDocument();
  });

  // A stale chunk is not the user's fault and reloading definitely fixes it, so
  // it gets its own wording rather than a generic failure.
  it("explains a stale deploy as a new version, not a fault", () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <Boom error={new Error("Failed to fetch dynamically imported module: /assets/x.js")} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/newer version of ARC/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is wrong with your data/i)).toBeInTheDocument();
  });

  // Whoever reports this has to be able to quote it.
  it("shows the error text", () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <Boom error={new TypeError("x is not a function")} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/TypeError: x is not a function/)).toBeInTheDocument();
  });

  // The heart of the reported bug: one broken page must not make the rest of
  // ARC unreachable until a reload.
  it("clears itself when the route changes, so the rest of ARC still works", () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/broken">
        <Boom error={new TypeError("nope")} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/didn't load/i)).toBeInTheDocument();

    rerender(
      <RouteErrorBoundary resetKey="/somewhere-else">
        <p>a different page</p>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("a different page")).toBeInTheDocument();
    expect(screen.queryByText(/didn't load/i)).not.toBeInTheDocument();
  });

  it("stays put while the route is unchanged", () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/broken">
        <Boom error={new TypeError("nope")} />
      </RouteErrorBoundary>,
    );
    rerender(
      <RouteErrorBoundary resetKey="/broken">
        <p>would-be content</p>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/didn't load/i)).toBeInTheDocument();
  });

  it("reloads the page on the button", async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      const user = userEvent.setup();
      render(
        <RouteErrorBoundary resetKey="/a">
          <Boom error={new Error("ChunkLoadError")} />
        </RouteErrorBoundary>,
      );
      await user.click(screen.getByRole("button", { name: /Reload ARC/i }));
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
