// =============================================================================
// Which SharePoint lists each ARC app needs, and what to call the sites.
//
// One registry, read by three places that must agree: the app-wide access
// banner, the Departments menu, and the Dashboard cards. Two copies of "which
// list is behind Teradyne Log" is how a fix reaches the menu and not the card.
//
// It lives in api/ beside config.ts because that is where ARC's knowledge of
// SharePoint ids already lives — lib/ deliberately doesn't import api/, so the
// PURE half of this feature (parsing a refusal, wording a sentence) is in
// lib/listAccess.ts and only the ids are here.
//
// THE RULE FOR `lists`: an app counts as unavailable when EVERY list named
// here is refused, never when just one is. Most apps name a single list, so
// the two readings coincide — the difference matters for the multi-register
// screens (Drawing File Logs' four registers, Digital/Ignition QC's product
// families), where one refused register still leaves a working screen. The
// in-screen notice (ListAccessNotice) is what covers a partial refusal; this
// registry only answers "can they get in at all".
// =============================================================================

import {
  SITES,
  SP_ALTRONIC_EQUIPMENT_LIST_ID,
  SP_BUILD_REQUESTS_LIST_ID,
  SP_CAD_DRAWINGS_LIST_ID,
  SP_CCC_DRAWINGS_LIST_ID,
  SP_CEC_DRAWINGS_LIST_ID,
  SP_COST_IMPACT_NOTICES_LIST_ID,
  SP_CSA_LISTINGS_LIST_ID,
  SP_CUSTOMER_NOTES_LIST_ID,
  SP_ECNS_LIST_ID,
  SP_EIRS_LIST_ID,
  SP_ENGINEERING_SKETCHES_LIST_ID,
  SP_FAIT_LIST_ID,
  SP_FEATURE_REQUESTS_LIST_ID,
  SP_GRAY_MARKET_LIST_ID,
  SP_LIST_ID,
  SP_MAINTENANCE_TASKS_LIST_ID,
  SP_MRB_LIST_ID,
  SP_OPEN_ORDERS_CUSTOMERS_LIST_ID,
  SP_OPERATIONS_TASKS_LIST_ID,
  SP_PANEL_ORDERS_LIST_ID,
  SP_PANEL_QC_ISSUES_LIST_ID,
  SP_PANEL_TASKS_LIST_ID,
  SP_POTTING_SAMPLE_LOG_LIST_ID,
  SP_QC_COILS_LIST_ID,
  SP_QC_CPU95_LIST_ID,
  SP_QC_TIME_TRACKING_LIST_ID,
  SP_SCHEDULED_MAINTENANCE_LIST_ID,
  SP_SUPPLIERS_LIST_ID,
  SP_TERADYNE_LOG_LIST_ID,
  SP_TEST_RESULTS_LIST_ID,
  SP_VISIT_REPORTS_LIST_ID,
  SP_WHERE_AM_I_LIST_ID,
} from "./config";
import { DIGITAL_QC_FAMILY_LIST_IDS } from "./digitalQc";
import { IGNITION_QC_FAMILY_LIST_IDS } from "./ignitionQc";
import { OPEN_ORDERS_PATH } from "./openOrdersFiles";
import { PROJECT_FOLDERS_PATH } from "./projectFiles";

export type SiteKey = keyof typeof SITES;

/**
 * What to call a site in a message. These are the SharePoint site names people
 * see in a URL and in a permission request — not ARC's department names, since
 * the person granting access works in SharePoint, not in ARC.
 */
export const SITE_LABELS: Record<SiteKey, string> = {
  engineering: "Altronic_Engineering",
  panelTeam: "ALTRONICPANELTEAM",
  salesTeam: "ALTRONICSALESTEAM",
  salesOrderEntry: "ALTRONICSALESTEAM/OrderEntry",
  pmo: "Altronic_PMO",
};

/**
 * Which site a site sits UNDER. OrderEntry is a subsite of the Sales Team site
 * (same site collection, different web — see the SITES registry).
 *
 * Refusal flows DOWNWARD only (Tim, 2026-09-24): no access to
 * ALTRONICSALESTEAM means no access to its OrderEntry subsite, so a refused
 * parent locks the child's apps too. The reverse is NOT true and must not be
 * inferred — a subsite can break permission inheritance and be shared with
 * people who can't open the parent, so a refused subsite says nothing about
 * the site above it.
 */
