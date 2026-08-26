import {
  SP_BUILD_REQUEST_ITEMS_LIST_ID,
  SP_BUILD_REQUESTS_LIST_ID,
  SP_CSA_LISTINGS_LIST_ID,
  SP_ECNS_LIST_ID,
  SP_FAIT_LIST_ID,
  SP_EIRS_LIST_ID,
  SP_LIST_ID,
  SP_OPERATIONS_TASKS_LIST_ID,
  SP_PANEL_ORDERS_LIST_ID,
  SP_PANEL_TASKS_LIST_ID,
  SP_PANELTEAM_SITE_URL,
  SP_GRAY_MARKET_LIST_ID,
  SP_PMO_SITE_URL,
  SP_SALESTEAM_SITE_URL,
  SP_SITE_URL,
  SP_SUPPLIERS_LIST_ID,
  SP_SUPPLIER_CONTACTS_LIST_ID,
  SP_SUPPLIER_ISSUES_LIST_ID,
  SP_VISIT_REPORTS_LIST_ID,
  USE_MOCK,
} from "./config";
import { spFetch, SharePointUnavailableError } from "./sharepoint";

// =============================================================================
// List-item attachments via the SharePoint REST API.
//
// Graph v1.0 doesn't have a clean attachments endpoint for SharePoint list
// items, so we use the classic SP REST path:
//   /_api/web/lists(guid'{listId}')/items({itemId})/AttachmentFiles
//
// All operations need MSAL to have acquired a SharePoint-resource token —
// see src/api/sharepoint.ts for the auth requirements. If those aren't met
// the calls throw SharePointUnavailableError, which the UI handles by
// showing a "feature unavailable" notice.
// =============================================================================

export interface ListAttachment {
  fileName: string;
  /** Absolute URL the user can click to download the file. */
  downloadUrl: string;
  /** Server-relative URL used by SP REST for delete operations. */
  serverRelativeUrl: string;
}

export type AttachmentParent =
  | "task"
  | "eir"
  | "ecn"
  | "fait"
  | "operationsTask"
  | "buildRequest"
  | "buildRequestItem"
  | "panelOrder"
  | "panelTask"
  | "csaListing"
  | "visitReport"
  | "grayMarketRequest"
  | "supplier"
  | "supplierContact"
  | "supplierIssue";

interface ParentConfig {
  listId: string | undefined;
  /** Classic SharePoint REST site root — Operations tasks live on a different site (PMO) from task/eir (Engineering). */
  siteUrl: string | undefined;
  /** Env var name to mention in the error when `listId` is unset. */
  listIdEnvVar: string;
}

