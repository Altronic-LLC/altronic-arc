import { useSyncExternalStore } from "react";

// =============================================================================
// Detects when the signed-in MSAL session has gone stale and needs a fresh
// sign-in — the fix for the app "going blank" after sitting idle a long time.
//
// What was happening: acquireTokenSilent (and its acquireTokenPopup fallback)
// would fail after a long idle period — most likely the popup getting
// blocked by the browser since a background query refetch has no user
// gesture behind it — and graphFetch throws SessionExpiredError. React
// Query's default retry policy deliberately skips retrying that error
// ("let the AuthGate handle re-login" — see main.tsx), but nothing actually
// consumed it: every hook destructures its query with a `?? []` fallback,
// so a fully-failed query renders as "0 active" / "nothing here" instead of
// an error, and the header's "Connected to SharePoint" label is static, not
// a live check. The dashboard looked normal but every count was silently
// wrong.
//
// Fix: a global store (this file) that any query/mutation failure can flip
// via markSessionExpired(). AuthGate subscribes and reacts by auto-signing
// the user out and back to the sign-in page — a fresh sign-in gets a fresh
// token and the real data back, instead of the app quietly showing zeroes.
// =============================================================================

let expired = false;
let listeners: Array<() => void> = [];

function notify() {
  for (const fn of listeners) fn();
}

function getSnapshot() {
  return expired;
}

function subscribe(fn: () => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((listener) => listener !== fn);
  };
}

/** Call from anywhere a request fails with SessionExpiredError. Idempotent. */
export function markSessionExpired() {
  if (expired) return;
  expired = true;
  notify();
}

/** Call once the user has successfully signed in again. */
export function resetSessionExpired() {
  if (!expired) return;
  expired = false;
  notify();
}

/** True once a request has reported the session expired, until `resetSessionExpired()`. */
export function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** True if `error` is (or wraps) the app's SessionExpiredError. */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof Error && error.name === "SessionExpiredError";
}
