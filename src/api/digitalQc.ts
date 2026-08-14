import { graphFetch, graphFetchAll } from "./graph";
import { SITES, USE_MOCK } from "./config";
import type { GraphListItem } from "@/types/task";
import type { DigitalQcRecord } from "@/lib/digitalQc";
import { DIGITAL_QC_SAMPLE_RECORDS } from "@/data/digitalQcMockData";

// =============================================================================
// Digital QC API
//
// 18 separate SharePoint lists on the Engineering site, one per product family.
// Each list stores QC defect log entries for that family.
//
// In mock mode, these functions operate on in-memory mock data.
// In real mode, they hit Microsoft Graph to query/mutate the family's list.
// =============================================================================

export const DIGITAL_QC_FAMILY_LIST_IDS = {
  "A.F.M.": import.meta.env.VITE_SP_QC_DIG_AFM_LIST_ID || "9f648055-ae05-4a00-87ef-61ce9f63df74",
  "A.F.C.": import.meta.env.VITE_SP_QC_DIG_AFC_LIST_ID || "d9455d57-5666-4cdd-928e-895dd46a7ad7",
  Annunciators:
    import.meta.env.VITE_SP_QC_DIG_ANNUNCIATOR_LIST_ID ||
    "e0c9306c-8534-408b-b222-48d0e1430e3c",
  "DE Display":
    import.meta.env.VITE_SP_QC_DIG_DE_DISPLAY_LIST_ID ||
    "b9160945-e0a4-4545-9795-616bdf0208e2",
  "DE Terminal":
    import.meta.env.VITE_SP_QC_DIG_DE_TERM_LIST_ID || "8b940361-a82b-4de5-827e-787d1869bba0",
  DriveCOM:
    import.meta.env.VITE_SP_QC_DIG_DRIVECOM_LIST_ID || "c6260e37-2173-4d65-82b3-9382a8b57646",
  EnBase: import.meta.env.VITE_SP_QC_DIG_ENBASE_LIST_ID || "70e098de-6e14-4851-86d7-89d0dd81172e",
  "EPC-10X/50":
    import.meta.env.VITE_SP_QC_DIG_EPC_10X_50_LIST_ID ||
    "c683a352-acef-45e5-a48c-339fa1adcb89",
  "EX-200": import.meta.env.VITE_SP_QC_DIG_EX_200_LIST_ID || "afe12cfd-9033-47bd-a3b1-4fb3da8c04f2",
  Exacta: import.meta.env.VITE_SP_QC_DIG_EXACTA_LIST_ID || "ab1b98b3-6317-4950-8ccb-0ef99990339b",
  "Digital Misc.":
    import.meta.env.VITE_SP_QC_DIG_MISC_LIST_ID || "f2c8168a-1819-49ee-8f7f-40eacd105a99",
  "Moris 1,2":
    import.meta.env.VITE_SP_QC_DIG_MORIS_LIST_ID || "5727f6c4-d3dc-4903-92f2-c0883d24b578",
  "P.M.M.": import.meta.env.VITE_SP_QC_DIG_PMM_LIST_ID || "95b89df8-5c86-43a2-96d2-4ef255169141",
  "Power Supply":
    import.meta.env.VITE_SP_QC_DIG_POWER_SUPPLY_LIST_ID ||
    "e5c881f6-c96a-43a1-9a08-c851e51a6cd7",
  "Pressure Gauges":
    import.meta.env.VITE_SP_QC_DIG_PRESSURE_GAGE_LIST_ID ||
    "41a5e25b-003d-49f2-998c-ba55a23904aa",
  Pyrometer:
    import.meta.env.VITE_SP_QC_DIG_PYRO_LIST_ID || "146e0008-712e-416a-967b-dad90e019c7e",
  Saves: import.meta.env.VITE_SP_QC_DIG_SAVES_LIST_ID || "fcdcb85d-9676-44ac-95c8-dea8d2e8979d",
  Tachometer:
    import.meta.env.VITE_SP_QC_DIG_TAC_LIST_ID || "404f99fb-1848-476c-a033-04204510a132",
} as const;

