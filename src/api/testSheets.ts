import { graphFetch, graphFetchAll } from "./graph";
import { SP_SITE_ID, SP_TEST_RESULTS_LIST_ID, USE_MOCK } from "./config";
import type {
  GraphListItem,
  Person,
  ProjectReference,
  TaskReferenceLite,
  TestSheet,
} from "@/types/task";
import { attachTestSheetReferences, toTestSheet } from "@/lib/testSheetMapper";
import { listProjects, listTasks } from "./tasks";
import { MOCK_TEST_SHEETS } from "@/data/mockData";
import { mockDelay } from "./mockLatency";

// =============================================================================
// Test Sheets API — mirrors src/api/tasks.ts in shape. Operates on a separate
// SharePoint list ("Test Results") on the same Altronic Engineering site.
// =============================================================================

const MOCK_STORAGE_KEY = "aets:mock-testsheets-v1";

function loadMockStoreFromStorage(): TestSheet[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TestSheet[];
    return parsed.map((s) => ({
      ...s,
      testDate: s.testDate ? new Date(s.testDate) : null,
      createdAt: new Date(s.createdAt),
      modifiedAt: new Date(s.modifiedAt),
    }));
  } catch {
    return null;
  }
}

function saveMockStoreToStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockStore));
  } catch {
    // Storage quota exceeded — demo keeps working in-memory.
  }
}

let mockStore: TestSheet[] = loadMockStoreFromStorage() ?? [...MOCK_TEST_SHEETS];

// Fields we read in the mapper — passed to $expand=fields($select=…) so we
// only pull the columns we use, not all of them. Keep in sync with
// `testSheetMapper.toTestSheet()`.
const TEST_SHEET_FIELD_SELECT = [
  "Title",
  "Product",
  "SerialNumber",
  "Purpose",
  "Results",
  "TestDate",
  "ProjectReferenceLookupId",
  "TaskReferenceLookupId",
  "Tester",
  "TestingSteps",
  "FirmwareVersion",
].join(",");

