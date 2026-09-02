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
 *
 * **The list exists**: `e85aeb77-9dbf-4962-ade2-08cb977a5b79` on the
 * Engineering site, confirmed live 2026-08-24.
 *
 * It is deliberately NOT a default here, unlike most list ids in this file.
 * Setting it switches EIR field gating ON (see EIR_ROLES_ENFORCED below), and
 * every engineer not yet on the list would lose fields they can edit today.
 * Populate the list first, then set the env var — the switch-on is a decision,
 * not a piece of configuration tidying.
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
 * Quick Links list — admin-managed external-link buttons shown above each
 * Dashboard department's cards. One shared list (Title = label, `Url` text,
 * `Department` choice matching `DASHBOARD_DEPARTMENTS`, `SortOrder` number),
 * on the Engineering site like Admins and EIR Roles. No default id: the list
 * doesn't exist yet, and (like Admins) the feature simply shows nothing —
 * not an error — until this is set. Managed at /admin/quick-links.
 */
export const SP_QUICK_LINKS_LIST_ID = import.meta.env.VITE_SP_QUICK_LINKS_LIST_ID;

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

// -----------------------------------------------------------------------------
// CMMS (maintenance) — two more lists on the PMO site, alongside the Operations
// Task List and the Altronic Equipment List those two already point at. IDs
// discovered live 2026-08-27 (see scripts/altronic-maintenance-tasks-schema.json
// and scripts/scheduled-maintenance-schema.json).
//
// Both are env-overridable with the documented default, the same shape as
// SP_OPERATIONS_TASKS_LIST_ID above — these lists exist and are empty, so a
// default can't lock anyone out of anything the way EIR Roles' would.
// -----------------------------------------------------------------------------

/** "Altronic Maintenance Tasks" — the work orders. */
export const SP_MAINTENANCE_TASKS_LIST_ID =
  import.meta.env.VITE_SP_MAINTENANCE_TASKS_LIST_ID ||
  "ff9d837f-227f-4a9b-b534-5fc722ff8c3b";

/** "Scheduled Maintenance" — the PM schedules work orders are raised from. */
export const SP_SCHEDULED_MAINTENANCE_LIST_ID =
  import.meta.env.VITE_SP_SCHEDULED_MAINTENANCE_LIST_ID ||
  "9179e16d-5cc8-41bd-b085-eccd39293f98";

/**
 * "Maintenance Departments" and "Maintenance Locations" — the two admin-managed
 * reference lists behind the `DepartmentRef` / `LocationRef` single lookups on
 * the Equipment List, Maintenance Tasks and Scheduled Maintenance.
 *
 * **They replaced CHOICE columns, and that is the whole point.** A choice
 * column's allowed values live in the column DEFINITION, so adding a
 * department means PATCHing the column — which needs site-manage rights. ARC
 * holds `Sites.Selected`: item read/write only. With a lookup, adding a
 * department is adding a LIST ITEM, which ARC can already do — so the shop can
 * maintain its own departments and locations from /admin rather than raising a
 * ticket. Same pattern as Operations Projects, Panel Projects and the three
 * Teradyne reference lists.
 *
 * Documented defaults, like the two list ids above and unlike
 * SP_MAINTENANCE_ROLES_LIST_ID below: these are plain reference lists that
 * gate nothing. A default here can't lock anyone out of anything — the worst
 * it can do is point a picker at the wrong list, which is visible immediately.
 *
 * Each list has `Title` (the value), `Active` (boolean) and `Note`
 * (multi-line). Discovered live 2026-08-28: 9 departments, 64 locations.
 */
export const SP_MAINTENANCE_DEPARTMENTS_LIST_ID =
  import.meta.env.VITE_SP_MAINTENANCE_DEPARTMENTS_LIST_ID ||
  "3c203f31-4c07-44fd-8108-7208bb2644bc";

export const SP_MAINTENANCE_LOCATIONS_LIST_ID =
  import.meta.env.VITE_SP_MAINTENANCE_LOCATIONS_LIST_ID ||
  "77f7c05f-acdc-46ff-bc5f-f73c48fc81e3";

