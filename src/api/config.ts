// =============================================================================
// API configuration — single source of truth for "where is the data coming
// from" decisions. Read from Vite env vars at build time.
// =============================================================================

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

export const SP_SITE_ID = import.meta.env.VITE_SP_SITE_ID;
export const SP_LIST_ID = import.meta.env.VITE_SP_LIST_ID;
export const SP_PROJECTS_LIST_ID = import.meta.env.VITE_SP_PROJECTS_LIST_ID;

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Throw a clear error if the app tries to call Graph without being configured. */
export function assertGraphConfigured(): void {
  if (USE_MOCK) return;
  if (!SP_SITE_ID || !SP_LIST_ID) {
    throw new Error(
      "Graph mode is on but VITE_SP_SITE_ID or VITE_SP_LIST_ID is missing from the environment.",
    );
  }
  if (!import.meta.env.VITE_AZURE_CLIENT_ID) {
    throw new Error(
      "Graph mode is on but VITE_AZURE_CLIENT_ID is missing — the app registration's client ID must be set.",
    );
  }
}