export const SITE_PARENTS: Partial<Record<SiteKey, SiteKey>> = {
  salesOrderEntry: "salesTeam",
};

/** A site and every site above it, nearest first. */
export function siteAncestry(site: SiteKey): SiteKey[] {
  const chain: SiteKey[] = [site];
  let parent = SITE_PARENTS[site];
  while (parent && !chain.includes(parent)) {
    chain.push(parent);
    parent = SITE_PARENTS[parent];
  }
  return chain;
}

export interface AppSpec {
  /** The route this app opens at — the key both the menu and the cards use. */
  path: string;
  /** What the user calls it. Matches the Departments menu label. */
  label: string;
  site: SiteKey;
  /** Unavailable only when every one of these is refused. See the header. */
  lists: string[];
  /**
   * The screen's content is FILES in the site's document library, so a refused
   * library makes it unusable whatever its lists say. Kept separate from a
   * site-wide refusal: a library with its own broken permission inheritance is
   * ordinary SharePoint, and it must not lock the site's other apps.
   */
  needsDrive?: boolean;
  /**
   * The exact folder the screen reads, relative to the drive root — the same
   * path the feature itself uses, imported rather than retyped.
   *
   * Probing the drive ROOT is not enough: Tim could read the Sales library's
   * root and still got `itemNotFound` on the OPEN ORDERS folder inside it
   * (2026-09-24), so the app stayed unlocked while its screen showed nothing.
   * A folder that can't be read is asked about directly.
   */
  drivePath?: string;
}

