// =============================================================================
// API configuration — single source of truth for "where is the data coming
// from" decisions. Read from Vite env vars at build time.
// =============================================================================

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

export const SP_SITE_ID = import.meta.env.VITE_SP_SITE_ID;
export const SP_LIST_ID = import.meta.env.VITE_SP_LIST_ID;
export const SP_PROJECTS_LIST_ID = import.meta.env.VITE_SP_PROJECTS_LIST_ID;
/** "Test Results" list on the same Altronic Engineering site. */
export const SP_TEST_RESULTS_LIST_ID = import.meta.env.VITE_SP_TEST_RESULTS_LIST_ID;

/** "Engineering Information Request" (EIR) list on the same site. */
export const SP_EIRS_LIST_ID = import.meta.env.VITE_SP_EIRS_LIST_ID;

/**
 * Admins list — single-column ("Email" Title-field) SharePoint list that
 * controls who sees admin UI in this app. Optional; if unset, falls back
 * to a small hardcoded set in `useIsAdmin`.
 */
export const SP_ADMINS_LIST_ID = import.meta.env.VITE_SP_ADMINS_LIST_ID;

/**
 * EIR Roles list — one row per user (Title = email) with a `Roles` text
 * column (CSV of "engineer" / "supply chain"). Controls which EIR fields a
 * user may edit. Managed at /admin/eir-roles by admins.
 */
export const SP_EIR_ROLES_LIST_ID = import.meta.env.VITE_SP_EIR_ROLES_LIST_ID;

/**
 * Whether EIR field-level role gating is active. Off in real mode until the
 * EIR Roles list is configured, so nobody is locked out of editing the gated
 * fields before an admin has set the list up and added people. Always on in
 * mock mode so the feature is demoable.
 */
export const EIR_ROLES_ENFORCED = USE_MOCK || !!SP_EIR_ROLES_LIST_ID;

/**
 * SharePoint site web URL — used to call the SP REST API (specifically for
 * list-item attachments, which Graph v1.0 doesn't surface cleanly).
 * Example: https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering
 * If unset, attachment features degrade gracefully.
 */
export const SP_SITE_URL = import.meta.env.VITE_SP_SITE_URL as string | undefined;

/**
 * Email address of the shared mailbox @-mention notifications send FROM.
 * Each user who can post comments must have Send-As permission on this
 * mailbox in Exchange. Leave blank to disable email notifications — they
 * fall back to console.log entries instead.
 */
export const SHARED_MAILBOX = import.meta.env.VITE_SHARED_MAILBOX as string | undefined;

/**
 * Email address of the app maintainer — recipient of "Notify app manager"
 * error reports. Falls back to a sensible default if unset so the button
 * still works on day one even before the env var is wired up.
 */
export const APP_MANAGER_EMAIL =
  (import.meta.env.VITE_APP_MANAGER_EMAIL as string | undefined) ??
  "ray.white@altronic-llc.com";

// =============================================================================
// SharePoint site registry — ARC is going multi-site (one site per team).
//
// Each value is a Graph site ID: "host,siteCollectionId,webId". `Sites.Selected`
// is granted per SITE COLLECTION by an admin; a subsite shares its parent
// collection's grant. Order Entry is a SUBSITE of the Sales Team collection
// (same middle GUID) — one grant on ALTRONICSALESTEAM covers both.
//
// Values come from env vars when set (repo Action variables), otherwise the
// documented defaults below (discovered via Graph; stable, not secret). New
// cross-site api/<list>.ts modules should reference SITES.<name> instead of the
// single SP_SITE_ID so their Graph paths hit the right site.
// =============================================================================
export const SITES = {
  engineering:
    import.meta.env.VITE_SP_ENGINEERING_SITE_ID ||
    SP_SITE_ID ||
    "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a",
  panelTeam:
    import.meta.env.VITE_SP_PANELTEAM_SITE_ID ||
    "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb",
  salesTeam:
    import.meta.env.VITE_SP_SALESTEAM_SITE_ID ||
    "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a",
  salesOrderEntry:
    import.meta.env.VITE_SP_SALES_ORDERENTRY_SITE_ID ||
    "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,583688a6-3238-4f79-aed5-8e2d8ce38c41",
  pmo:
    import.meta.env.VITE_SP_PMO_SITE_ID ||
    "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb",
} as const;

// =============================================================================
// Operations department — all three lists live on the PMO site (SITES.pmo).
// IDs discovered live via Graph on 2026-07-15; env-overridable, same pattern
// as SITES above.
// =============================================================================

