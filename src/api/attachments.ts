import { SP_EIRS_LIST_ID, SP_LIST_ID, USE_MOCK } from "./config";
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

export type AttachmentParent = "task" | "eir";

function resolveListId(parent: AttachmentParent): string | undefined {
  return parent === "eir" ? SP_EIRS_LIST_ID : SP_LIST_ID;
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
  const listId = resolveListId(parent);
  if (!listId) {
    throw new SharePointUnavailableError(
      `${parent === "eir" ? "VITE_SP_EIRS_LIST_ID" : "VITE_SP_LIST_ID"} is not set — attachments unavailable.`,
    );
  }
  const path = `/_api/web/lists(guid'${listId}')/items(${itemId})/AttachmentFiles`;
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
  const listId = resolveListId(parent);
  if (!listId) {
    throw new SharePointUnavailableError(
      `${parent === "eir" ? "VITE_SP_EIRS_LIST_ID" : "VITE_SP_LIST_ID"} is not set — attachments unavailable.`,
    );
  }
  const bytes = await file.arrayBuffer();
  // SP REST attachment upload requires a binary POST. The filename has to
  // travel as a URL parameter — encode it carefully.
  const path =
    `/_api/web/lists(guid'${listId}')/items(${itemId})` +
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
  const listId = resolveListId(parent);
  if (!listId) {
    throw new SharePointUnavailableError(
      `${parent === "eir" ? "VITE_SP_EIRS_LIST_ID" : "VITE_SP_LIST_ID"} is not set — attachments unavailable.`,
    );
  }
  const path =
    `/_api/web/lists(guid'${listId}')/items(${itemId})` +
    `/AttachmentFiles/getByFileName('${encodeURIComponent(fileName)}')`;
  await spFetch(path, {
    method: "POST",
    headers: { "X-HTTP-Method": "DELETE", "If-Match": "*" },
  });
}

function spAbsoluteUrl(serverRelative: string): string {
  // SP_SITE_URL is the site root like https://x.sharepoint.com/sites/Y.
  // ServerRelativeUrl is "/sites/Y/Lists/Z/Attachments/123/file.pdf".
  // Absolute = origin + serverRelativeUrl.
  const origin = new URL(import.meta.env.VITE_SP_SITE_URL ?? "https://example.com").origin;
  return `${origin}${serverRelative}`;
}

interface SpAttachmentFile {
  FileName: string;
  ServerRelativeUrl: string;
}
