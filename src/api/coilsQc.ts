import { graphFetch, graphFetchAll } from "./graph";
import {
  SITES,
  SP_COIL_OTHER_FAULTS_LIST_ID,
  SP_COIL_PART_NUMBERS_LIST_ID,
  SP_QC_COILS_LIST_ID,
  USE_MOCK,
} from "./config";
import { COILS_QC_MOCK_ENTRIES } from "@/data/coilsQcMockData";
import {
  COIL_DEFECT_FIELDS,
  type CoilDefectField,
  type CoilDefectLogEntry,
  type CoilDefectLogInput,
} from "@/lib/coilsQc";
import { parseSpDate, toDateInputValue, fromDateInputValue, toSpDateOnly } from "@/lib/spDates";
import type { GraphListItem } from "@/types/task";

const COILS_QC_SELECT = [
  "Title",
  "Date",
  "Produced",
  "Failed",
  "OtherFaultTable",
  ...COIL_DEFECT_FIELDS,
].join(",");

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCoilDefectLogEntry(item: GraphListItem): CoilDefectLogEntry {
  const fields = item.fields as Record<string, unknown>;
  const defects = Object.fromEntries(
    COIL_DEFECT_FIELDS.map((field) => [field, toNumber(fields[field])]),
  ) as Record<CoilDefectField, number>;

  return {
    id: item.id,
    coilPartNumber: String(fields.Title ?? ""),
    date: toDateInputValue(parseSpDate(fields.Date)),
    produced: toNumber(fields.Produced),
    failed: toNumber(fields.Failed),
    defects,
    otherFaultTable: String(fields.OtherFaultTable ?? ""),
  };
}

export async function listCoilDefectLog(): Promise<CoilDefectLogEntry[]> {
  if (USE_MOCK) return [...COILS_QC_MOCK_ENTRIES];

  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${SP_QC_COILS_LIST_ID}/items?$expand=fields($select=${COILS_QC_SELECT})`,
  );
  return items.map(toCoilDefectLogEntry).sort((left, right) => right.date.localeCompare(left.date));
}

function toFields(input: CoilDefectLogInput): Record<string, unknown> {
  return {
    Title: input.coilPartNumber,
    Date: toSpDateOnly(fromDateInputValue(input.date)),
    Produced: input.produced,
    Failed: input.failed,
    OtherFaultTable: input.otherFaultTable,
    ...input.defects,
  };
}

let mockEntries = COILS_QC_MOCK_ENTRIES;
let mockPartNumbers = ["692140-1", "692141-1"];
let mockOtherFaults = ["Gap", "Cosmetic damage"];

export async function createCoilDefectLogEntry(input: CoilDefectLogInput): Promise<CoilDefectLogEntry> {
  if (USE_MOCK) {
    const entry = { ...input, id: String(Math.max(0, ...mockEntries.map((entry) => Number(entry.id))) + 1) };
    mockEntries = [entry, ...mockEntries];
    return entry;
  }

  const item = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${SP_QC_COILS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields: toFields(input) }) },
  );
  return toCoilDefectLogEntry(item);
}

export async function updateCoilDefectLogEntry(
  id: string,
  input: CoilDefectLogInput,
): Promise<CoilDefectLogEntry> {
  if (USE_MOCK) {
    const entry = { ...input, id };
    mockEntries = mockEntries.map((current) => (current.id === id ? entry : current));
    return entry;
  }

  const item = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${SP_QC_COILS_LIST_ID}/items/${id}`,
    { method: "PATCH", body: JSON.stringify({ fields: toFields(input) }) },
  );
  return toCoilDefectLogEntry(item);
}

export async function listCoilPartNumbers(): Promise<string[]> {
  if (USE_MOCK) return [...mockPartNumbers];
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${SP_COIL_PART_NUMBERS_LIST_ID}/items?$expand=fields($select=Title)`,
  );
  return items.map((item) => String((item.fields as Record<string, unknown>).Title ?? "")).filter(Boolean);
}

export async function addCoilPartNumber(partNumber: string): Promise<string> {
  const title = partNumber.trim();
  if (!title) throw new Error("A coil part number is required.");
  if (USE_MOCK) {
    if (!mockPartNumbers.includes(title)) mockPartNumbers = [...mockPartNumbers, title];
    return title;
  }
  await graphFetch<GraphListItem>(`/sites/${SITES.engineering}/lists/${SP_COIL_PART_NUMBERS_LIST_ID}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: { Title: title } }),
  });
  return title;
}

export async function listCoilOtherFaults(): Promise<string[]> {
  if (USE_MOCK) return [...mockOtherFaults];
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${SP_COIL_OTHER_FAULTS_LIST_ID}/items?$expand=fields($select=Title)`,
  );
  return items.map((item) => String((item.fields as Record<string, unknown>).Title ?? "")).filter(Boolean);
}

export async function addCoilOtherFault(fault: string): Promise<string> {
  const title = fault.trim();
  if (!title) throw new Error("An Other defect is required.");
  if (USE_MOCK) {
    if (!mockOtherFaults.includes(title)) mockOtherFaults = [...mockOtherFaults, title];
    return title;
  }
  await graphFetch<GraphListItem>(`/sites/${SITES.engineering}/lists/${SP_COIL_OTHER_FAULTS_LIST_ID}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: { Title: title } }),
  });
  return title;
}