/** "Operations Task List" on the PMO site. */
export const SP_OPERATIONS_TASKS_LIST_ID =
  import.meta.env.VITE_SP_OPERATIONS_TASKS_LIST_ID ||
  "298ac5c5-6c53-4262-95e7-e1cfca06978b";

/** "Operations Projects" — this department's own parent-project reference list. */
export const SP_OPERATIONS_PROJECTS_LIST_ID =
  import.meta.env.VITE_SP_OPERATIONS_PROJECTS_LIST_ID ||
  "6734ddec-95e0-4cc7-93af-7fd20bf7ac22";

/** "Altronic Equipment List" — read-only reference for the task form's Equipment picker. */
export const SP_ALTRONIC_EQUIPMENT_LIST_ID =
  import.meta.env.VITE_SP_ALTRONIC_EQUIPMENT_LIST_ID ||
  "6f2fb6e1-3b41-40de-b78b-2c43c3c3d068";

/**
 * PMO site's classic SharePoint REST root — needed for Operations task
 * attachments (SP REST, not Graph; see src/api/attachments.ts). Same tenant
 * as SP_SITE_URL, so the same acquired token covers both — only the path
 * differs.
 */
export const SP_PMO_SITE_URL =
  (import.meta.env.VITE_SP_PMO_SITE_URL as string | undefined) ??
  "https://coopermachineryservices.sharepoint.com/sites/Altronic_PMO";

// =============================================================================
// Build Requests — TWO lists on the Engineering site (SITES.engineering /
// SP_SITE_ID) forming a master-detail pair. IDs discovered live via Graph on
// 2026-07-16; env-overridable, same pattern as the Operations lists.
// =============================================================================

/** "Build Request Tracker" — the header list (BR No, status, requestor, …). */
export const SP_BUILD_REQUESTS_LIST_ID =
  import.meta.env.VITE_SP_BUILD_REQUESTS_LIST_ID ||
  "7e0f94cc-b3a3-4c89-8552-7fd97cfa46d9";

/** "Build Request Items" — the parts list; items join to headers via BuildRequestNoLookupId. */
export const SP_BUILD_REQUEST_ITEMS_LIST_ID =
  import.meta.env.VITE_SP_BUILD_REQUEST_ITEMS_LIST_ID ||
  "5572f186-961d-44b1-b01d-1fffffe17b26";

// =============================================================================
// Panels department — three lists on the ALTRONICPANELTEAM site
// (SITES.panelTeam). IDs discovered live via Graph on 2026-07-17;
// env-overridable, same pattern as the Operations lists.
// =============================================================================

/** "Panel Order Headers" — one item per panel sales order (the main entity). */
export const SP_PANEL_ORDERS_LIST_ID =
  import.meta.env.VITE_SP_PANEL_ORDERS_LIST_ID ||
  "8561acf4-b583-459b-aafd-2106803a70c7";

/** "Panel Project Reference" — admin-managed project reference list (Title = ref number). */
export const SP_PANEL_PROJECTS_LIST_ID =
  import.meta.env.VITE_SP_PANEL_PROJECTS_LIST_ID ||
  "7b2927fb-468e-4305-8d97-7415e70ae986";

/** "Panel User Roles" — admin-managed roles list (one row = one User person + one Role choice). */
export const SP_PANEL_ROLES_LIST_ID =
  import.meta.env.VITE_SP_PANEL_ROLES_LIST_ID ||
  "2d67d242-7419-453f-a388-7454bf3e7f4b";

/**
 * Panel team site's classic SharePoint REST root — needed for panel order
 * attachments and site-user resolution (single-person fields only return a
 * bare LookupId via Graph). Same tenant/token as SP_SITE_URL.
 */
export const SP_PANELTEAM_SITE_URL =
  (import.meta.env.VITE_SP_PANELTEAM_SITE_URL as string | undefined) ??
  "https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM";

/**
 * Whether panel field-level role gating is active. No fields are gated in
 * v1 — this flag (and useMyPanelRoles) ship dark, ready for the first gated
 * field. Same lockout-safety shape as EIR_ROLES_ENFORCED: off in real mode
 * until the roles list id is configured. (The default id above counts as
 * configured, so this is effectively USE_MOCK || true — kept in this shape
 * so an env override to "" can switch gating off without a code change.)
 */
export const PANEL_ROLES_ENFORCED = USE_MOCK || !!SP_PANEL_ROLES_LIST_ID;

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
