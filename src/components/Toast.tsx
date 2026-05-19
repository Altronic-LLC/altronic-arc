import { useSyncExternalStore } from "react";
import { CheckCircle2, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/cn";

// =============================================================================
// Toast system — module-level store + ToastContainer component. Any module
// can call `pushToast({ message, undo })` to surface a brief notification at
// the bottom-right of the screen. Used by the mutation hooks to confirm
// every successful SharePoint write and offer an undo handle.
// =============================================================================

export interface Toast {
  id: string;
  message: string;
  /** Optional undo handler — Undo button only appears if this is provided. */
  undo?: () => void;
  variant?: "default" | "error";
}

const DEFAULT_DURATION_MS = 7000;

let toasts: Toast[] = [];
let listeners: Array<() => void> = [];

function notify() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

function getSnapshot() {
  return toasts;
}

interface PushToastInput {
  message: string;
  undo?: () => void;
  variant?: "default" | "error";
  durationMs?: number;
}

export function pushToast(input: PushToastInput): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const toast: Toast = {
    id,
    message: input.message,
    undo: input.undo,
    variant: input.variant ?? "default",
  };
  toasts = [...toasts, toast];
  notify();
  // Auto-dismiss. The clearTimeout handle isn't tracked because dismissing
  // a non-existent id is a no-op.
  if (typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(id), input.durationMs ?? DEFAULT_DURATION_MS);
  }
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function clearAllToasts() {
  toasts = [];
  notify();
}

/** Render the floating toast list. Mount once at the app root. */
export function ToastContainer() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col-reverse items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end">
      {list.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const isError = toast.variant === "error";
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border bg-surface px-3 py-2 shadow-lg sm:max-w-sm",
        isError ? "border-cooper-red/40 bg-cooper-red/10" : "border-border",
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          isError ? "text-cooper-red" : "text-cooper-green",
        )}
      >
        <CheckCircle2 className="h-4 w-4" />
      </span>
      <span className={cn("flex-1 text-sm", isError ? "text-cooper-red" : "text-fg")}>
        {toast.message}
      </span>
      {toast.undo && (
        <button
          onClick={() => {
            toast.undo?.();
            dismissToast(toast.id);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
        >
          <RotateCcw className="h-3 w-3" />
          Undo
        </button>
      )}
      <button
        onClick={() => dismissToast(toast.id)}
        className="shrink-0 rounded p-0.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
