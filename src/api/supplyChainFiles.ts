import { SITES, SP_PMO_SITE_URL } from "./config";
import { createDriveLibrary } from "./driveLibrary";
import type { DriveEntry, UploadProgress } from "./projectFiles";

// =============================================================================
// Supply Chain Files (BusinessIT#36) — the `General/Supply Chain Files` folder
// in the default Documents library of the Altronic_PMO site, browsed inside
// ARC under Supply Chain: new subfolders, upload, edit Office files in the
// browser, download, rename and delete.
//
// All behaviour is shared with SCN Documents in `driveLibrary.ts`. The "root"
// here is that one FOLDER (`rootPath`), so nothing above it in the PMO library
// is reachable from the screen. ARC never creates the folder — if it is missing
// the screen says it couldn't load it, naming the path.
//
// Rename and delete are open to any signed-in user, like SCN Documents; the
// library's SharePoint permissions are the boundary. Delete goes to the PMO
// site's recycle bin (93 days).
// =============================================================================

export const SUPPLY_CHAIN_FILES_PATH = "General/Supply Chain Files";

/** The folder's own SharePoint page — "Open in SharePoint" at the root. */
export const SUPPLY_CHAIN_FILES_FOLDER_URL = `${SP_PMO_SITE_URL}/Shared%20Documents/General/Supply%20Chain%20Files`;

/** Shown on every write refusal — the site somebody would ask about. */
export const SUPPLY_CHAIN_FILES_SITE_LABEL = "Altronic_PMO";

const library = createDriveLibrary({
  siteId: () => SITES.pmo,
  rootPath: SUPPLY_CHAIN_FILES_PATH.split("/"),
  rootName: "Supply Chain Files",
  rootWebUrl: SUPPLY_CHAIN_FILES_FOLDER_URL,
  mockPrefix: "scfile",
  mockWebBase: SUPPLY_CHAIN_FILES_FOLDER_URL,
  seedMock: (add, root) => {
    const forms = add(root, "Forms", "folder", 0, "2026-03-02T15:00:00Z");
    add(forms, "Supplier Survey Template.docx", "file", 41_000, "2026-03-02T15:00:00Z");
    const audits = add(root, "Supplier Audits", "folder", 0, "2026-08-14T15:00:00Z");
    const y2026 = add(audits, "2026", "folder", 0, "2026-08-14T15:00:00Z");
    add(y2026, "Audit Schedule.xlsx", "file", 58_000, "2026-08-14T15:00:00Z");
    add(root, "Approved Supplier List.xlsx", "file", 96_000, "2026-09-22T15:00:00Z");
    add(root, "Supply Chain Process Overview.pdf", "file", 312_000, "2025-11-10T15:00:00Z");
  },
});

export const listSupplyChainFiles = (folderId?: string): Promise<DriveEntry[]> =>
  library.list(folderId);
export const getSupplyChainFilesPath = (folderId?: string) => library.getPath(folderId);
export const downloadSupplyChainFile = (itemId: string): Promise<Blob> =>
  library.download(itemId);
export const createSupplyChainFolder = (
  parentId: string | null,
  name: string,
): Promise<DriveEntry> => library.createFolder(parentId, name);
export const uploadSupplyChainFile = (
  folderId: string | null,
  file: File,
  onProgress?: UploadProgress,
): Promise<DriveEntry> => library.upload(folderId, file, onProgress);
export const renameSupplyChainFile = (
  itemId: string,
  newName: string,
  options: { currentName?: string; isFolder?: boolean } = {},
): Promise<DriveEntry | null> => library.rename(itemId, newName, options);
export const deleteSupplyChainFile = (itemId: string): Promise<void> => library.remove(itemId);

/** TESTS ONLY: restore the seeded mock library. */
export function __resetSupplyChainFilesMock(): void {
  library.resetMock();
}
