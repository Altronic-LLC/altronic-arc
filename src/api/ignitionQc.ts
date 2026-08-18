import { graphFetch, graphFetchAll } from "./graph";
import { SITES, USE_MOCK } from "./config";
import type { GraphListItem } from "@/types/task";
import type { IgnitionQcRecord } from "@/lib/ignitionQc";
import { IGNITION_QC_SAMPLE_RECORDS } from "@/data/ignitionQcMockData";

// =============================================================================
// Ignition QC API
//
// 36 separate SharePoint lists on the Engineering site, one per product family
// (see IGN QC backend.csv, discovered 2026-08-17). Each list stores QC defect
// log entries for that family, same shape as Digital QC.
//
// In mock mode, these functions operate on in-memory mock data.
// In real mode, they hit Microsoft Graph to query/mutate the family's list.
// =============================================================================

export const IGNITION_QC_FAMILY_LIST_IDS = {
  "24V Alternator":
    import.meta.env.VITE_SP_QC_IGN_ALTERNATOR_LIST_ID || "fc12c4c7-28fd-45d0-b8ba-c600eed73363",
  "24V Regulator":
    import.meta.env.VITE_SP_QC_IGN_REGULATOR_LIST_ID || "599c546a-dba9-418c-9785-542908936d18",
  "Alt 1 Module":
    import.meta.env.VITE_SP_QC_IGN_ALT1_MOD_LIST_ID || "b4486a20-b573-45af-aa2a-2d828e549fb4",
  "Alt 1 Unit":
    import.meta.env.VITE_SP_QC_IGN_ALT1_UNIT_LIST_ID || "9b6f9b1e-5916-440f-ac0a-f19c94898a4d",
  "Alt II,CPU II Unit":
    import.meta.env.VITE_SP_QC_IGN_ALT2_CPU2_UNIT_LIST_ID ||
    "d394a921-2289-4951-b306-4eabd5b39bc1",
  "Altronic III Brds":
    import.meta.env.VITE_SP_QC_IGN_ALT3_BOARD_LIST_ID || "1b54205d-0609-4917-a483-17f242ac674e",
  "Alt III Misc":
    import.meta.env.VITE_SP_QC_IGN_ALT3_MISC_LIST_ID || "6df78bf7-2978-448e-98f9-6fffef65a66f",
  "Altronic III Unit":
    import.meta.env.VITE_SP_QC_IGN_ALT3_UNITS_LIST_ID || "5d318727-9433-4201-9339-355867eccbab",
  "Altronic I Electronic Box":
    import.meta.env.VITE_SP_QC_IGN_ALTRONIC_I_BOX_LIST_ID ||
    "930e14da-9d6d-43d8-90a1-6ed2767c8c7b",
  "Altronic V Brds":
    import.meta.env.VITE_SP_QC_IGN_ALTRONIC_V_BOARD_LIST_ID ||
    "8224765f-9e26-4a50-a20c-b0aec53f4def",
  "Altronic V Unit":
    import.meta.env.VITE_SP_QC_IGN_ALTRONIC_V_UNIT_LIST_ID ||
    "0e4ff8e5-d088-429e-9145-d6b27ad4f86e",
  "CCD/WCD Unit":
    import.meta.env.VITE_SP_QC_IGN_CCD_WCD_UNIT_LIST_ID || "4a71bc82-49a7-4ce8-bfb5-6728c9646d06",
  "CD1/2/PM1 Unit":
    import.meta.env.VITE_SP_QC_IGN_CD1_CD2_PM1_LIST_ID || "a864c32f-8d85-46ce-8973-0dda12a26cb3",
  CD200: import.meta.env.VITE_SP_QC_IGN_CD200_LIST_ID || "c25b85ee-8970-497e-8fde-f1ea423d3730",
  "CIM Unit":
    import.meta.env.VITE_SP_QC_IGN_CIM_UNIT_LIST_ID || "efae6fa7-c6ec-44f0-a8a1-54d51a1b47ab",
  BackCover:
    import.meta.env.VITE_SP_QC_IGN_CPU2_BACKCOVER_LIST_ID ||
    "37e84020-f659-4d5f-9432-480b1d50ef27",
  "CPU II Dist":
    import.meta.env.VITE_SP_QC_IGN_CPU2_DIST_LIST_ID || "30423a3b-0b43-4526-afe2-3efc8079f8fc",
  "CPU2K Diag":
    import.meta.env.VITE_SP_QC_IGN_CPU2K_DIAG_LIST_ID || "064f8e26-648d-4df6-982a-0a9638e4ac11",
  "CPU2K Logic/Display":
    import.meta.env.VITE_SP_QC_IGN_CPU2K_LOGIC_DISPLAY_LIST_ID ||
    "bf7d2bc3-724b-418b-b68f-706115f50302",
  "NGI5K,CPU2K Unit":
    import.meta.env.VITE_SP_QC_IGN_CPU2K_NGI5K_LIST_ID || "c11dca7f-e603-4e27-a711-612408aeb5cf",
  "CPU2K Power":
    import.meta.env.VITE_SP_QC_IGN_CPU2K_POWER_LIST_ID || "123d7ee6-0629-4610-af62-df8318dc327b",
  "CPU II Logic":
    import.meta.env.VITE_SP_QC_IGN_CPU2_LOGIC_LIST_ID || "a645e603-ae45-477e-881b-5e6c15b592c9",
  "CPU95 Display,EVS Power":
    import.meta.env.VITE_SP_QC_IGN_CPU95_DISPLAY_LIST_ID ||
    "1c05e0bd-1837-4ec0-8bd7-0a772e7e0afe",
  "CPU95,TEM Unit":
    import.meta.env.VITE_SP_QC_IGN_CPU95_TEM_UNIT_LIST_ID ||
    "b57f55ef-71a9-4ca3-a7a3-c40f65d45d15",
  "CPU95,TEM Logic":
    import.meta.env.VITE_SP_QC_IGN_CPU95_TEM_LOGIC_LIST_ID ||
    "7524d1f8-9833-42a4-bfdf-af9ad44bbae3",
  "CPU95,TEM Power":
    import.meta.env.VITE_SP_QC_IGN_CPU95_TEM_POWER_LIST_ID ||
    "81de812b-bc3a-4757-ac89-897e927f9ab3",
  "CPU Alternator":
    import.meta.env.VITE_SP_QC_IGN_CPU_ALT_LIST_ID || "61dd6fba-ce8e-48e4-bbe8-a6cdb30a1188",
  "CPU-XL J-Box":
    import.meta.env.VITE_SP_QC_IGN_CPU_XL_JBOX_LIST_ID || "c88ebf2c-b164-4423-8b14-c8cb8d621ca5",
  "CPU-XL Logic":
    import.meta.env.VITE_SP_QC_IGN_CPU_XL_LOGIC_LIST_ID || "85da68b4-fee5-463b-af81-1cfa4bb0ef61",
  "CPU-XL Output":
    import.meta.env.VITE_SP_QC_IGN_CPU_XL_OUTPUT_LIST_ID ||
    "56c872ca-fab8-4d6a-8083-f5372af03471",
  "DC Convertor":
    import.meta.env.VITE_SP_QC_IGN_DC_CONVERTOR_LIST_ID || "a210e1f0-ae42-422a-8e40-c0828314fb1e",
  "Dist.Brds":
    import.meta.env.VITE_SP_QC_IGN_DISN_DIST_LIST_ID || "472254da-8060-4fd9-8d9b-09c26ff43c28",
  "DISN,CEC,IPMD Logic":
    import.meta.env.VITE_SP_QC_IGN_DISN_LOGIC_LIST_ID || "388733c2-b949-408a-882b-fb44753446e5",
  "DISN,CEC,IPMD Unit":
    import.meta.env.VITE_SP_QC_IGN_DISN_UNIT_LIST_ID || "10050797-86a2-4300-acca-a5ed49c9bd47",
  "GOV/AGV Unit":
    import.meta.env.VITE_SP_QC_IGN_GOV_AGV_LIST_ID || "a50e6cfb-e3bf-49f3-8e91-6b525c1b6e10",
  "GOV Display/PCBs":
    import.meta.env.VITE_SP_QC_IGN_GOV_DISPLAY_LIST_ID || "36126516-e7c1-4f88-b0ff-affd28bd64be",
  "SaveAir,HyperFuel":
    import.meta.env.VITE_SP_QC_IGN_SAVEAIR_HYPERFUEL_LIST_ID ||
    "e82bb82a-1847-410d-adc4-0a699a77c071",
} as const;

