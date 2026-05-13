/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK: string;
  readonly VITE_AZURE_CLIENT_ID: string;
  readonly VITE_AZURE_TENANT_ID: string;
  readonly VITE_SP_SITE_ID: string;
  readonly VITE_SP_LIST_ID: string;
  readonly VITE_SP_PROJECTS_LIST_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
