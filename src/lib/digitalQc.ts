export interface DigitalQcRecord {
  id: string;
  productFamily: string;
  workOrder: string;
  dateTested: string;
  operator: string;
  oldNumber: string;
  sapNumber: string;
  revisionNoFirmwareDate: string;
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
}

export const DIGITAL_QC_FAMILY_OPTIONS = [
  "A.F.M.",
  "A.F.C.",
  "Annunciators",
  "DE Display",
  "DE Terminal",
  "DriveCOM",
  "EnBase",
  "EPC-10X/50",
  "EX-200",
  "Exacta",
  "Digital Misc.",
  "Moris 1,2",
  "P.M.M.",
  "Power Supply",
  "Pressure Gauges",
  "Pyrometer",
  "Saves",
  "Tachometer",
] as const;

export function getDigitalQcFamilies(records: DigitalQcRecord[]): string[] {
  const fromRecords = [...new Set(records.map((record) => record.productFamily))];
  return [...new Set([...fromRecords, ...DIGITAL_QC_FAMILY_OPTIONS])].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function filterDigitalQcRecords(
  records: DigitalQcRecord[],
  productFamily: string,
): DigitalQcRecord[] {
  return records
    .filter((record) => record.productFamily === productFamily)
    .sort(
      (a, b) => Date.parse(b.dateTested).valueOf() - Date.parse(a.dateTested).valueOf(),
    );
}

export function nextDigitalQcId(records: DigitalQcRecord[]): string {
  const next = records.length + 1;
  return `DQC-${String(next).padStart(4, "0")}`;
}