type ProductFamily = keyof typeof DIGITAL_QC_FAMILY_LIST_IDS;

function toDigitalQcRecord(item: GraphListItem, family: ProductFamily): DigitalQcRecord {
  const fields = item.fields as Record<string, unknown>;
  return {
    id: item.id,
    productFamily: family,
    workOrder: String(fields.Title ?? ""),
    dateTested: String(fields.DateTested ?? ""),
    operator: String(fields.Operator ?? ""),
    oldNumber: String(fields.OldNumber ?? ""),
    sapNumber: String(fields.SAPNumber ?? ""),
    revisionNoFirmwareDate: String(fields.RevisionNoFirmwareDate ?? ""),
    quantityTested: Number(fields.QuantityTested ?? 0),
    quantityRejected: Number(fields.QuantityRejected ?? 0),
    processSolderDefect: Number(fields.ProcessSolderDefect ?? 0),
    aeSolderDefect: Number(fields.AESolderDefect ?? 0),
    aeWiringDeficiency: Number(fields.AEWiringDeficiency ?? 0),
    aeWrongOrMissingComponent: Number(fields.AEWrongOrMissingComponent ?? 0),
    aeAssemblyDeficiency: Number(fields.AEAssemblyDeficiency ?? 0),
    aeIdentificationDeficiency: Number(fields.AEIdentificationDeficiency ?? 0),
    programmingFirmware: Number(fields.ProgrammingFirmware ?? 0),
    coatingPottingDeficiency: Number(fields.CoatingPottingDeficiency ?? 0),
    machinePartPlacementDeficiency: Number(fields.MachinePartPlacementDeficiency ?? 0),
    physicalDamage: Number(fields.PhysicalDamage ?? 0),
    ncmVendor: Number(fields.NCMVendor ?? 0),
    ncmInternal: Number(fields.NCMInternal ?? 0),
  };
}

// Simulate a small delay in mock mode so loading states can be seen.
function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

let mockRecords = DIGITAL_QC_SAMPLE_RECORDS;

// =============================================================================
// Public API
// =============================================================================

