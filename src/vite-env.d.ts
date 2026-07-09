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
  readonly VITE_SP_SITE_URL: string;
  readonly VITE_SHARED_MAILBOX: string;
  readonly VITE_APP_MANAGER_EMAIL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