/** Drop ids that aren't configured — an unset env var is not a denial. */
function ids(...values: Array<string | undefined>): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export const APPS: AppSpec[] = [
  // Engineering ---------------------------------------------------------
  { path: "/list", label: "Engineering Tasks", site: "engineering", lists: ids(SP_LIST_ID) },
  { path: "/kanban", label: "Engineering Tasks", site: "engineering", lists: ids(SP_LIST_ID) },
  { path: "/task", label: "Engineering Tasks", site: "engineering", lists: ids(SP_LIST_ID) },
  { path: "/eirs", label: "EIRs", site: "engineering", lists: ids(SP_EIRS_LIST_ID) },
  { path: "/test-sheets", label: "Test Sheets", site: "engineering", lists: ids(SP_TEST_RESULTS_LIST_ID) },
  {
    path: "/project-folders",
    label: "Project Folders",
    site: "engineering",
    lists: [],
    needsDrive: true,
    drivePath: PROJECT_FOLDERS_PATH,
  },
  { path: "/build-requests", label: "Build Requests", site: "engineering", lists: ids(SP_BUILD_REQUESTS_LIST_ID) },
  {
    path: "/drawing-logs",
    label: "Drawing File Logs",
    site: "engineering",
    lists: ids(
      SP_CAD_DRAWINGS_LIST_ID,
      SP_CCC_DRAWINGS_LIST_ID,
      SP_CEC_DRAWINGS_LIST_ID,
      SP_ENGINEERING_SKETCHES_LIST_ID,
    ),
  },
  { path: "/csa-listings", label: "CSA Listings", site: "engineering", lists: ids(SP_CSA_LISTINGS_LIST_ID) },
  { path: "/engineering/where-am-i", label: "Where Am I?", site: "engineering", lists: ids(SP_WHERE_AM_I_LIST_ID) },
  { path: "/engineering/ecns", label: "ECNs", site: "engineering", lists: ids(SP_ECNS_LIST_ID) },
  { path: "/feature-requests", label: "ARC Feature Requests", site: "engineering", lists: ids(SP_FEATURE_REQUESTS_LIST_ID) },

  // Panels ---------------------------------------------------------------
  { path: "/panels/orders", label: "Panel Orders", site: "panelTeam", lists: ids(SP_PANEL_ORDERS_LIST_ID) },
  { path: "/panels/tasks", label: "Panel Tasks", site: "panelTeam", lists: ids(SP_PANEL_TASKS_LIST_ID) },
  { path: "/panels/qc-time-tracking", label: "QC Time Tracking", site: "panelTeam", lists: ids(SP_QC_TIME_TRACKING_LIST_ID) },
  { path: "/panels/qc-issues", label: "Panel QC Issue Tracker", site: "panelTeam", lists: ids(SP_PANEL_QC_ISSUES_LIST_ID) },

  // Operations -----------------------------------------------------------
  { path: "/operations/tasks", label: "Operational Tasks", site: "pmo", lists: ids(SP_OPERATIONS_TASKS_LIST_ID) },
  { path: "/operations/teradyne", label: "Teradyne Log", site: "pmo", lists: ids(SP_TERADYNE_LOG_LIST_ID) },
  { path: "/operations/maintenance/schedules", label: "Maintenance Schedules", site: "pmo", lists: ids(SP_SCHEDULED_MAINTENANCE_LIST_ID) },
  { path: "/operations/maintenance/assets", label: "Equipment Register", site: "pmo", lists: ids(SP_ALTRONIC_EQUIPMENT_LIST_ID) },
  { path: "/operations/maintenance", label: "Work Orders", site: "pmo", lists: ids(SP_MAINTENANCE_TASKS_LIST_ID) },

  // Coils ----------------------------------------------------------------
  { path: "/coils/defect-log", label: "Coil Defect Log", site: "engineering", lists: ids(SP_QC_COILS_LIST_ID) },
  { path: "/coils/potting-sample-log", label: "Potting Sample Log", site: "pmo", lists: ids(SP_POTTING_SAMPLE_LOG_LIST_ID) },

  // Quality --------------------------------------------------------------
  { path: "/digital-qc", label: "Digital QC Defect Log", site: "engineering", lists: ids(...Object.values(DIGITAL_QC_FAMILY_LIST_IDS)) },
  { path: "/ignition-qc", label: "Ignition QC Defect Log", site: "engineering", lists: ids(...Object.values(IGNITION_QC_FAMILY_LIST_IDS)) },
  { path: "/qc-forms", label: "QC Forms", site: "engineering", lists: ids(SP_QC_CPU95_LIST_ID) },

  // Supply Chain ---------------------------------------------------------
  { path: "/supply-chain/gray-market-requests", label: "Gray Market Requests", site: "pmo", lists: ids(SP_GRAY_MARKET_LIST_ID) },
  { path: "/supply-chain/suppliers", label: "Suppliers", site: "pmo", lists: ids(SP_SUPPLIERS_LIST_ID) },
  { path: "/supply-chain/cost-impact-notices", label: "Cost Impact Notices", site: "salesTeam", lists: ids(SP_COST_IMPACT_NOTICES_LIST_ID) },
  { path: "/supply-chain/faits", label: "FAITs", site: "engineering", lists: ids(SP_FAIT_LIST_ID) },
  { path: "/supply-chain/mrb", label: "MRB", site: "pmo", lists: ids(SP_MRB_LIST_ID) },

  // Sales ----------------------------------------------------------------
  // Everything on this screen is a workbook in the Sales document library —
  // the customer list only says who gets one — so a refused library locks it.
  {
    path: "/sales/open-orders",
    label: "Open Orders Report",
    site: "salesTeam",
    lists: ids(SP_OPEN_ORDERS_CUSTOMERS_LIST_ID),
    needsDrive: true,
    drivePath: OPEN_ORDERS_PATH,
  },
  { path: "/sales/visit-reports", label: "Visit Reports", site: "salesTeam", lists: ids(SP_VISIT_REPORTS_LIST_ID) },
  { path: "/sales/customers", label: "Customers", site: "salesOrderEntry", lists: ids(SP_CUSTOMER_NOTES_LIST_ID) },
];