type ProductFamily = keyof typeof IGNITION_QC_FAMILY_LIST_IDS;

type QcFieldKey = keyof Omit<IgnitionQcRecord, "id" | "productFamily">;

interface GraphColumnDef {
  name?: string;
  displayName?: string;
}

const QC_FIELD_NAMES: Record<QcFieldKey, string[]> = {
  workOrder: ["Title", "Work Order"],
  dateTested: ["DateTested", "Date Tested"],
  operator: ["Operator"],
  oldNumber: ["OldNumber", "Old Number"],
  sapNumber: ["SAPNumber", "SAP Number"],
  revisionNoFirmwareDate: ["RevisionNoFirmwareDate", "Revision No Firmware Date"],
  comments: ["Comments", "Comment", "Notes"],
  quantityTested: ["QuantityTested", "Quantity Tested"],
  quantityRejected: ["QuantityRejected", "Quantity Rejected"],
  processSolderDefect: ["ProcessSolderDefect", "Process Solder Defect"],
  aeSolderDefect: ["AESolderDefect", "AE Solder Defect"],
  aeWiringDeficiency: ["AEWiringDeficiency", "AE Wiring Deficiency"],
  aeWrongOrMissingComponent: ["AEWrongOrMissingComponent", "AE Wrong or Missing Component"],
  aeAssemblyDeficiency: ["AEAssemblyDeficiency", "AE Assembly Deficiency"],
  aeIdentificationDeficiency: ["AEIdentificationDeficiency", "AE Identification Deficiency"],
  programmingFirmware: ["ProgrammingFirmware", "ProgrammingFirmware"],
  coatingPottingDeficiency: ["CoatingPottingDeficiency", "CoatingPotting Deficiency"],
  machinePartPlacementDeficiency: ["MachinePartPlacementDeficiency", "Machine Part Placement Deficiency"],
  physicalDamage: ["PhysicalDamage", "Physical Damge", "Physical Damage"],
  ncmVendor: ["NCMVendor", "NCM Vendor"],
  ncmInternal: ["NCMInternal", "NCM Internal"],
  toRP: ["ToRP", "To RP"],
  other: ["Other"],
};

