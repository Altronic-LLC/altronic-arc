/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK: string;
  readonly VITE_AZURE_CLIENT_ID: string;
  readonly VITE_AZURE_TENANT_ID: string;
  readonly VITE_SP_SITE_ID: string;
  // Per-department site IDs (Graph composite "host,siteCollectionId,webId").
  // Optional — config.ts falls back to documented defaults when unset.
  readonly VITE_SP_ENGINEERING_SITE_ID: string;
  readonly VITE_SP_PANELTEAM_SITE_ID: string;
  readonly VITE_SP_SALESTEAM_SITE_ID: string;
  readonly VITE_SP_SALES_ORDERENTRY_SITE_ID: string;
  // ALTRONICSALESTEAM/SCN subsite — the SCN Dashboard list. All three optional;
  // config.ts carries documented defaults.
  readonly VITE_SP_SCN_SITE_ID: string;
  readonly VITE_SP_SCN_SITE_URL: string;
  readonly VITE_SP_SALES_DOCUMENTATION_SITE_ID: string;
  readonly VITE_SP_SALES_DOCUMENTATION_SITE_URL: string;
  readonly VITE_SP_SCNS_LIST_ID: string;
  readonly VITE_SP_QUOTES_LIST_ID: string;
  readonly VITE_SP_QUOTE_ASSEMBLIES_LIST_ID: string;
  readonly VITE_SP_QUOTE_ITEMS_LIST_ID: string;
  readonly VITE_SP_QUOTE_CUSTOMERS_LIST_ID: string;
  readonly VITE_SP_QUOTE_ROLES_LIST_ID: string;
  readonly VITE_SP_PRICING_ROLES_LIST_ID: string;
  readonly VITE_SP_PRICING_REQUESTS_LIST_ID: string;
  readonly VITE_SP_PRICING_HISTORY_LIST_ID: string;
  readonly VITE_SP_NEW_PRODUCT_PRICING_LIST_ID: string;
  readonly VITE_SP_NP_SUBASSEMBLIES_LIST_ID: string;
  readonly VITE_SP_CUSTOMER_QUOTES_LIST_ID: string;
  readonly VITE_PRICING_LIVE: string;
  readonly VITE_PRICING_PREVIEW_USERS: string;
  readonly VITE_SP_MCNS_LIST_ID: string;
  readonly VITE_SP_MCN_ROLES_LIST_ID: string;
  readonly VITE_SP_MCN_DISTRIBUTION_GROUPS_LIST_ID: string;
  readonly VITE_MCN_LIVE: string;
  readonly VITE_SP_PMO_SITE_ID: string;
  readonly VITE_SP_LIST_ID: string;
  readonly VITE_SP_PROJECTS_LIST_ID: string;
  readonly VITE_SP_TEST_RESULTS_LIST_ID: string;
  readonly VITE_SP_EIRS_LIST_ID: string;
  readonly VITE_SP_ADMINS_LIST_ID: string;
  readonly VITE_SP_EIR_ROLES_LIST_ID: string;
  readonly VITE_SP_MAINTENANCE_DEPARTMENTS_LIST_ID: string;
  readonly VITE_SP_MAINTENANCE_LOCATIONS_LIST_ID: string;
  readonly VITE_SP_MAINTENANCE_ROLES_LIST_ID: string;
  readonly VITE_SP_HARNESS_PRODUCTION_LOG_LIST_ID: string;
  readonly VITE_SP_HARNESS_PART_NUMBERS_LIST_ID: string;
  /** Crimp Height Checks (BusinessIT#55) on the PMO site. No defaults. */
  readonly VITE_SP_CRIMP_SPECS_LIST_ID: string;
  readonly VITE_SP_CRIMP_CHECKS_LIST_ID: string;
  /** Harness Alert Recipients list (who the Harness emails go to). No default. */
  readonly VITE_SP_HARNESS_ALERT_RECIPIENTS_LIST_ID: string;
  /** GET-1 (GE Transportation Log Sheet) on the PMO site. No default. */
  readonly VITE_SP_QC_GET1_LIST_ID: string;
  /** QCFRM-035 (Series X Controller log sheet) on the PMO site. No default. */
  readonly VITE_SP_QC_SERIES_X_LIST_ID: string;
  /** Exact Windows printer name for QZ Tray to print Panel QC labels
   * directly to. Unset = always fall back to the browser print dialog. */
  readonly VITE_PANEL_QC_LABEL_PRINTER_NAME: string;
  /** QZ Tray signing cert (public) and its matching PKCS8 private key.
   * Both unset = requests go out unsigned (QZ Tray's own per-machine
   * "Allow this site to print?" prompt). See config.ts's QZ_CERTIFICATE. */
  readonly VITE_QZ_CERTIFICATE: string;
  readonly VITE_QZ_PRIVATE_KEY: string;
  /** Fabric API for GraphQL endpoint — READ-ONLY reference data.
   * Optional; config.ts carries the documented default. */
  readonly VITE_FABRIC_GRAPHQL_ENDPOINT: string;
  /** DEV ONLY — demo data, but the Calculator's cost lookup asks live Fabric. */
  readonly VITE_FABRIC_IN_DEMO?: string;
  readonly VITE_SP_SITE_URL: string;
  readonly VITE_SHARED_MAILBOX: string;
  readonly VITE_APP_MANAGER_EMAIL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
