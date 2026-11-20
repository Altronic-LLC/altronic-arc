import {
  SALES_DOCUMENTATION_FOLDER_URL,
  downloadSalesDocumentationFile,
} from "@/api/salesDocumentation";
import { salesDocumentationHooks } from "@/hooks/useSalesDocumentation";
import { DriveLibraryView } from "./DriveLibraryView";

// Sales Documentation (BusinessIT#24) — Main Channel in the
// ALTRONICSALESTEAM/AltronicDocumentation Documents library. All behaviour
// lives in DriveLibraryView.

export function SalesDocumentationView() {
  return (
    <DriveLibraryView
      title="Sales Documentation"
      description="Altronic's documentation folder (Altronic Documentation › Main Channel) — browse and create subfolders, add files, edit Office files, download, rename and delete."
      category="Sales"
      listTo="/"
      basePath="/sales/documentation"
      rootName="Sales Documentation"
      rootWebUrl={SALES_DOCUMENTATION_FOLDER_URL}
      accessList="The Sales Documentation folder"
      accessSite="ALTRONICSALESTEAM/AltronicDocumentation"
      recycleBinOwner="the AltronicDocumentation site's"
      fileInputTestId="sales-documentation-file-input"
      hooks={salesDocumentationHooks}
      download={downloadSalesDocumentationFile}
    />
  );
}
