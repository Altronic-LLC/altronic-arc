import { SITES, SP_SCN_SITE_URL } from "./config";
import {
  createDriveLibrary,
  driveItemNameProblem,
  pathSegments,
  type DriveCrumb,
} from "./driveLibrary";
import type { DriveEntry, UploadProgress } from "./projectFiles";

// =============================================================================
// The SCN Documents library — an in-app browser over the DEFAULT document
// library of the ALTRONICSALESTEAM/SCN subsite (Ray, 2026-10-07: "create
// subfolders, see subfolders, edit files, add files directly in ARC").
//
// Live 2026-10-07: `/sites/{SITES.scn}/drive` is "Documents", and its root
// holds ARCHIVE, EECR, General, Inventory Review Reports, LTB Analysis, SCN and
// Single Use Reports, plus four loose files.
//
// All the behaviour — conflict rules, recycle-bin delete, the breadcrumb —
// lives in `driveLibrary.ts`, shared with Supply Chain Files. This file is the
// SCN configuration plus the original export names.
//
// Rename and delete are open to any signed-in user (Ray, 2026-10-07) — no admin
// gate; the library's own SharePoint permissions are the boundary.
// =============================================================================

/** The library's own SharePoint page — "Open in SharePoint" at the root. */
export const SCN_DOCUMENTS_LIBRARY_URL = `${SP_SCN_SITE_URL}/Shared%20Documents/Forms/AllItems.aspx`;

/** Shown on every write refusal — the site somebody would ask about. */
export const SCN_DOCUMENTS_SITE_LABEL = "ALTRONICSALESTEAM / SCN";

/** One step of the breadcrumb, root first. `id: null` is the library root. */
export type ScnDocumentCrumb = DriveCrumb;

export { pathSegments };

const library = createDriveLibrary({
  siteId: () => SITES.scn,
  rootName: "Documents",
  rootWebUrl: SCN_DOCUMENTS_LIBRARY_URL,
  mockPrefix: "scndoc",
  mockWebBase: `${SP_SCN_SITE_URL}/Shared%20Documents`,
  // Mirrors the live root (2026-10-07), a few levels deep.
  seedMock: (add, root) => {
    const archive = add(root, "ARCHIVE", "folder", 0, "2025-11-03T15:00:00Z");
    add(archive, "SCN2023-014 Closed.pdf", "file", 340_000, "2024-01-10T15:00:00Z");
    add(archive, "SCN2022-031 Closed.docx", "file", 52_000, "2023-03-02T15:00:00Z");
    const eecr = add(root, "EECR", "folder", 0, "2026-04-12T15:00:00Z");
    add(eecr, "EECR-0042 Capacitor change.xlsx", "file", 41_000, "2026-04-12T15:00:00Z");
    const general = add(root, "General", "folder", 0, "2026-09-18T15:00:00Z");
    const templates = add(general, "Templates", "folder", 0, "2026-02-01T15:00:00Z");
    add(templates, "SCN Template.docx", "file", 38_000, "2026-02-01T15:00:00Z");
    add(general, "Supplier contact list.xlsx", "file", 64_000, "2026-09-18T15:00:00Z");
    add(root, "Inventory Review Reports", "folder", 0, "2026-07-30T15:00:00Z");
    const ltb = add(root, "LTB Analysis", "folder", 0, "2026-08-21T15:00:00Z");
    add(ltb, "LTB Analysis Q3 2026.xlsx", "file", 128_000, "2026-08-21T15:00:00Z");
    add(root, "SCN", "folder", 0, "2026-09-30T15:00:00Z");
    add(root, "Single Use Reports", "folder", 0, "2026-05-05T15:00:00Z");
    add(root, "Master List Single Use_6-8-2022.xlsx", "file", 212_000, "2022-06-08T15:00:00Z");
    add(root, "Obsolete SCN2024-070 Varispark.docx", "file", 46_000, "2024-11-14T15:00:00Z");
    add(root, "SCN FLOW.pdf", "file", 185_000, "2025-03-20T15:00:00Z");
    add(root, "Submitting an SCN.docx", "file", 29_000, "2025-03-24T15:00:00Z");
  },
});

export const listScnDocuments = (folderId?: string): Promise<DriveEntry[]> =>
  library.list(folderId);
export const getScnDocumentPath = (folderId?: string): Promise<ScnDocumentCrumb[]> =>
  library.getPath(folderId);
export const downloadScnDocument = (itemId: string): Promise<Blob> => library.download(itemId);
export const createScnFolder = (parentId: string | null, name: string): Promise<DriveEntry> =>
  library.createFolder(parentId, name);
export const uploadScnDocument = (
  folderId: string | null,
  file: File,
  onProgress?: UploadProgress,
): Promise<DriveEntry> => library.upload(folderId, file, onProgress);
export const renameScnDocument = (
  itemId: string,
  newName: string,
  options: { currentName?: string; isFolder?: boolean } = {},
): Promise<DriveEntry | null> => library.rename(itemId, newName, options);
export const deleteScnDocument = (itemId: string): Promise<void> => library.remove(itemId);

export const scnItemNameProblem = driveItemNameProblem;

/** A folder name's problem — `scnItemNameProblem` for a folder. */
export function scnFolderNameProblem(name: string): string | null {
  return driveItemNameProblem(name, "folder");
}

/** TESTS ONLY: restore the seeded mock library. */
export function __resetScnDocumentsMock(): void {
  library.resetMock();
}
