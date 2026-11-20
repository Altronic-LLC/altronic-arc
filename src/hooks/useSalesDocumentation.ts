import {
  SALES_DOCUMENTATION_SITE_LABEL,
  createSalesDocumentationFolder,
  deleteSalesDocumentationFile,
  getSalesDocumentationPath,
  listSalesDocumentation,
  renameSalesDocumentationFile,
  uploadSalesDocumentationFile,
} from "@/api/salesDocumentation";
import { createDriveLibraryHooks } from "./driveLibraryHooks";

// Sales Documentation hooks — the Sales configuration of the shared
// folder-library hooks (hooks/driveLibraryHooks.ts).

export const salesDocumentationHooks = createDriveLibraryHooks({
  keyPrefix: "sales-documentation",
  siteLabel: SALES_DOCUMENTATION_SITE_LABEL,
  recycleBin: "the AltronicDocumentation site's recycle bin",
  api: {
    list: listSalesDocumentation,
    getPath: getSalesDocumentationPath,
    createFolder: createSalesDocumentationFolder,
    upload: uploadSalesDocumentationFile,
    rename: renameSalesDocumentationFile,
    remove: deleteSalesDocumentationFile,
  },
});
