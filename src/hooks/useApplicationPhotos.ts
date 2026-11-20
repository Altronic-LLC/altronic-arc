import {
  APPLICATION_PHOTOS_SITE_LABEL,
  createApplicationPhotosFolder,
  deleteApplicationPhoto,
  getApplicationPhotosPath,
  listApplicationPhotos,
  renameApplicationPhoto,
  uploadApplicationPhoto,
} from "@/api/applicationPhotos";
import { createDriveLibraryHooks } from "./driveLibraryHooks";

// Application Photos hooks — the Sales configuration of the shared
// folder-library hooks (hooks/driveLibraryHooks.ts). BusinessIT#48.

export const applicationPhotosHooks = createDriveLibraryHooks({
  keyPrefix: "application-photos",
  siteLabel: APPLICATION_PHOTOS_SITE_LABEL,
  recycleBin: "the ALTRONICSALESTEAM site's recycle bin",
  api: {
    list: listApplicationPhotos,
    getPath: getApplicationPhotosPath,
    createFolder: createApplicationPhotosFolder,
    upload: uploadApplicationPhoto,
    rename: renameApplicationPhoto,
    remove: deleteApplicationPhoto,
  },
});