/**
 * Maintenance Roles list — one row per user (Title = email) with a `Roles`
 * column carrying the level tags ("tech" / "admin"). Created by
 * scripts/create-maintenance-roles-list.ps1 on the PMO site, managed at
 * /admin/maintenance-roles by ARC admins.
 *
 * `Roles` is a CHOICE column, and whether it is single- or multi-value is not
 * confirmed — api/maintenanceRoles.ts reads and writes every shape it could
 * be rather than depending on one. See the note at the top of that file.
 *
 * **Deliberately NO default**, unlike the two list ids above — the same
 * reasoning as SP_EIR_ROLES_LIST_ID. Setting it switches CMMS role gating ON
 * (see MAINTENANCE_ROLES_ENFORCED below), and every tech not yet on the list
 * would lose the ability to close out a work order they can close today.
 * Populate the list first, then set the env var: the switch-on is a decision,
 * not a piece of configuration tidying.
 */
export const SP_MAINTENANCE_ROLES_LIST_ID = import.meta.env.VITE_SP_MAINTENANCE_ROLES_LIST_ID;

/**
 * Whether CMMS role gating is active.
 *
 * Same lockout-safety shape as EIR_ROLES_ENFORCED and
 * OPEN_ORDERS_ROLES_ENFORCED: OFF in real mode until the Maintenance Roles
 * list is configured, so an unconfigured list means "everyone keeps what they
 * can do today" and never "nobody can do anything". Always on in mock mode so
 * the gating is demoable.
 */
export const MAINTENANCE_ROLES_ENFORCED = USE_MOCK || !!SP_MAINTENANCE_ROLES_LIST_ID;

/**
 * PMO site's classic SharePoint REST root — needed for Operations task
 * attachments (SP REST, not Graph; see src/api/attachments.ts). Same tenant
 * as SP_SITE_URL, so the same acquired token covers both — only the path
 * differs.
 */
/**
 * Sales Team site's classic SharePoint REST root — needed for Visit Report
 * attachments (SP REST, not Graph; see src/api/attachments.ts). Same tenant as
 * SP_SITE_URL, so the same acquired token covers both — only the path differs.
 */
export const SP_SALESTEAM_SITE_URL =
  (import.meta.env.VITE_SP_SALESTEAM_SITE_URL as string | undefined) ??
  "https://coopermachineryservices.sharepoint.com/sites/ALTRONICSALESTEAM";

export const SP_PMO_SITE_URL =
  (import.meta.env.VITE_SP_PMO_SITE_URL as string | undefined) ??
  "https://coopermachineryservices.sharepoint.com/sites/Altronic_PMO";

// =============================================================================
// Drawing File Logs — FOUR drawing registers on the Engineering site, shown
// together under one screen. IDs discovered live 2026-07-29.
//
// A log with no configured id doesn't appear as a tab at all, so this stays
// tolerant of a list we can't resolve.
// =============================================================================

/**
 * "CAD Drawings" — 1,000+ rows. Its columns haven't been captured yet (only its
 * identity), so `api/drawingLogs.ts` deliberately fetches all fields for this one
 * rather than naming columns that might not exist. See the note there.
 */
export const SP_CAD_DRAWINGS_LIST_ID =
  import.meta.env.VITE_SP_CAD_DRAWINGS_LIST_ID ||
  "d1f818e9-a547-4277-a233-a9a790b79762";

/** "CCC Drawings" — 105 rows, with the 16-slot change log. */
export const SP_CCC_DRAWINGS_LIST_ID =
  import.meta.env.VITE_SP_CCC_DRAWINGS_LIST_ID ||
  "0ac690f8-1374-4df1-8057-35eb4220e54b";

/** "CEC Drawings" — 263 rows, same shape as CCC. */
export const SP_CEC_DRAWINGS_LIST_ID =
  import.meta.env.VITE_SP_CEC_DRAWINGS_LIST_ID ||
  "5d2d478a-ae19-47a9-8836-453001b756dc";

/** "Engineering Sketches" — 1,000+ rows, its own columns and NO change log. */
export const SP_ENGINEERING_SKETCHES_LIST_ID =
  import.meta.env.VITE_SP_ENGINEERING_SKETCHES_LIST_ID ||
  "dc9c015c-5284-43b4-ab90-40d73d515896";

/**
 * "CSA Listings" — Engineering's CSA product-certification register on the
 * Engineering site. `Title` is repurposed as the File Number; `CSA_ID` is a
 * legacy id from the original data. Attachments are enabled on the list (the
 * certificate PDFs). Schema discovered live 2026-07-29.
 */
export const SP_CSA_LISTINGS_LIST_ID =
  import.meta.env.VITE_SP_CSA_LISTINGS_LIST_ID ||
  "758defd2-693c-4324-9e0b-dd2a12c341fa";

