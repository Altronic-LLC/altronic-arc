// =============================================================================
// App URL helpers — build absolute links to in-app detail pages that keep the
// GitHub Pages deploy sub-path (Vite's BASE_URL, e.g. "/altronic-arc/").
//
// Used wherever we need a link that lives OUTSIDE the running React tree:
//   - the EIR→Task promotion stamps the task's EIRReference hyperlink column
//     with a link back to the source EIR;
//   - email notifications link to the task/EIR that was commented on.
// Router uses BrowserRouter with `basename = BASE_URL`, so a detail URL is
// `${origin}${base}${seg}/${id}` — no hash.
// =============================================================================

export type AppItemKind =
  | "task"
  | "eir"
  | "operationsTask"
  | "buildRequest"
  | "buildRequestItem"
  | "panelOrder";

const KIND_SEGMENTS: Record<AppItemKind, string> = {
  task: "task",
  eir: "eir",
  operationsTask: "operations/task",
  buildRequest: "build-request",
  // A redirect route: App.tsx looks the item up and forwards to its parent
  // header page with ?item=<id> so the right part card expands.
  buildRequestItem: "build-request-item",
  panelOrder: "panels/order",
};

/** Absolute URL to an item's detail page in this app. */
export function appItemUrl(kind: AppItemKind, id: number): string {
  const base = import.meta.env.BASE_URL ?? "/"; // trailing slash, e.g. "/altronic-arc/"
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${base}${KIND_SEGMENTS[kind]}/${id}`;
}
