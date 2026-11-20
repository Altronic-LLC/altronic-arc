import { useSyncExternalStore } from "react";

// =============================================================================
// The signed-in person's GitHub token, kept in THIS browser's localStorage.
//
// Never in the bundle (see api/githubIssues.ts), never in SharePoint, never
// sent anywhere but api.github.com. Per browser, so it is pasted once per
// machine; "Disconnect" removes it.
//
// Every storage access is wrapped: the accessor itself throws in a private
// window or with site data blocked, and the Feature Requests screen must still
// render then — it just behaves as "not connected".
// =============================================================================

export const GITHUB_TOKEN_STORAGE_KEY = "arc.github.businessItToken";

let listeners: Array<() => void> = [];

function read(): string {
  try {
    return window.localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function emit() {
  for (const fn of listeners) fn();
}

export function setGitHubToken(token: string): void {
  try {
    const trimmed = token.trim();
    if (trimmed) window.localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
  } catch {
    /* storage blocked — stays disconnected */
  }
  emit();
}

export function clearGitHubToken(): void {
  setGitHubToken("");
}

function subscribe(fn: () => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

/** The saved token, or "" — re-renders every caller when it's set or cleared. */
export function useGitHubToken(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}

/** For a mutationFn, which must not read a render-time value. */
export function readGitHubToken(): string {
  return read();
}
