import { SITES, SP_SALES_DOCUMENTATION_SITE_URL } from "./config";
import { createDriveLibrary } from "./driveLibrary";
import type { DriveEntry, UploadProgress } from "./projectFiles";

// =============================================================================
// Sales Documentation (BusinessIT#24) — the `Main Channel` folder in the
// Documents library of the ALTRONICSALESTEAM/AltronicDocumentation subsite,
// browsed inside ARC under Sales: the whole folder tree, new subfolders,
// upload, edit Office files in the browser, download, rename and delete.
//
// All behaviour is shared with SCN Documents and Supply Chain Files in
// `driveLibrary.ts`. The "root" is that one FOLDER (`rootPath`), so nothing
// above it in the library is reachable from the screen. ARC never creates the
// folder — if it is missing the screen says it couldn't load it, naming the
// path. Checked live 2026-10-12: 7 folders and 3 files at its top level.
//
// Rename and delete are open to any signed-in user, like the other two
// libraries; the library's SharePoint permissions are the boundary. Delete
// goes to the AltronicDocumentation subsite's recycle bin (93 days).
// =============================================================================

export const SALES_DOCUMENTATION_PATH = "Main Channel";

/** The folder's own SharePoint page — "Open in SharePoint" at the root. */
export const SALES_DOCUMENTATION_FOLDER_URL = `${SP_SALES_DOCUMENTATION_SITE_URL}/Shared%20Documents/Main%20Channel`;

/** Shown on every write refusal — the site somebody would ask about. */
export const SALES_DOCUMENTATION_SITE_LABEL = "ALTRONICSALESTEAM/AltronicDocumentation";

const library = createDriveLibrary({
  siteId: () => SITES.salesDocumentation,
  rootPath: SALES_DOCUMENTATION_PATH.split("/"),
  rootName: "Sales Documentation",
  rootWebUrl: SALES_DOCUMENTATION_FOLDER_URL,
  mockPrefix: "salesdoc",
  mockWebBase: SALES_DOCUMENTATION_FOLDER_URL,
  // Mirrors the live folder's top level (2026-10-12).
  seedMock: (add, root) => {
    const pdfs = add(root, "00_Completed - PDFs", "folder", 0, "2026-06-02T15:00:00Z");
    add(pdfs, "CPU-95 Operating Manual.pdf", "file", 2_400_000, "2026-06-02T15:00:00Z");
    const design = add(root, "01_Completed - Design Files", "folder", 0, "2026-06-02T15:00:00Z");
    add(design, "CPU-95 Operating Manual.indd", "file", 8_100_000, "2026-06-02T15:00:00Z");
    add(root, "02_Completed - Reference Material", "folder", 0, "2026-05-11T15:00:00Z");
    add(root, "03_Incomplete - Reference Material", "folder", 0, "2026-08-20T15:00:00Z");
    add(root, "04_Legacy InDesign Files", "folder", 0, "2024-02-15T15:00:00Z");
    add(root, "05_Legacy Shared Pics", "folder", 0, "2024-02-15T15:00:00Z");
    add(root, "06_SK Drawings", "folder", 0, "2025-09-03T15:00:00Z");
    add(root, "Altronic Brand Guidelines 2025.01.pdf", "file", 5_200_000, "2025-01-14T15:00:00Z");
    add(root, "Documentation Revision Requests.xlsx", "file", 64_000, "2026-09-30T15:00:00Z");
    add(root, "FORM Naming Convention 1.00.pdf", "file", 180_000, "2025-03-04T15:00:00Z");
  },
});

export const listSalesDocumentation = (folderId?: string): Promise<DriveEntry[]> =>
  library.list(folderId);
export const getSalesDocumentationPath = (folderId?: string) => library.getPath(folderId);
export const downloadSalesDocumentationFile = (itemId: string): Promise<Blob> =>
  library.download(itemId);
export const createSalesDocumentationFolder = (
  parentId: string | null,
  name: string,
): Promise<DriveEntry> => library.createFolder(parentId, name);
export const uploadSalesDocumentationFile = (
  folderId: string | null,
  file: File,
  onProgress?: UploadProgress,
): Promise<DriveEntry> => library.upload(folderId, file, onProgress);
export const renameSalesDocumentationFile = (
  itemId: string,
  newName: string,
  options: { currentName?: string; isFolder?: boolean } = {},
): Promise<DriveEntry | null> => library.rename(itemId, newName, options);
export const deleteSalesDocumentationFile = (itemId: string): Promise<void> =>
  library.remove(itemId);

/** TESTS ONLY: restore the seeded mock library. */
export function __resetSalesDocumentationMock(): void {
  library.resetMock();
}