/**
 * "Where am I?" — Engineering's out-of-office / where-the-team-is calendar on
 * the Engineering site. Two columns that matter: `Title` (free text, e.g.
 * "Sarah - half day vacation") and `Date` (date-only, required). No end date,
 * so a week away is one row per day.
 *
 * Its date-only values are stored at 06:00Z — local midnight in US Central,
 * where this site's regional setting sits. Two other ARC lists store theirs at
 * 22:00Z and 23:00Z; `parseSpDateOnly`'s midday pivot reads all three as the
 * day the SharePoint view shows.
 *
 * Schema discovered live 2026-08-19 — scripts/where-am-i-schema.json.
 */
export const SP_WHERE_AM_I_LIST_ID =
  import.meta.env.VITE_SP_WHERE_AM_I_LIST_ID ||
  "9483c2c9-8af4-42cb-9e15-a170c8cac225";

/**
 * "Gray Market Request" — a part bought outside normal distribution, tracked
 * from request through purchasing, engineering test, inspection and production
 * sign-off. A **Supply Chain** feature (Ray, 2026-08-19), even though the list
 * lives on the **PMO site** (SITES.pmo) rather than a Supply Chain one — that's
 * where it has always been, and the PMO grant already covers it.
 *
 * `Title` is the Altronic assembly number, `LogNo_x002e_Raw` carries the
 * GMR_YYYY-### number the app generates, and the list already has the
 * `Communication` and `Watchers` columns the standard comment thread needs.
 * Schema discovered live 2026-08-19 — scripts/gray-market-request-schema.json.
 */
export const SP_GRAY_MARKET_LIST_ID =
  import.meta.env.VITE_SP_GRAY_MARKET_LIST_ID ||
  "bf5e3786-d2c1-4e8d-8bd1-c8d5bab9c85b";

/**
 * Who is emailed when a NEW gray market request is raised (Ray, 2026-08-23).
 *
 * Nobody watches the list itself, so a request used to sit until someone
 * opened ARC and noticed it. These are the people who pick one up, and they
 * are notified on every create — this is an intake queue, not a watch list, so
 * there is no way to opt out short of changing this setting.
 *
 * Format matches the EIR triage lists: comma-separated `Name <email>` or a
 * bare address, parsed by parseRecipientList. The actor is left off their own
 * request unless that would leave nobody.
 *
 * **The addresses below follow the tenant's firstname.lastname convention and
 * should be verified against the directory.** Ray named "katie.fleming",
 * "Alexandra.Russell@altronic-llc.com" and "glenn.terry"; the two bare names
 * are expanded to that convention here. A wrong address fails visibly (a
 * failed send is reported) but it fails as that person's silence.
 */
/**
 * Open Orders Report Customers — the managed list of who gets an individual
 * workbook each week (Ray, 2026-08-24).
 *
 * `Title` is the sold-to account number and `CustomerName` is the
 * CUSTOMER-FACING name. That second column is not a nicety: SAP truncates
 * Customer Name at 30 characters ("Wabtec Transportation Systems,",
 * "INNIO Waukesha Canada Corporat"), and the workbook a customer receives is
 * named after this list, not after a truncation.
 *
 * Lives on SITES.salesTeam. Create it with
 * scripts/create-open-orders-lists.ps1, then set this env var.
 */
export const SP_OPEN_ORDERS_CUSTOMERS_LIST_ID =
  import.meta.env.VITE_SP_OPEN_ORDERS_CUSTOMERS_LIST_ID;

/**
 * Open Orders Roles list — the same shape as EIR Roles ("treat like the eir
 * permissions", Ray, 2026-08-24): one row per user, `Title` = email, plus a
 * `Roles` text column holding a lowercase CSV of role tags.
 *
 * One tag today: `report manager` — may edit the customer list and run the
 * weekly generation. Everyone else signed in can read the reports and
 * download them, which is what most of Sales needs.
 *
 * Point this at the EIR Roles list instead if you would rather run one roles
 * list for the whole company; the shape is identical and the tag namespace is
 * separate.
 */
export const SP_OPEN_ORDERS_ROLES_LIST_ID =
  import.meta.env.VITE_SP_OPEN_ORDERS_ROLES_LIST_ID;

/**
 * Whether Open Orders role gating is active.
 *
 * Same lockout-safety shape as EIR_ROLES_ENFORCED: OFF in real mode until the
 * roles list is configured, so the first person to open the tool isn't told
 * they lack a role that nobody can grant yet. Always on in mock mode so the
 * gating is demoable.
 */
export const OPEN_ORDERS_ROLES_ENFORCED = USE_MOCK || !!SP_OPEN_ORDERS_ROLES_LIST_ID;