export async function listDigitalQcRecords(family: ProductFamily): Promise<DigitalQcRecord[]> {
  if (USE_MOCK) {
    await mockDelay();
    return mockRecords.filter((r) => r.productFamily === family);
  }

  const listId = DIGITAL_QC_FAMILY_LIST_IDS[family];
  if (!listId) {
    console.warn(`No list ID configured for product family: ${family}`);
    return [];
  }

  const FIELD_SELECT = [
    "Title",
    "DateTested",
    "Operator",
    "OldNumber",
    "SAPNumber",
    "RevisionNoFirmwareDate",
    "QuantityTested",
    "QuantityRejected",
    "ProcessSolderDefect",
    "AESolderDefect",
    "AEWiringDeficiency",
    "AEWrongOrMissingComponent",
    "AEAssemblyDeficiency",
    "AEIdentificationDeficiency",
    "ProgrammingFirmware",
    "CoatingPottingDeficiency",
    "MachinePartPlacementDeficiency",
    "PhysicalDamage",
    "NCMVendor",
    "NCMInternal",
  ].join(",");

  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items?$expand=fields($select=${FIELD_SELECT})`,
  );

  return items.map((item) => toDigitalQcRecord(item, family));
}

export async function createDigitalQcRecord(
  family: ProductFamily,
  record: Omit<DigitalQcRecord, "id" | "productFamily">,
): Promise<DigitalQcRecord> {
  if (USE_MOCK) {
    await mockDelay();
    const id = String(Math.max(...mockRecords.map((r) => Number(r.id) || 0)) + 1);
    const newRecord: DigitalQcRecord = {
      ...record,
      id,
      productFamily: family,
    };
    mockRecords = [newRecord, ...mockRecords];
    return newRecord;
  }

  const listId = DIGITAL_QC_FAMILY_LIST_IDS[family];
  if (!listId) {
    throw new Error(`No list ID configured for product family: ${family}`);
  }

  const fields = {
    Title: record.workOrder,
    DateTested: record.dateTested,
    Operator: record.operator,
    OldNumber: record.oldNumber,
    SAPNumber: record.sapNumber,
    RevisionNoFirmwareDate: record.revisionNoFirmwareDate,
    QuantityTested: record.quantityTested,
    QuantityRejected: record.quantityRejected,
    ProcessSolderDefect: record.processSolderDefect,
    AESolderDefect: record.aeSolderDefect,
    AEWiringDeficiency: record.aeWiringDeficiency,
    AEWrongOrMissingComponent: record.aeWrongOrMissingComponent,
    AEAssemblyDeficiency: record.aeAssemblyDeficiency,
    AEIdentificationDeficiency: record.aeIdentificationDeficiency,
    ProgrammingFirmware: record.programmingFirmware,
    CoatingPottingDeficiency: record.coatingPottingDeficiency,
    MachinePartPlacementDeficiency: record.machinePartPlacementDeficiency,
    PhysicalDamage: record.physicalDamage,
    NCMVendor: record.ncmVendor,
    NCMInternal: record.ncmInternal,
  };

  const item = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
  );

  return toDigitalQcRecord(item, family);
}

export async function updateDigitalQcRecord(
  family: ProductFamily,
  recordId: string,
  record: Omit<DigitalQcRecord, "id" | "productFamily">,
): Promise<DigitalQcRecord> {
  if (USE_MOCK) {
    await mockDelay();
    mockRecords = mockRecords.map((r) =>
      r.id === recordId && r.productFamily === family
        ? {
            ...r,
            ...record,
          }
        : r,
    );
    return mockRecords.find((r) => r.id === recordId && r.productFamily === family)!;
  }

  const listId = DIGITAL_QC_FAMILY_LIST_IDS[family];
  if (!listId) {
    throw new Error(`No list ID configured for product family: ${family}`);
  }

  const fields = {
    Title: record.workOrder,
    DateTested: record.dateTested,
    Operator: record.operator,
    OldNumber: record.oldNumber,
    SAPNumber: record.sapNumber,
    RevisionNoFirmwareDate: record.revisionNoFirmwareDate,
    QuantityTested: record.quantityTested,
    QuantityRejected: record.quantityRejected,
    ProcessSolderDefect: record.processSolderDefect,
    AESolderDefect: record.aeSolderDefect,
    AEWiringDeficiency: record.aeWiringDeficiency,
    AEWrongOrMissingComponent: record.aeWrongOrMissingComponent,
    AEAssemblyDeficiency: record.aeAssemblyDeficiency,
    AEIdentificationDeficiency: record.aeIdentificationDeficiency,
    ProgrammingFirmware: record.programmingFirmware,
    CoatingPottingDeficiency: record.coatingPottingDeficiency,
    MachinePartPlacementDeficiency: record.machinePartPlacementDeficiency,
    PhysicalDamage: record.physicalDamage,
    NCMVendor: record.ncmVendor,
    NCMInternal: record.ncmInternal,
  };

  const item = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    },
  );

  return toDigitalQcRecord(item, family);
}

export async function deleteDigitalQcRecord(
  family: ProductFamily,
  recordId: string,
): Promise<void> {
  if (USE_MOCK) {
    await mockDelay();
    mockRecords = mockRecords.filter((r) => !(r.id === recordId && r.productFamily === family));
    return;
  }

  const listId = DIGITAL_QC_FAMILY_LIST_IDS[family];
  if (!listId) {
    throw new Error(`No list ID configured for product family: ${family}`);
  }

  await graphFetch<void>(
    `/sites/${SITES.engineering}/lists/${listId}/items/${recordId}`,
    { method: "DELETE" },
  );
}
