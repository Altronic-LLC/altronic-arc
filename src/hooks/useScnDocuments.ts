import {
  SCN_DOCUMENTS_SITE_LABEL,
  createScnFolder,
  deleteScnDocument,
  getScnDocumentPath,
  listScnDocuments,
  renameScnDocument,
  uploadScnDocument,
} from "@/api/scnDocuments";
import {
  createDriveLibraryHooks,
  type DriveItemRef,
  type DriveUploadProgress,
  type DriveUploadResult,
} from "./driveLibraryHooks";

// SCN Documents library hooks — the SCN configuration of the shared folder-library
// hooks (hooks/driveLibraryHooks.ts). The cache key prefix is "scn-documents".

const hooks = createDriveLibraryHooks({
  keyPrefix: "scn-documents",
  siteLabel: SCN_DOCUMENTS_SITE_LABEL,
  recycleBin: "the SCN site's recycle bin",
  api: {
    list: listScnDocuments,
    getPath: getScnDocumentPath,
    createFolder: createScnFolder,
    upload: uploadScnDocument,
    rename: renameScnDocument,
    remove: deleteScnDocument,
  },
});

export const SCN_DOCUMENTS_KEY = hooks.listKey;
export const useScnDocuments = hooks.useFolder;
export const useScnDocumentPath = hooks.usePath;
export const useCreateScnFolder = hooks.useCreateFolder;
export const useUploadScnDocument = hooks.useUpload;
export const useRenameScnDocument = hooks.useRename;
export const useDeleteScnDocument = hooks.useDelete;

export type ScnUploadProgress = DriveUploadProgress;
export type ScnUploadResult = DriveUploadResult;
export type ScnItemRef = DriveItemRef;