export const GRAY_MARKET_NEW_REQUEST_ALERTS =
  import.meta.env.VITE_GRAY_MARKET_NEW_REQUEST_ALERTS ||
  "Katie Fleming <katie.fleming@altronic-llc.com>, " +
  "Alexandra Russell <Alexandra.Russell@altronic-llc.com>, " +
  "Glenn Terry <glenn.terry@altronic-llc.com>";

/**
 * FAIT intake alert — who picks up a newly-raised First Article Inspection
 * Test (Ray, 2026-08-26). Same shape as GRAY_MARKET_NEW_REQUEST_ALERTS: an
 * intake queue, not the FAIT's Watchers column, so being on this list doesn't
 * subscribe anyone to later comments or status changes.
 *
 * Format is the usual comma-separated `Name <email>` or bare address, parsed
 * by parseRecipientList. **Verify these against the directory** — a wrong
 * address fails as that person's silence, not an error.
 */
export const FAIT_NEW_ALERTS =
  import.meta.env.VITE_FAIT_NEW_ALERTS ||
  "Jerrod Waldron <Jerrod.Waldron@altronic-llc.com>, " +
  "Alexandra Russell <Alexandra.Russell@altronic-llc.com>, " +
  "Katie Fleming <katie.fleming@altronic-llc.com>";

/**
 * FAIT **SQE reviewers** — who is asked to sign a FAIT off at the SQE stage,
 * and the fallback when a later stage has nobody to ask (Ray, 2026-08-28).
 *
 * There is deliberately no SQE person column on the list: SQE is whoever is
 * managing these requests after they're created — typically Jerrod Waldron —
 * and `SQEINITIALS` is only a text record of who signed, not an assignment.
 * So it's a configured list, the same shape as the EIR triage queues.
 *
 * Deliberately its OWN variable rather than reusing FAIT_NEW_ALERTS, even
 * though the two overlap today: that list is the intake queue for a newly
 * raised FAIT, and re-pointing it must not silently re-point who gets asked
 * to sign. Same reasoning as EIR_RESPONSE_ACCEPTED_ALERTS being separate from
 * EIR_TRIAGE_PROJECT_REVIEWERS.
 *
 * Format is the usual comma-separated `Name <email>` or bare address, parsed
 * by parseRecipientList. **Verify against the directory** (Admin →
 * Notification recipients) — a wrong address fails as that person's silence.
 */
export const FAIT_SQE_REVIEWERS =
  import.meta.env.VITE_FAIT_SQE_REVIEWERS ||
  "Jerrod Waldron <Jerrod.Waldron@altronic-llc.com>";

/**
 * "Visit Reports" — Customer Service / Sales' record of customer visits, on
 * the ALTRONICSALESTEAM site (SITES.salesTeam). `Title` is repurposed as the
 * Customer Name, City/State are `City0`/`State0`, and Month/Year/Day/Cal Title
 * are calculated off Visit Date (never written). Attachments are enabled.
 * Schema discovered live 2026-08-18 — scripts/visit-reports-schema.json.
 */
export const SP_VISIT_REPORTS_LIST_ID =
  import.meta.env.VITE_SP_VISIT_REPORTS_LIST_ID ||
  "7cc4db39-6612-4c2d-b1b2-1af34d0564e7";

/**
 * "FAIT" — First Article Inspection Tests. A **Supply Chain** feature (Ray,
 * 2026-08-20), though the list lives on the **Engineering** site rather than
 * PMO — worth knowing, because that's where we looked first and it isn't
 * there.
 *
 * Fifty-one workflow columns spanning quality inspection and three sign-offs
 * (SQE, Engineering, KAM). `Communication` and `Watchers` were added to the
 * list for ARC on 2026-08-20; `Project Reference` and attachments already
 * existed. Schema captured 2026-08-20 — scripts/fait-schema.json.
 */
export const SP_FAIT_LIST_ID =
  import.meta.env.VITE_SP_FAIT_LIST_ID ||
  "d655b5d6-ee28-45c4-85ab-128198569508";

/**
 * "ECN NEW" — Engineering Change Notices, on the Engineering site.
 *
 * The list came out of a migration and its columns are named `field_2` …
 * `field_12`: NOTHING in the internal name says what the column holds. The
 * translation lives in `src/lib/ecnFields.ts` and is the only place that
 * mapping exists — guessing a name here is guaranteed to write nowhere.
 *
 * `Title` is the part / assembly the change is against, `field_2` is the Log#
 * (`YY####`, with an `R#` suffix on a revision), and the `Communication`
 * column the standard comment thread needs already exists. There is **no
 * Watchers column and no requester column** — the submitter is Graph's
 * `createdBy`, which is why ECN comments notify differently from every other
 * ARC entity (see the note in src/hooks/useEcns.ts).
 *
 * 1,813 rows at the time of wiring. Schema discovered live 2026-08-19 —
 * scripts/ecn-new-schema.json.
 */
