import {
  SUPPLY_CHAIN_FILES_SITE_LABEL,
  createSupplyChainFolder,
  deleteSupplyChainFile,
  getSupplyChainFilesPath,
  listSupplyChainFiles,
  renameSupplyChainFile,
  uploadSupplyChainFile,
} from "@/api/supplyChainFiles";
import { createDriveLibraryHooks } from "./driveLibraryHooks";

// Supply Chain Files hooks — the Supply Chain configuration of the shared
// folder-library hooks (hooks/driveLibraryHooks.ts).

export const supplyChainFilesHooks = createDriveLibraryHooks({
  keyPrefix: "supply-chain-files",
  siteLabel: SUPPLY_CHAIN_FILES_SITE_LABEL,
  recycleBin: "the Altronic_PMO site's recycle bin",
  api: {
    list: listSupplyChainFiles,
    getPath: getSupplyChainFilesPath,
    createFolder: createSupplyChainFolder,
    upload: uploadSupplyChainFile,
    rename: renameSupplyChainFile,
    remove: deleteSupplyChainFile,
  },
});
