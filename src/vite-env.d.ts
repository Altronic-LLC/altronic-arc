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
  readonly VITE_SP_SITE_URL: string;
  readonly VITE_SHARED_MAILBOX: string;
  readonly VITE_APP_MANAGER_EMAIL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