/**
 * EIR triage recipients — who gets chased when a new EIR isn't owned yet.
 *
 * A raised EIR needs a project reference and then an engineer, and both used
 * to be chased by someone noticing (Ray, 2026-08-20). These two lists drive
 * the chain:
 *
 *   no project reference  →  VITE_EIR_TRIAGE_PROJECT_REVIEWERS
 *   project set, no engineer  →  VITE_EIR_TRIAGE_ASSIGNERS
 *
 * Format is a comma-separated list, either `Name <email>` or a bare address:
 *
 *   VITE_EIR_TRIAGE_ASSIGNERS="Glenn Terry <glenn.terry@altronic-llc.com>, brandon.mirto@altronic-llc.com"
 *
 * Ray is on both lists to watch the chain working (Ray, 2026-08-20). Note the
 * consequence: he raises a lot of EIRs while testing, and the actor is left
 * off their own chase email — so an EIR he raises himself won't email him,
 * only the others on that list.
 *
 * The defaults below follow the tenant's firstname.lastname convention.
 * **Verify them against the directory before relying on them** — a wrong
 * address fails visibly (the send is reported), but it fails to the wrong
 * person's absence rather than an error.
 */
export const EIR_TRIAGE_PROJECT_REVIEWERS =
  import.meta.env.VITE_EIR_TRIAGE_PROJECT_REVIEWERS ||
  "Sheila Horn <sheila.horn@altronic-llc.com>, Ray White <ray.white@altronic-llc.com>";

export const EIR_TRIAGE_ASSIGNERS =
  import.meta.env.VITE_EIR_TRIAGE_ASSIGNERS ||
  "Glenn Terry <glenn.terry@altronic-llc.com>, " +
  "Brandon Mirto <brandon.mirto@altronic-llc.com>, " +
  "Ray White <ray.white@altronic-llc.com>";

/**
 * Who is told when an EIR's Status becomes **"Response Accepted"**
 * (Ray, 2026-08-25).
 *
 * The email asks the first-named person to CLOSE the EIR — an accepted
 * response is the point at which somebody has to finish the job, and it was
 * being spotted by someone happening to look.
 *
 * Deliberately its OWN variable rather than reusing
 * EIR_TRIAGE_PROJECT_REVIEWERS, even though the default pair is identical
 * today: that list is the "no project reference" queue, and re-pointing it must
 * not silently re-point this.
 *
 * Format is the usual comma-separated `Name <email>` or bare address, parsed by
 * parseRecipientList. **Verify the addresses against the directory** — a wrong
 * one fails as that person's silence.
 */
export const EIR_RESPONSE_ACCEPTED_ALERTS =
  import.meta.env.VITE_EIR_RESPONSE_ACCEPTED_ALERTS ||
  "Sheila Horn <sheila.horn@altronic-llc.com>, Ray White <ray.white@altronic-llc.com>";

export const SP_ECNS_LIST_ID =
  import.meta.env.VITE_SP_ECNS_LIST_ID ||
  "f6917bf4-bdd1-4ff9-ba71-0a17b22b1ecc";

// =============================================================================
// Digital QC — EIGHTEEN lists on the Engineering site (SITES.engineering),
// one per product family. QC defect log entries are stored per-family list.
// IDs discovered live 2026-08-14; env-overridable using the pattern below.
// =============================================================================

export const SP_QC_DIG_AFM_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_AFM_LIST_ID || "9f648055-ae05-4a00-87ef-61ce9f63df74";
export const SP_QC_DIG_AFC_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_AFC_LIST_ID || "d9455d57-5666-4cdd-928e-895dd46a7ad7";
export const SP_QC_DIG_ANNUNCIATOR_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_ANNUNCIATOR_LIST_ID ||
  "e0c9306c-8534-408b-b222-48d0e1430e3c";
export const SP_QC_DIG_DE_DISPLAY_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_DE_DISPLAY_LIST_ID ||
  "b9160945-e0a4-4545-9795-616bdf0208e2";