const PARENT_CONFIG: Record<AttachmentParent, ParentConfig> = {
  task: { listId: SP_LIST_ID, siteUrl: SP_SITE_URL, listIdEnvVar: "VITE_SP_LIST_ID" },
  eir: { listId: SP_EIRS_LIST_ID, siteUrl: SP_SITE_URL, listIdEnvVar: "VITE_SP_EIRS_LIST_ID" },
  // The marked-up drawing, the two-page ECN form, the photo of the board.
  // Attachments were already enabled on the list, so this needs nothing in
  // SharePoint beyond the AllSites.Manage consent every attachment path wants.
  ecn: { listId: SP_ECNS_LIST_ID, siteUrl: SP_SITE_URL, listIdEnvVar: "VITE_SP_ECNS_LIST_ID" },
  // Inspection reports and CMM output. Attachments were already enabled on
  // the FAIT list before ARC touched it.
  fait: { listId: SP_FAIT_LIST_ID, siteUrl: SP_SITE_URL, listIdEnvVar: "VITE_SP_FAIT_LIST_ID" },
  operationsTask: {
    listId: SP_OPERATIONS_TASKS_LIST_ID,
    siteUrl: SP_PMO_SITE_URL,
    listIdEnvVar: "VITE_SP_OPERATIONS_TASKS_LIST_ID",
  },
  buildRequest: {
    listId: SP_BUILD_REQUESTS_LIST_ID,
    siteUrl: SP_SITE_URL,
    listIdEnvVar: "VITE_SP_BUILD_REQUESTS_LIST_ID",
  },
  buildRequestItem: {
    listId: SP_BUILD_REQUEST_ITEMS_LIST_ID,
    siteUrl: SP_SITE_URL,
    listIdEnvVar: "VITE_SP_BUILD_REQUEST_ITEMS_LIST_ID",
  },
  panelOrder: {
    listId: SP_PANEL_ORDERS_LIST_ID,
    siteUrl: SP_PANELTEAM_SITE_URL,
    listIdEnvVar: "VITE_SP_PANEL_ORDERS_LIST_ID",
  },
  grayMarketRequest: {
    listId: SP_GRAY_MARKET_LIST_ID,
    siteUrl: SP_PMO_SITE_URL,
    listIdEnvVar: "VITE_SP_GRAY_MARKET_LIST_ID",
  },
  visitReport: {
    listId: SP_VISIT_REPORTS_LIST_ID,
    siteUrl: SP_SALESTEAM_SITE_URL,
    listIdEnvVar: "VITE_SP_VISIT_REPORTS_LIST_ID",
  },
  panelTask: {
    listId: SP_PANEL_TASKS_LIST_ID,
    siteUrl: SP_PANELTEAM_SITE_URL,
    listIdEnvVar: "VITE_SP_PANEL_TASKS_LIST_ID",
  },
  // CSA certificate PDFs. Attachments are already enabled on the list, so this
  // needs nothing in SharePoint beyond the AllSites.Manage consent every other
  // attachment path depends on.
  csaListing: {
    listId: SP_CSA_LISTINGS_LIST_ID,
    siteUrl: SP_SITE_URL,
    listIdEnvVar: "VITE_SP_CSA_LISTINGS_LIST_ID",
  },
  supplier: {
    listId: SP_SUPPLIERS_LIST_ID,
    siteUrl: SP_PMO_SITE_URL,
    listIdEnvVar: "VITE_SP_SUPPLIERS_LIST_ID",
  },
  supplierContact: {
    listId: SP_SUPPLIER_CONTACTS_LIST_ID,
    siteUrl: SP_PMO_SITE_URL,
    listIdEnvVar: "VITE_SP_SUPPLIER_CONTACTS_LIST_ID",
  },
  supplierIssue: {
    listId: SP_SUPPLIER_ISSUES_LIST_ID,
    siteUrl: SP_PMO_SITE_URL,
    listIdEnvVar: "VITE_SP_SUPPLIER_ISSUES_LIST_ID",
  },
};

/** Build the absolute `/_api/web/lists(guid'...')/items(...)` path for a parent kind, or throw if unconfigured. */
function resolveListPath(parent: AttachmentParent, itemId: number): string {
  const cfg = PARENT_CONFIG[parent];
  if (!cfg.listId || !cfg.siteUrl) {
    throw new SharePointUnavailableError(`${cfg.listIdEnvVar} is not set — attachments unavailable.`);
  }
  return `${cfg.siteUrl}/_api/web/lists(guid'${cfg.listId}')/items(${itemId})`;
}

// In mock mode we keep a simple in-memory store per (parent,itemId) so the
// UI behaves the same — counts update, deletes remove, etc.
const mockStore = new Map<string, ListAttachment[]>();
function mockKey(parent: AttachmentParent, itemId: number) {
  return `${parent}:${itemId}`;
}

export async function listAttachments(
  parent: AttachmentParent,
  itemId: number,
): Promise<ListAttachment[]> {
  if (USE_MOCK) {
    return mockStore.get(mockKey(parent, itemId)) ?? [];
  }
  const path = `${resolveListPath(parent, itemId)}/AttachmentFiles`;
  const res = await spFetch<{ value: SpAttachmentFile[] }>(path);
  return res.value.map((f) => ({
    fileName: f.FileName,
    serverRelativeUrl: f.ServerRelativeUrl,
    downloadUrl: spAbsoluteUrl(f.ServerRelativeUrl),
  }));
}