/** Strip a query string, hash and trailing slash before matching a route. */
export function normalisePath(path: string): string {
  const bare = path.split(/[?#]/)[0];
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

/**
 * The app a route belongs to. Exact match first, then the longest registered
 * path this route sits UNDER — so `/operations/maintenance/assets` finds the
 * equipment register rather than Work Orders, and a detail page
 * (`/supply-chain/supplier/42`) still resolves to its list.
 */
export function appForPath(path: string): AppSpec | undefined {
  const target = normalisePath(path);
  const exact = APPS.find((app) => app.path === target);
  if (exact) return exact;

  return APPS.filter((app) => target === app.path || target.startsWith(`${app.path}/`)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
}

/** Every site id ARC knows, with the label to show for it. */
export function siteLabelForId(siteId: string): string | null {
  const entry = (Object.keys(SITES) as SiteKey[]).find(
    (key) => SITES[key].toLowerCase() === siteId.toLowerCase(),
  );
  return entry ? SITE_LABELS[entry] : null;
}

export interface AccessDenials {
  lists: ReadonlySet<string>;
  /** Sites refused outright — every app on one is out of reach. */
  sites: ReadonlySet<string>;
  /** Sites whose DOCUMENT LIBRARY was refused. Only `needsDrive` apps care. */
  drives: ReadonlySet<string>;
  /**
   * App paths whose data ARC could not read, for a reason that is NOT a
   * refusal — a folder that answers `itemNotFound`, or a list that hands back
   * none of the rows SharePoint says it holds. See `appAccessState`.
   */
  unreadableApps: ReadonlySet<string>;
}

/**
 * Why an app can't be opened — or "ok".
 *
 * Two lock reasons, deliberately not merged (Tim, 2026-09-24: lock these like
 * the others — but they are not the same fault):
 *
 *  - **`"no-access"`** — SharePoint refused it, 403. Somebody can grant it.
 *  - **`"unreadable"`** — nothing was refused and the data still isn't there:
 *    the OPEN ORDERS folder answering `itemNotFound`, or a list handing back
 *    zero of the rows it reports holding. Calling that "no access" would send
 *    people to ask for something they may already have.
 */
export type AppAccessState = "ok" | "no-access" | "unreadable";

export function appAccessState(app: AppSpec, denials: AccessDenials): AppAccessState {
  // The app's own site OR any site above it — a refused parent takes its
  // subsites with it. See SITE_PARENTS for why this is one-directional.
  if (siteAncestry(app.site).some((site) => denials.sites.has(SITES[site]))) return "no-access";
  // A document library is NOT inherited this way: each site has its own, and a
  // library's unique permissions are its own business.
  if (app.needsDrive && denials.drives.has(SITES[app.site])) return "no-access";
  if (app.lists.length > 0 && app.lists.every((id) => denials.lists.has(id))) return "no-access";
  // Checked LAST: a refusal is the more specific and more actionable answer.
  if (denials.unreadableApps.has(app.path)) return "unreadable";
  return "ok";
}

/** Is this app out of reach, for either reason? */
export function isAppUnavailable(app: AppSpec, denials: AccessDenials): boolean {
  return appAccessState(app, denials) !== "ok";
}

/**
 * The state of the app behind this route. The form the Departments menu and
 * the Dashboard cards use, where a hook per item isn't an option (a hook can't
 * live inside a `.map`), so they read the denials once and ask this per row.
 */
export function pathAccessState(
  path: string | undefined,
  denials: AccessDenials,
): AppAccessState {
  if (!path) return "ok";
  const app = appForPath(path);
  return app ? appAccessState(app, denials) : "ok";
}

export function isPathUnavailable(path: string | undefined, denials: AccessDenials): boolean {
  return pathAccessState(path, denials) !== "ok";
}

/** The app labels to name in the notice, split by reason, in registry order. */
export function accessGapLabels(denials: AccessDenials): {
  noAccess: string[];
  unreadable: string[];
} {
  const noAccess: string[] = [];
  const unreadable: string[] = [];
  for (const app of APPS) {
    const state = appAccessState(app, denials);
    if (state === "no-access" && !noAccess.includes(app.label)) noAccess.push(app.label);
    if (state === "unreadable" && !unreadable.includes(app.label)) unreadable.push(app.label);
  }
  return { noAccess, unreadable };
}

/** The app labels to name in the notice, deduped and in registry order. */
export function unavailableAppLabels(denials: AccessDenials): string[] {
  const { noAccess, unreadable } = accessGapLabels(denials);
  return [...noAccess, ...unreadable];
}