export const SP_QC_DIG_DE_TERM_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_DE_TERM_LIST_ID || "8b940361-a82b-4de5-827e-787d1869bba0";
export const SP_QC_DIG_DRIVECOM_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_DRIVECOM_LIST_ID || "c6260e37-2173-4d65-82b3-9382a8b57646";
export const SP_QC_DIG_ENBASE_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_ENBASE_LIST_ID || "70e098de-6e14-4851-86d7-89d0dd81172e";
export const SP_QC_DIG_EPC_10X_50_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_EPC_10X_50_LIST_ID ||
  "c683a352-acef-45e5-a48c-339fa1adcb89";
export const SP_QC_DIG_EX_200_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_EX_200_LIST_ID || "afe12cfd-9033-47bd-a3b1-4fb3da8c04f2";
export const SP_QC_DIG_EXACTA_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_EXACTA_LIST_ID || "ab1b98b3-6317-4950-8ccb-0ef99990339b";
export const SP_QC_DIG_MISC_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_MISC_LIST_ID || "f2c8168a-1819-49ee-8f7f-40eacd105a99";
export const SP_QC_DIG_MORIS_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_MORIS_LIST_ID || "5727f6c4-d3dc-4903-92f2-c0883d24b578";
export const SP_QC_DIG_PMM_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_PMM_LIST_ID || "95b89df8-5c86-43a2-96d2-4ef255169141";
export const SP_QC_DIG_POWER_SUPPLY_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_POWER_SUPPLY_LIST_ID ||
  "e5c881f6-c96a-43a1-9a08-c851e51a6cd7";
export const SP_QC_DIG_PRESSURE_GAGE_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_PRESSURE_GAGE_LIST_ID ||
  "41a5e25b-003d-49f2-998c-ba55a23904aa";
export const SP_QC_DIG_PYRO_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_PYRO_LIST_ID || "146e0008-712e-416a-967b-dad90e019c7e";
export const SP_QC_DIG_SAVES_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_SAVES_LIST_ID || "fcdcb85d-9676-44ac-95c8-dea8d2e8979d";
export const SP_QC_DIG_TAC_LIST_ID =
  import.meta.env.VITE_SP_QC_DIG_TAC_LIST_ID || "404f99fb-1848-476c-a033-04204510a132";

// =============================================================================
// Coils QC — QCCoils and its two editable reference lists live on the
// Engineering site (SITES.engineering). Named defects, including `Other`, are
// numeric columns. Only `OtherFaultTable` holds JSON-selected extra faults and
// their comments.
// =============================================================================

/** "QCCoils" — coil production and defect-count quality records. */
export const SP_QC_COILS_LIST_ID =
  import.meta.env.VITE_SP_QC_COILS_LIST_ID || "efce900f-770e-4bc2-8796-6d0bc528523a";

/** "CoilPN" — the editable Coil Part Number picker source. */
export const SP_COIL_PART_NUMBERS_LIST_ID =
  import.meta.env.VITE_SP_COIL_PART_NUMBERS_LIST_ID || "6bbec3ae-e6d8-427a-9058-2000152d6d57";

/** "CoilOtherFaultList" — the editable Other-defect picker source. */
export const SP_COIL_OTHER_FAULTS_LIST_ID =
  import.meta.env.VITE_SP_COIL_OTHER_FAULTS_LIST_ID || "b5c8dae4-403c-4508-919f-5c4c7883b5f0";

// =============================================================================
// Teradyne — FOUR lists on the PMO site (SITES.pmo), part of the Operations
// department. "Teradyne Log" is the primary entity; the other three are its
// lookup/reference lists, each editable in-app from the Teradyne Log screen's
// "Manage lists" menu (no admin gate — any signed-in user, per Ray 2026-07-28).
// Site confirmed by Ray; list IDs supplied by Ray. Env-overridable, same
// pattern as the Operations lists above.
// =============================================================================

/** "Teradyne Log" — the primary log list. Every row references the three lists below. */
export const SP_TERADYNE_LOG_LIST_ID =
  import.meta.env.VITE_SP_TERADYNE_LOG_LIST_ID ||
  "1fc8d786-cbc0-4c0d-8473-b1eb7aca8f3d";

/** "Teradyne Employees" — lookup source for the log's employee field. */
export const SP_TERADYNE_EMPLOYEES_LIST_ID =
  import.meta.env.VITE_SP_TERADYNE_EMPLOYEES_LIST_ID ||
  "1d7900c4-a6a0-4a14-86f7-62024d846a7a";

/** "Teradyne Products" — lookup source for the log's product field. */
export const SP_TERADYNE_PRODUCTS_LIST_ID =
  import.meta.env.VITE_SP_TERADYNE_PRODUCTS_LIST_ID ||
  "0113f8d2-4c8b-4bba-955f-323c90a91a16";

