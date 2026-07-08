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

/** Absolute URL to a task or EIR detail page in this app. */
export function appItemUrl(kind: "task" | "eir", id: number): string {
  const seg = kind === "eir" ? "eir" : "task";
  const base = import.meta.env.BASE_URL ?? "/"; // trailing slash, e.g. "/altronic-arc/"
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${base}${seg}/${id}`;
}
