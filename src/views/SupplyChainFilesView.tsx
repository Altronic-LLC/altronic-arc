import {
  SUPPLY_CHAIN_FILES_FOLDER_URL,
  SUPPLY_CHAIN_FILES_PATH,
  downloadSupplyChainFile,
} from "@/api/supplyChainFiles";
import { supplyChainFilesHooks } from "@/hooks/useSupplyChainFiles";
import { DriveLibraryView } from "./DriveLibraryView";

// Supply Chain Files (BusinessIT#36) — General/Supply Chain Files in the
// Altronic_PMO Documents library. All behaviour lives in DriveLibraryView.

export function SupplyChainFilesView() {
  return (
    <DriveLibraryView
      title="Supply Chain Files"
      description={`The Supply Chain team's shared folder (${SUPPLY_CHAIN_FILES_PATH}) — browse and create subfolders, add files, edit Office files, rename and delete.`}
      category="Supply Chain"
      listTo="/"
      basePath="/supply-chain/files"
      rootName="Supply Chain Files"
      rootWebUrl={SUPPLY_CHAIN_FILES_FOLDER_URL}
      accessList="The Supply Chain Files folder"
      accessSite="Altronic_PMO"
      recycleBinOwner="the Altronic_PMO site's"
      fileInputTestId="supply-chain-files-file-input"
      hooks={supplyChainFilesHooks}
      download={downloadSupplyChainFile}
    />
  );
}