/** "Teradyne Remarks" — lookup source for the log's remark field. */
export const SP_TERADYNE_REMARKS_LIST_ID =
  import.meta.env.VITE_SP_TERADYNE_REMARKS_LIST_ID ||
  "3d7ccd9a-e1d8-4faa-9d46-bcbf94d76e3b";

// =============================================================================
// Coils — Potting Sample Log, THREE lists on the PMO site (SITES.pmo). The
// sample log is operator-entered (any signed-in user); the limit + PSR
// notification lists are editable by any signed-in user (same pattern as
// Teradyne's reference lists). IDs supplied by Ray 2026-08-17.
// =============================================================================

/** "Coil-PottingSampleLog" — one row per potting sample (Date, Volume, Weight). */
export const SP_POTTING_SAMPLE_LOG_LIST_ID =
  import.meta.env.VITE_SP_POTTING_SAMPLE_LOG_LIST_ID ||
  "43d87a74-250c-41e7-8365-6d5b4f2bd095";

/** "Coil-PottingLimit" — two rows (Title = "Lower Spec Limit" / "Upper Spec Limit"). */
export const SP_POTTING_LIMIT_LIST_ID =
  import.meta.env.VITE_SP_POTTING_LIMIT_LIST_ID ||
  "a495c2fa-a194-4d49-8a3b-ce00d496e7cf";

/** "Coil PSR Notification List" — Title = display name, Email = notify address. */
export const SP_PSR_NOTIFICATION_LIST_ID =
  import.meta.env.VITE_SP_PSR_NOTIFICATION_LIST_ID ||
  "fe452a97-59e4-4d9d-88a6-f064c6040033";

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

/** "Panel Tasks" — the panel team's task list (references the same Panel Project Reference list as orders). */
export const SP_PANEL_TASKS_LIST_ID =
  import.meta.env.VITE_SP_PANEL_TASKS_LIST_ID ||
  "17a33ee1-c4aa-439b-9dc0-6269a8e04767";

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

/**
 * "QC Time Tracking" — the panel team's log of hours QC spends on a project.
 * Same site as the other three Panels lists, its own list. Added 2026-09-01.
 */
export const SP_QC_TIME_TRACKING_LIST_ID =
  import.meta.env.VITE_SP_QC_TIME_TRACKING_LIST_ID ||
  "d3d97708-1d55-4307-8e3f-9411cd98a2fa";

/**
 * "ARC Feature Requests" — Engineering site. A place for any signed-in user
 * to request a new ARC feature or change, separate from "Report issue"
 * (which is for something BROKEN). See
 * scripts/create-feature-requests-list.ps1.
 *
 * **No default here**, same lockout-safety-style reasoning as Admins / EIR
 * Roles / Quick Links: the list doesn't exist in SharePoint yet until Ray
 * runs the script and gives us the real GUID. Unset means the screen reports
 * itself as "not configured yet" — never an error — the same as Quick Links.
 */
export const SP_FEATURE_REQUESTS_LIST_ID = import.meta.env.VITE_SP_FEATURE_REQUESTS_LIST_ID;

// =============================================================================
// CRM Tool — Customer Notes, Customer Contacts, Special Pricing and Capacity,
// all on the salesOrderEntry site (SITES.salesOrderEntry — the OrderEntry
// subsite of ALTRONICSALESTEAM). Customer Notes is the anchor: the other
// three each carry a `Customer` lookup back into it. IDs discovered live
// 2026-08-26.
// =============================================================================

/** "Customer Notes" — the anchor list. `Group` is a single choice; `CustomerType` is multi. */
export const SP_CUSTOMER_NOTES_LIST_ID =
  import.meta.env.VITE_SP_CUSTOMER_NOTES_LIST_ID ||
  "7e199193-5608-4e8d-b138-f146dc45d602";

/** "Customer Contacts" — one row per person at a customer, `Customer` lookup single. */
export const SP_CUSTOMER_CONTACTS_LIST_ID =
  import.meta.env.VITE_SP_CUSTOMER_CONTACTS_LIST_ID ||
  "8bcf0b63-93b5-43a7-b596-da119a7cd8f9";

/** "Special Pricing" — pricing notes tied to a customer. */
export const SP_SPECIAL_PRICING_LIST_ID =
  import.meta.env.VITE_SP_SPECIAL_PRICING_LIST_ID ||
  "254ce15b-7489-42ae-88bb-828b9307727a";

