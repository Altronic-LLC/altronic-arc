import {
  SP_BUILD_REQUEST_ITEMS_LIST_ID,
  SP_BUILD_REQUESTS_LIST_ID,
  SP_EIRS_LIST_ID,
  SP_LIST_ID,
  SP_OPERATIONS_TASKS_LIST_ID,
  SP_PMO_SITE_URL,
  SP_SITE_URL,
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
  | "operationsTask"
  | "buildRequest"
  | "buildRequestItem";

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
