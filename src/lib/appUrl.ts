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
  | "ecn"
  | "fait"
  | "operationsTask"
  | "maintenanceTask"
  | "buildRequest"
  | "buildRequestItem"
  | "panelOrder"
  | "panelTask"
  | "panelQcIssue"
  | "grayMarketRequest"
  | "mrb"
  | "customerNote"
  | "supplier"
  | "supplierContact"
  | "supplierIssue"
  | "costImpactNotice"
  | "featureRequest";

const KIND_SEGMENTS: Record<AppItemKind, string> = {
  task: "task",
  eir: "eir",
  ecn: "engineering/ecn",
  fait: "supply-chain/fait",
  operationsTask: "operations/task",
  // The CMMS work-order detail page. The route is wired up with the views;
  // this segment is the contract between them and every notification email.
  maintenanceTask: "operations/maintenance-task",
  buildRequest: "build-request",
  // A redirect route: App.tsx looks the item up and forwards to its parent
  // header page with ?item=<id> so the right part card expands.
  buildRequestItem: "build-request-item",
  panelOrder: "panels/order",
  panelTask: "panels/task",
  panelQcIssue: "panels/qc-issues",
  grayMarketRequest: "supply-chain/gray-market-request",
  mrb: "supply-chain/mrb",
  customerNote: "sales/customers",
  supplier: "supply-chain/supplier",
  // Redirect routes: App.tsx looks the row up and forwards to its parent
  // supplier's page with ?contact=<id> / ?issue=<id> so the right card
  // expands — the same arrangement as buildRequestItem above.
  supplierContact: "supply-chain/supplier-contact",
  supplierIssue: "supply-chain/supplier-issue",
  costImpactNotice: "supply-chain/cost-impact-notice",
  featureRequest: "feature-request",
};

/** Absolute URL to an item's detail page in this app. */
export function appItemUrl(kind: AppItemKind, id: number): string {
  const base = import.meta.env.BASE_URL ?? "/"; // trailing slash, e.g. "/altronic-arc/"
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${base}${KIND_SEGMENTS[kind]}/${id}`;
}

/**
 * The ROUTER path to an item, with no origin and no deploy sub-path —
 * `/task/47`, not `https://host/altronic-arc/task/47`.
 *
 * For a link that gets STORED. A comment mirrored onto another record lives
 * in a SharePoint text column for years, so baking in `window.location.origin`
 * (or the Pages sub-path) would break every one of them the day ARC moves
 * host or base path. `CommentThread` intercepts clicks on these and routes
 * them, so the path is resolved against the router at CLICK time instead.
 *
 * Deliberately NOT for an email — mail has no router to resolve a bare path
 * against, so notifications keep using `appItemUrl`.
 */
export function appItemPath(kind: AppItemKind, id: number): string {
  return `/${KIND_SEGMENTS[kind]}/${id}`;
}