/** "Capacity" — per-part weekly capacity commitments tied to a customer. */
export const SP_CAPACITY_LIST_ID =
  import.meta.env.VITE_SP_CAPACITY_LIST_ID ||
  "28797b1c-d755-4c3a-b2c1-50517ff5e18a";

/**
 * OrderEntry subsite's classic SharePoint REST root — needed to resolve a
 * picked person's site lookupId for the CSR/KAM fields (`ensureSiteUserLookupId`
 * in api/siteUsers.ts). Same tenant/token as SP_SITE_URL; only the path differs.
 */
export const SP_SALES_ORDERENTRY_SITE_URL =
  (import.meta.env.VITE_SP_SALES_ORDERENTRY_SITE_URL as string | undefined) ??
  "https://coopermachineryservices.sharepoint.com/sites/ALTRONICSALESTEAM/OrderEntry";

// =============================================================================
// SRM Tool — Suppliers List, Supplier Contact List and Supplier Issue
// Tracker, all on the PMO site (SITES.pmo). Suppliers List is the anchor:
// the other two each carry a `BPReference` lookup back into it. IDs
// discovered live 2026-08-26.
// =============================================================================

/** "Suppliers List" — the anchor list. `CoreCompetency` is a multi choice. */
export const SP_SUPPLIERS_LIST_ID =
  import.meta.env.VITE_SP_SUPPLIERS_LIST_ID || "7e4dc4a4-40bf-4abd-a939-1c5d313526d0";

/**
 * "Supplier Contact List" — one row per person at a supplier, `BPReference`
 * lookup single. Communication and Watchers were added for ARC on
 * 2026-08-26 (`scripts/add-supplier-contact-columns.ps1`) — Suppliers List
 * and Supplier Issue Tracker already had both.
 */
export const SP_SUPPLIER_CONTACTS_LIST_ID =
  import.meta.env.VITE_SP_SUPPLIER_CONTACTS_LIST_ID || "efdb064b-be61-442e-9bae-f052569c3701";

/** "Supplier Issue Tracker" — near-empty (1 row at discovery); `Status`/`Severity` are unconfigured placeholder choices. */
export const SP_SUPPLIER_ISSUES_LIST_ID =
  import.meta.env.VITE_SP_SUPPLIER_ISSUES_LIST_ID || "8b22d37a-a520-46a1-8935-8537c46e4b54";

/**
 * "Cost Impact Portal" — Supply Chain's notice that a purchased part's cost
 * has changed, on the **ALTRONICSALESTEAM site** (SITES.salesTeam) — a
 * Supply Chain feature living on a Sales-site list, the same arrangement as
 * Gray Market Requests on PMO: that's where the list has always been.
 * `Original Cost` / `New Cost` are TEXT columns (not Currency); `Delta Cost`
 * is a SharePoint calculated column (`=[New Cost]-[Original Cost]`), and
 * `Where Used` is Enhanced rich text, the same as EIR's and Gray Market's
 * field of the same name. 31 rows at discovery. Schema discovered live
 * 2026-08-27 — scripts/cost-impact-portal-schema.json.
 */
export const SP_COST_IMPACT_NOTICES_LIST_ID =
  import.meta.env.VITE_SP_COST_IMPACT_NOTICES_LIST_ID || "6b75ab59-8da8-49b6-a8b1-6abbb8f988f8";

/**
 * Who is emailed when a NEW cost impact notice is raised (Ray, 2026-08-27).
 *
 * The list has no Watchers column, so — same call as Gray Market Requests
 * and FAITs — nobody hears about a new notice unless they're on this list or
 * happen to open ARC and notice it. This is an intake queue, not a watch
 * list: being on it doesn't subscribe anyone to later comments, and there's
 * no way to opt out short of changing this setting.
 *
 * Format is the usual comma-separated `Name <email>` or bare address, parsed
 * by parseRecipientList. **Verify these against the directory** — a wrong
 * address fails as that person's silence, not an error.
 */
export const COST_IMPACT_NOTICE_ALERTS =
  import.meta.env.VITE_COST_IMPACT_NOTICE_ALERTS ||
  "Keith Brooks <Keith.Brooks@altronic-llc.com>, " +
  "Ray White <ray.white@altronic-llc.com>, " +
  "David Bell <David.Bell@altronic-llc.com>, " +
  "Matthew Traina <Matthew.Traina@altronic-llc.com>, " +
  "Mark Balent <Mark.Balent@altronic-llc.com>, " +
  "Katie Fleming <katie.fleming@altronic-llc.com>";

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
