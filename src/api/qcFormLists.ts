import { SITES, SP_QC_CPU95_LIST_ID } from "./config";

// =============================================================================
// Where each QC form's records live — the SharePoint half of the registry in
// lib/qcForms.ts. Kept in api/ (lib/ doesn't import config) and apart from
// api/qcForms.ts, so appAccess.ts can read it without pulling in Graph.
//
// One list per form on Altronic_PMO, built from the form's column JSON
// (QC Forms roadmap, decision 2). A form without an entry here can't load.
// =============================================================================

export interface QcFormList {
  site: keyof typeof SITES;
  listId: string | undefined;
  /** Named in the "not set" error, so whoever reads it knows which variable to set. */
  envVar: string;
}

export const QC_FORM_LISTS: Record<string, QcFormList> = {
  "cpu-95": { site: "pmo", listId: SP_QC_CPU95_LIST_ID, envVar: "VITE_SP_QC_CPU95_LIST_ID" },
};