export async function listTestSheets(): Promise<TestSheet[]> {
  if (USE_MOCK) {
    // Re-attach references against the current mock state so renamed
    // projects/tasks show updated titles.
    const projects = (await listProjects()) as ProjectReference[];
    const tasks = await listTasks();
    return mockDelay(
      attachTestSheetReferences(
        mockStore.map((s) => ({ ...s })),
        projects,
        tasks.map((t) => ({ id: t.id, numberedTitle: t.numberedTitle })),
      ),
    );
  }

  if (!SP_TEST_RESULTS_LIST_ID) {
    console.warn(
      "VITE_SP_TEST_RESULTS_LIST_ID is not set — Test Sheets view will be empty.",
    );
    return [];
  }

  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_TEST_RESULTS_LIST_ID}` +
    `/items?$expand=fields($select=${TEST_SHEET_FIELD_SELECT})&$top=200`;
  // Fetch sheets + projects + tasks in parallel; we need the latter two to
  // resolve the human titles on the lookup fields.
  const [items, projects, tasks] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listProjects(),
    listTasks(),
  ]);
  const sheets = items.map(toTestSheet);
  attachTestSheetReferences(
    sheets,
    projects,
    tasks.map((t) => ({ id: t.id, numberedTitle: t.numberedTitle })),
  );
  return sheets;
}

export async function getTestSheet(id: number): Promise<TestSheet | null> {
  const all = await listTestSheets();
  return all.find((s) => s.id === id) ?? null;
}

export interface CreateTestSheetInput {
  title: string;
  product?: string;
  serialNumber?: string;
  purpose?: string;
  results?: string;
  testDate?: Date | null;
  parentProjectLookupId?: number | null;
  parentTaskLookupId?: number | null;
  tester?: Person | null;
  testingSteps?: string;
  firmwareVersion?: string;
}

export async function createTestSheet(input: CreateTestSheetInput): Promise<TestSheet> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((s) => s.id)) + 1;
    const now = new Date();
    const sheet: TestSheet = {
      id: nextId,
      title: input.title,
      product: input.product ?? "",
      serialNumber: input.serialNumber ?? "",
      purpose: input.purpose ?? "",
      results: input.results ?? "",
      testDate: input.testDate ?? null,
      parentProject: input.parentProjectLookupId
        ? { lookupId: input.parentProjectLookupId, title: "" }
        : null,
      parentTask: input.parentTaskLookupId
        ? { id: input.parentTaskLookupId, numberedTitle: "" }
        : null,
      tester: input.tester ?? null,
      testingSteps: input.testingSteps ?? "",
      firmwareVersion: input.firmwareVersion ?? "",
      createdAt: now,
      modifiedAt: now,
      author: null,
    };
    mockStore = [sheet, ...mockStore];
    saveMockStoreToStorage();
    return mockDelay(sheet);
  }

  if (!SP_TEST_RESULTS_LIST_ID) {
    throw new Error(
      "Cannot create a test sheet: VITE_SP_TEST_RESULTS_LIST_ID is not set.",
    );
  }

  // Only send fields the user actually filled in. SharePoint is fussy on
  // create — same lesson the Tasks API learned: skip empty values rather
  // than sending null / "". Matches the truthy-check pattern in tasks.ts.
  const fields: Record<string, unknown> = { Title: input.title };
  if (input.product) fields.Product = input.product;
  if (input.serialNumber) fields.SerialNumber = input.serialNumber;
  if (input.purpose) fields.Purpose = input.purpose;
  if (input.results) fields.Results = input.results;
  if (input.testDate) fields.TestDate = input.testDate.toISOString();
  if (input.parentProjectLookupId) {
    fields.ProjectReferenceLookupId = input.parentProjectLookupId;
  }
  if (input.parentTaskLookupId) {
    fields.TaskReferenceLookupId = input.parentTaskLookupId;
  }
  if (input.tester?.lookupId) {
    fields.TesterLookupId = input.tester.lookupId;
  }
  if (input.testingSteps) fields.TestingSteps = input.testingSteps;
  if (input.firmwareVersion) fields.FirmwareVersion = input.firmwareVersion;

  const created = await graphFetch<GraphListItem>(
    `/sites/${SP_SITE_ID}/lists/${SP_TEST_RESULTS_LIST_ID}/items`,
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
  );
  return toTestSheet(created);
}

export async function updateTestSheetFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<TestSheet> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Test sheet ${id} not found`);
    const next = { ...mockStore[idx], modifiedAt: new Date() };
    if ("Title" in fields) next.title = fields.Title as string;
    if ("Product" in fields) next.product = (fields.Product as string) ?? "";
    if ("SerialNumber" in fields) next.serialNumber = (fields.SerialNumber as string) ?? "";
    if ("Purpose" in fields) next.purpose = (fields.Purpose as string) ?? "";
    if ("Results" in fields) next.results = (fields.Results as string) ?? "";
    if ("TestDate" in fields) {
      const v = fields.TestDate;
      next.testDate = v ? new Date(v as string) : null;
    }
    if ("ProjectReferenceLookupId" in fields) {
      const v = fields.ProjectReferenceLookupId;
      next.parentProject = v ? { lookupId: Number(v), title: "" } : null;
    }
    if ("TaskReferenceLookupId" in fields) {
      const v = fields.TaskReferenceLookupId;
      next.parentTask = v ? { id: Number(v), numberedTitle: "" } : null;
    }
    if ("Tester" in fields) {
      const v = fields.Tester;
      next.tester = (Array.isArray(v) ? v[0] : v) as Person | null;
    }
    if ("TestingSteps" in fields) next.testingSteps = (fields.TestingSteps as string) ?? "";
    if ("FirmwareVersion" in fields) {
      next.firmwareVersion = (fields.FirmwareVersion as string) ?? "";
    }
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return mockDelay(next);
  }

  if (!SP_TEST_RESULTS_LIST_ID) {
    throw new Error(
      "Cannot update a test sheet: VITE_SP_TEST_RESULTS_LIST_ID is not set.",
    );
  }

  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${SP_TEST_RESULTS_LIST_ID}/items/${id}/fields`,
    {
      method: "PATCH",
      body: JSON.stringify(fields),
    },
  );
  const updated = await getTestSheet(id);
  if (!updated) throw new Error(`Test sheet ${id} disappeared after update`);
  return updated;
}

// Re-export for tests that want to control the mock store.
export const __mockStore = {
  reset(seed: TestSheet[] = [...MOCK_TEST_SHEETS]) {
    mockStore = seed.map((s) => ({ ...s }));
  },
};

// Hint for IDEs that this is a used reference, not a dead import.
export type { TaskReferenceLite };