function normaliseColumnName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const qcColumnCache = new Map<ProductFamily, Record<QcFieldKey, string>>();

async function getQcColumnNames(family: ProductFamily): Promise<Record<QcFieldKey, string>> {
  const cached = qcColumnCache.get(family);
  if (cached) return cached;

  const listId = IGNITION_QC_FAMILY_LIST_IDS[family];
  const response = await graphFetch<{ value: GraphColumnDef[] }>(
    `/sites/${SITES.engineering}/lists/${listId}/columns?$select=name,displayName`,
  );
  const columns = response.value ?? [];
  const byName = new Map(
    columns.flatMap((column) =>
      column.name ? [[normaliseColumnName(column.name), column.name] as const] : [],
    ),
  );
  const byDisplayName = new Map(
    columns.flatMap((column) =>
      column.displayName && column.name
        ? [[normaliseColumnName(column.displayName), column.name] as const]
        : [],
    ),
  );
  const resolved = {} as Record<QcFieldKey, string>;

  for (const [key, candidates] of Object.entries(QC_FIELD_NAMES) as [QcFieldKey, string[]][]) {
    const name = candidates
      .map(normaliseColumnName)
      .map((candidate) => byName.get(candidate) ?? byDisplayName.get(candidate))
      .find(Boolean);
    if (!name) throw new Error(`SharePoint column not found for Ignition QC field: ${key}`);
    resolved[key] = name;
  }

  qcColumnCache.set(family, resolved);
  return resolved;
}

