import {
  SCN_DOCUMENTS_LIBRARY_URL,
  downloadScnDocument,
} from "@/api/scnDocuments";
import type { DriveLibraryHooks } from "@/hooks/driveLibraryHooks";
import {
  SCN_DOCUMENTS_KEY,
  useCreateScnFolder,
  useDeleteScnDocument,
  useRenameScnDocument,
  useScnDocumentPath,
  useScnDocuments,
  useUploadScnDocument,
} from "@/hooks/useScnDocuments";
import { DriveLibraryView } from "./DriveLibraryView";

// SCN Documents — a browser over the SCN subsite's Documents library (Ray,
// 2026-10-07). All the behaviour lives in DriveLibraryView; this is the SCN
// wiring. The current folder is `?folder=<driveItemId>` (absent = the root).

export { extensionOf, isOfficeFile, stemLength } from "./DriveLibraryView";

export function ScnDocumentsView() {
  const hooks: DriveLibraryHooks = {
    listKey: SCN_DOCUMENTS_KEY,
    useFolder: useScnDocuments,
    usePath: useScnDocumentPath,
    useCreateFolder: useCreateScnFolder,
    useUpload: useUploadScnDocument,
    useRename: useRenameScnDocument,
    useDelete: useDeleteScnDocument,
  };
  return (
    <DriveLibraryView
      title="SCN Documents"
      description="The SCN site's Documents library — browse folders, add files and folders, and edit Office files."
      category="SCNs"
      listTo="/supply-chain/scns"
      basePath="/supply-chain/scns/documents"
      rootName="Documents"
      rootWebUrl={SCN_DOCUMENTS_LIBRARY_URL}
      accessList="The SCN Documents library"
      accessSite="ALTRONICSALESTEAM/SCN"
      recycleBinOwner="the SCN site's"
      fileInputTestId="scn-documents-file-input"
      hooks={hooks}
      download={downloadScnDocument}
    />
  );
}
