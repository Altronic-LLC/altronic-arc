import { SITES, SP_SALESTEAM_SITE_URL } from "./config";
import { createDriveLibrary } from "./driveLibrary";
import type { DriveEntry, UploadProgress } from "./projectFiles";

// =============================================================================
// Application Photos (BusinessIT#48) — the `General/A-Application Photos`
// folder in the default Documents library of the ALTRONICSALESTEAM site,
// browsed inside ARC under Sales as a storehouse for pictures: the whole
// folder tree, new subfolders, upload, take a photo straight from a phone or
// iPad camera, download, rename and delete.
//
// All behaviour is shared with SCN Documents, Supply Chain Files and Sales
// Documentation in `driveLibrary.ts`. The "root" is that one FOLDER
// (`rootPath`), so nothing above it in the library is reachable from the
// screen. ARC never creates the folder — if it is missing the screen says it
// couldn't load it, naming the path.
//
// Rename and delete are open to any signed-in user, like the other libraries;
// the library's SharePoint permissions are the boundary. Delete goes to the
// ALTRONICSALESTEAM site's recycle bin (93 days).
// =============================================================================

export const APPLICATION_PHOTOS_PATH = "General/A-Application Photos";

/** The folder's own SharePoint page — "Open in SharePoint" at the root. */
export const APPLICATION_PHOTOS_FOLDER_URL = `${SP_SALESTEAM_SITE_URL}/Shared%20Documents/General/A-Application%20Photos`;

/** Shown on every write refusal — the site somebody would ask about. */
export const APPLICATION_PHOTOS_SITE_LABEL = "ALTRONICSALESTEAM";

const library = createDriveLibrary({
  siteId: () => SITES.salesTeam,
  rootPath: APPLICATION_PHOTOS_PATH.split("/"),
  rootName: "Application Photos",
  rootWebUrl: APPLICATION_PHOTOS_FOLDER_URL,
  mockPrefix: "appphoto",
  mockWebBase: APPLICATION_PHOTOS_FOLDER_URL,
  // Invented demo content — the repo is public.
  seedMock: (add, root) => {
    const compression = add(root, "Compression", "folder", 0, "2026-09-14T15:00:00Z");
    add(compression, "Photo 2026-09-14 10-12-40.jpg", "file", 2_300_000, "2026-09-14T15:00:00Z");
    add(compression, "Photo 2026-09-14 10-13-05.jpg", "file", 2_100_000, "2026-09-14T15:00:00Z");
    const power = add(root, "Power Generation", "folder", 0, "2026-08-02T15:00:00Z");
    add(power, "Panel install.jpg", "file", 3_400_000, "2026-08-02T15:00:00Z");
    add(root, "Pipeline", "folder", 0, "2026-07-21T15:00:00Z");
    add(root, "Demo skid.jpg", "file", 1_800_000, "2026-10-01T15:00:00Z");
  },
});

export const listApplicationPhotos = (folderId?: string): Promise<DriveEntry[]> => library.list(folderId);
export const getApplicationPhotosPath = (folderId?: string) => library.getPath(folderId);
export const downloadApplicationPhoto = (itemId: string): Promise<Blob> => library.download(itemId);
export const createApplicationPhotosFolder = (parentId: string | null, name: string): Promise<DriveEntry> =>
  library.createFolder(parentId, name);
export const uploadApplicationPhoto = (
  folderId: string | null,
  file: File,
  onProgress?: UploadProgress,
): Promise<DriveEntry> => library.upload(folderId, file, onProgress);
export const renameApplicationPhoto = (
  itemId: string,
  newName: string,
  options: { currentName?: string; isFolder?: boolean } = {},
): Promise<DriveEntry | null> => library.rename(itemId, newName, options);
export const deleteApplicationPhoto = (itemId: string): Promise<void> => library.remove(itemId);

/** TESTS ONLY: restore the seeded mock library. */
export function __resetApplicationPhotosMock(): void {
  library.resetMock();
}