function toIgnitionQcRecord(
  item: GraphListItem,
  family: ProductFamily,
  names?: Record<QcFieldKey, string>,
): IgnitionQcRecord {
  const fields = item.fields as Record<string, unknown>;
  const field = (key: QcFieldKey) => fields[names?.[key] ?? QC_FIELD_NAMES[key][0]];
  return {
    id: item.id,
    productFamily: family,
    workOrder: String(field("workOrder") ?? ""),
    dateTested: String(field("dateTested") ?? ""),
    operator: String(field("operator") ?? ""),
    oldNumber: String(field("oldNumber") ?? ""),
    sapNumber: String(field("sapNumber") ?? ""),
    revisionNoFirmwareDate: String(field("revisionNoFirmwareDate") ?? ""),
    comments: String(field("comments") ?? ""),
    quantityTested: Number(field("quantityTested") ?? 0),
    quantityRejected: Number(field("quantityRejected") ?? 0),
    processSolderDefect: Number(field("processSolderDefect") ?? 0),
    aeSolderDefect: Number(field("aeSolderDefect") ?? 0),
    aeWiringDeficiency: Number(field("aeWiringDeficiency") ?? 0),
    aeWrongOrMissingComponent: Number(field("aeWrongOrMissingComponent") ?? 0),
    aeAssemblyDeficiency: Number(field("aeAssemblyDeficiency") ?? 0),
    aeIdentificationDeficiency: Number(field("aeIdentificationDeficiency") ?? 0),
    programmingFirmware: Number(field("programmingFirmware") ?? 0),
    coatingPottingDeficiency: Number(field("coatingPottingDeficiency") ?? 0),
    machinePartPlacementDeficiency: Number(field("machinePartPlacementDeficiency") ?? 0),
    physicalDamage: Number(field("physicalDamage") ?? 0),
    ncmVendor: Number(field("ncmVendor") ?? 0),
    ncmInternal: Number(field("ncmInternal") ?? 0),
    toRP: Number(field("toRP") ?? 0),
    other: Number(field("other") ?? 0),
  };
}

// Simulate a small delay in mock mode so loading states can be seen.
function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

let mockRecords = IGNITION_QC_SAMPLE_RECORDS;

// =============================================================================
// Public API
// =============================================================================

export async function listIgnitionQcRecords(family: ProductFamily): Promise<IgnitionQcRecord[]> {
  if (USE_MOCK) {
    await mockDelay();
    return mockRecords.filter((r) => r.productFamily === family);
  }

  const listId = IGNITION_QC_FAMILY_LIST_IDS[family];
  if (!listId) {
    console.warn(`No list ID configured for product family: ${family}`);
    return [];
  }

  const names = await getQcColumnNames(family);
  const FIELD_SELECT = Object.values(names).join(",");

  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items?$expand=fields($select=${FIELD_SELECT})`,
  );

  return items.map((item) => toIgnitionQcRecord(item, family, names));
}

export async function createIgnitionQcRecord(
  family: ProductFamily,
  record: Omit<IgnitionQcRecord, "id" | "productFamily">,
): Promise<IgnitionQcRecord> {
  if (USE_MOCK) {
    await mockDelay();
    const id = String(Math.max(...mockRecords.map((r) => Number(r.id.replace(/\D/g, "")) || 0)) + 1);
    const newRecord: IgnitionQcRecord = {
      ...record,
      id,
      productFamily: family,
    };
    mockRecords = [newRecord, ...mockRecords];
    return newRecord;
  }

  const listId = IGNITION_QC_FAMILY_LIST_IDS[family];
  if (!listId) {
    throw new Error(`No list ID configured for product family: ${family}`);
  }

  const names = await getQcColumnNames(family);
  const fields = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [names[key as QcFieldKey], value]),
  );

  const item = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
  );

  return toIgnitionQcRecord(item, family, names);
}

export async function updateIgnitionQcRecord(
  family: ProductFamily,
  recordId: string,
  record: Omit<IgnitionQcRecord, "id" | "productFamily">,
): Promise<IgnitionQcRecord> {
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

  const listId = IGNITION_QC_FAMILY_LIST_IDS[family];
  if (!listId) {
    throw new Error(`No list ID configured for product family: ${family}`);
  }

  const names = await getQcColumnNames(family);
  const fields = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [names[key as QcFieldKey], value]),
  );

  const item = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    },
  );

  return toIgnitionQcRecord(item, family, names);
}

export async function deleteIgnitionQcRecord(
  family: ProductFamily,
  recordId: string,
): Promise<void> {
  if (USE_MOCK) {
    await mockDelay();
    mockRecords = mockRecords.filter((r) => !(r.id === recordId && r.productFamily === family));
    return;
  }

  const listId = IGNITION_QC_FAMILY_LIST_IDS[family];
  if (!listId) {
    throw new Error(`No list ID configured for product family: ${family}`);
  }

  await graphFetch<void>(
    `/sites/${SITES.engineering}/lists/${listId}/items/${recordId}`,
    { method: "DELETE" },
  );
}
