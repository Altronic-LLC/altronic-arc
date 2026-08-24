import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// =============================================================================
// The app's only error boundary.
//
// Until this existed, ANY error thrown while rendering took the whole app down
// to a blank white page that only a manual refresh recovered — including
// navigating away, because the crash unmounts the router too. That is what
// "every navigation to and from requires me to refresh" was (Ray, 2026-08-24).
//
// Two distinct causes land here, and they need different words:
//
//  1. **A stale lazy chunk.** ARC deploys to GitHub Pages with hashed filenames.
//     A tab opened before a deploy asks for a chunk that no longer exists, the
//     dynamic import rejects, React re-throws it during render, and the app
//     blanks. This is not the user's fault and not a bug in the page they were
//     opening — they simply need the new build. Reloading genuinely fixes it,
//     so the boundary says so plainly and offers the button.
//  2. **A real render error.** Something in the page threw. Reloading may or
//     may not help, so the message doesn't promise that it will, and the error
//     text is shown for the report.
//
// Deliberately a class component: `getDerivedStateFromError` has no hook
// equivalent, and pulling in a dependency for one boundary isn't worth it.
// =============================================================================

/**
 * Does this look like a chunk that isn't on the server any more?
 *
 * Every bundler and browser words it differently, which is why this is a set of
 * patterns rather than one check. Getting it wrong is cheap in one direction
 * (a real error described as a stale build — the reload button still helps and
 * the error text is still shown) and only mildly wrong in the other.
 */
export function looksLikeStaleChunk(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(message)
  );
}

interface Props {
  children: ReactNode;
  /** Reset the boundary when this changes — the current path, in practice. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  /** The resetKey the error happened on, so a route change can clear it. */
  erroredOn?: string;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Into the console error buffer, so "Report issue" carries it.
    console.error("Render error caught by RouteErrorBoundary:", error, info.componentStack);
    this.setState({ erroredOn: this.props.resetKey });
  }

  componentDidUpdate(prev: Props) {
    // Navigating somewhere else clears the error, so one broken page doesn't
    // leave the rest of ARC unreachable until a reload. The page that threw
    // will throw again if you go back to it, which is honest.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, erroredOn: undefined });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = looksLikeStaleChunk(error);
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-12 sm:px-6">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-cooper-red" />
          <h1 className="font-display text-lg font-semibold text-fg">
            {stale ? "A newer version of ARC is available" : "This page didn't load"}
          </h1>
        </div>

        <p className="text-sm text-fg-muted">
          {stale ? (
            <>
              This tab has been open since before the last update, so part of the app it
              tried to load isn't on the server any more. Reloading picks up the new
              version — nothing is wrong with your data.
            </>
          ) : (
            <>
              Something went wrong while drawing this page. Moving to another part of ARC
              still works; if this page keeps failing, send it on with the Report issue
              button in the header.
            </>
          )}
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
        >
          <RefreshCw className="h-4 w-4" />
          Reload ARC
        </button>

        {/* Shown, not hidden: whoever reports this needs to be able to quote it. */}
        <pre className="max-w-full overflow-x-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          {error.name}: {error.message}
        </pre>
      </div>
    );
  }
}
