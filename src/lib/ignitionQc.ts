export interface IgnitionQcRecord {
  id: string;
  productFamily: string;
  workOrder: string;
  dateTested: string;
  operator: string;
  oldNumber: string;
  sapNumber: string;
  revisionNoFirmwareDate: string;
  comments?: string;
  quantityTested: number;
  quantityRejected: number;
  processSolderDefect: number;
  aeSolderDefect: number;
  aeWiringDeficiency: number;
  aeWrongOrMissingComponent: number;
  aeAssemblyDeficiency: number;
  aeIdentificationDeficiency: number;
  programmingFirmware: number;
  coatingPottingDeficiency: number;
  machinePartPlacementDeficiency: number;
  physicalDamage: number;
  ncmVendor: number;
  ncmInternal: number;
  toRP?: number;
  other?: number;
}

// Product families, one per SharePoint list (see api/ignitionQc.ts for list IDs).
export const IGNITION_QC_FAMILY_OPTIONS = [
  "24V Alternator",
  "24V Regulator",
  "Alt 1 Module",
  "Alt 1 Unit",
  "Alt II,CPU II Unit",
  "Altronic III Brds",
  "Alt III Misc",
  "Altronic III Unit",
  "Altronic I Electronic Box",
  "Altronic V Brds",
  "Altronic V Unit",
  "CCD/WCD Unit",
  "CD1/2/PM1 Unit",
  "CD200",
  "CIM Unit",
  "BackCover",
  "CPU II Dist",
  "CPU2K Diag",
  "CPU2K Logic/Display",
  "NGI5K,CPU2K Unit",
  "CPU2K Power",
  "CPU II Logic",
  "CPU95 Display,EVS Power",
  "CPU95,TEM Unit",
  "CPU95,TEM Logic",
  "CPU95,TEM Power",
  "CPU Alternator",
  "CPU-XL J-Box",
  "CPU-XL Logic",
  "CPU-XL Output",
  "DC Convertor",
  "Dist.Brds",
  "DISN,CEC,IPMD Logic",
  "DISN,CEC,IPMD Unit",
  "GOV/AGV Unit",
  "GOV Display/PCBs",
  "SaveAir,HyperFuel",
] as const;
