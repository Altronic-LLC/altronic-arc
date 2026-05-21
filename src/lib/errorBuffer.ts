// =============================================================================
// In-memory ring buffer of recent console errors / warnings + uncaught
// exceptions + unhandled promise rejections. Powers the "Notify app
// manager" button — when a user reports a problem, this buffer is the
// thing we attach so the maintainer doesn't have to ask them to open
// DevTools and copy-paste.
//
// Installed once at app startup (imported from main.tsx). Cheap to leave
// running: bounded at LIMIT entries, only stringifies on demand.
// =============================================================================

/** Hard cap on entries kept in memory at any time. */
const LIMIT = 100;

export type ErrorLevel = "error" | "warn" | "uncaught" | "rejection";

export interface CapturedError {
  /** ISO timestamp. */
  at: Date;
  level: ErrorLevel;
  message: string;
  /** Stack trace if available (uncaught errors / rejections usually have one). */
  stack?: string;
  /** Source file + line for the legacy window.onerror path. */
  source?: string;
}

const buffer: CapturedError[] = [];
let installed = false;

/** Return a snapshot of every entry currently in the buffer (oldest first). */
export function getRecentErrors(): CapturedError[] {
  return buffer.slice();
}

/** Drop every buffered entry — useful after a successful report send. */
export function clearRecentErrors(): void {
  buffer.length = 0;
}

function pushEntry(entry: CapturedError) {
  buffer.push(entry);
  if (buffer.length > LIMIT) buffer.splice(0, buffer.length - LIMIT);
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ? `${arg.message}\n${arg.stack}` : arg.message;
  }
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function combine(args: unknown[]): { message: string; stack?: string } {
  const stacks: string[] = [];
  const parts: string[] = [];
  for (const a of args) {
    if (a instanceof Error && a.stack) stacks.push(a.stack);
    parts.push(stringifyArg(a));
  }
  return {
    message: parts.join(" "),
    stack: stacks.length > 0 ? stacks.join("\n---\n") : undefined,
  };
}

/**
 * Patch console.error / console.warn so every call is mirrored into the
 * buffer (the original call still runs so DevTools is unaffected). Also
 * hooks window error + unhandled rejection. Idempotent.
 */
export function installErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origError = console.error;
  console.error = (...args: unknown[]) => {
    const { message, stack } = combine(args);
    pushEntry({ at: new Date(), level: "error", message, stack });
    origError(...args);
  };

  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const { message, stack } = combine(args);
    pushEntry({ at: new Date(), level: "warn", message, stack });
    origWarn(...args);
  };

  window.addEventListener("error", (e) => {
    pushEntry({
      at: new Date(),
      level: "uncaught",
      message: e.message || "(uncaught error)",
      stack: e.error instanceof Error ? e.error.stack : undefined,
      source: `${e.filename}:${e.lineno}:${e.colno}`,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const { message, stack } = combine([reason]);
    pushEntry({
      at: new Date(),
      level: "rejection",
      message: message || "(unhandled rejection)",
      stack,
    });
  });
}