export async function uploadAttachment(
  parent: AttachmentParent,
  itemId: number,
  file: File,
): Promise<ListAttachment> {
  if (USE_MOCK) {
    const attachment: ListAttachment = {
      fileName: file.name,
      // Object URLs let the user "download" their just-uploaded file even
      // in mock mode — handy for testing the click-to-download flow.
      downloadUrl: URL.createObjectURL(file),
      serverRelativeUrl: `mock:${parent}:${itemId}:${file.name}`,
    };
    const key = mockKey(parent, itemId);
    const next = [...(mockStore.get(key) ?? []), attachment];
    mockStore.set(key, next);
    return attachment;
  }
  const bytes = await file.arrayBuffer();
  // SP REST attachment upload requires a binary POST. The filename has to
  // travel as a URL parameter — encode it carefully.
  const path =
    `${resolveListPath(parent, itemId)}` +
    `/AttachmentFiles/add(FileName='${encodeURIComponent(file.name)}')`;
  const res = await spFetch<SpAttachmentFile>(path, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  return {
    fileName: res.FileName,
    serverRelativeUrl: res.ServerRelativeUrl,
    downloadUrl: spAbsoluteUrl(res.ServerRelativeUrl),
  };
}

export async function deleteAttachment(
  parent: AttachmentParent,
  itemId: number,
  fileName: string,
): Promise<void> {
  if (USE_MOCK) {
    const key = mockKey(parent, itemId);
    const filtered = (mockStore.get(key) ?? []).filter((a) => a.fileName !== fileName);
    mockStore.set(key, filtered);
    return;
  }
  const path =
    `${resolveListPath(parent, itemId)}` +
    `/AttachmentFiles/getByFileName('${encodeURIComponent(fileName)}')`;
  await spFetch(path, {
    method: "POST",
    headers: { "X-HTTP-Method": "DELETE", "If-Match": "*" },
  });
}

/**
 * Copy every attachment from one list item onto another — used when
 * promoting an EIR to a task, since the EIR's and the task's attachments are
 * two separate SP REST attachment stores (see the "Attachments" section in
 * CLAUDE.md) and nothing links them automatically.
 *
 * Best-effort per file: one failed copy doesn't stop the rest, and doesn't
 * throw — the caller (EIR promotion) treats a partial or total copy failure
 * as a warning, not a reason to fail a promotion whose task already exists.
 * Returns which files made it across and which didn't, so the caller can say
 * so rather than going quiet about it.
 */
export async function copyAttachments(
  from: AttachmentParent,
  fromId: number,
  to: AttachmentParent,
  toId: number,
): Promise<{ copied: string[]; failed: string[] }> {
  if (USE_MOCK) {
    const source = mockStore.get(mockKey(from, fromId)) ?? [];
    const copied: string[] = [];
    for (const a of source) {
      const key = mockKey(to, toId);
      mockStore.set(key, [...(mockStore.get(key) ?? []), { ...a }]);
      copied.push(a.fileName);
    }
    return { copied, failed: [] };
  }

  const files = await listAttachments(from, fromId);
  const copied: string[] = [];
  const failed: string[] = [];
  for (const f of files) {
    try {
      // downloadUrl is absolute, so spFetch treats it as a full URL — it
      // returns the raw Response here since the content-type won't be JSON.
      const res = await spFetch<Response>(f.downloadUrl);
      const bytes = await res.arrayBuffer();
      const file = new File([bytes], f.fileName);
      await uploadAttachment(to, toId, file);
      copied.push(f.fileName);
    } catch (err) {
      console.error(`copyAttachments: failed to copy "${f.fileName}"`, err);
      failed.push(f.fileName);
    }
  }
  return { copied, failed };
}

function spAbsoluteUrl(serverRelative: string): string {
  // SP_SITE_URL is a site root like https://tenant.sharepoint.com/sites/Y.
  // ServerRelativeUrl already carries the full site-specific path (e.g.
  // "/sites/Altronic_PMO/Lists/Z/Attachments/123/file.pdf"), so only the
  // tenant ORIGIN is needed here — identical across every ARC site
  // (task/eir/operationsTask all live on the same tenant), so there's no
  // need to pick a different one per parent kind.
  const origin = new URL(SP_SITE_URL ?? "https://example.com").origin;
  return `${origin}${serverRelative}`;
}

interface SpAttachmentFile {
  FileName: string;
  ServerRelativeUrl: string;
}
