import type {
  Equipment,
  MaintenanceReferenceValue,
  MaintenanceTask,
  Person,
  ProjectReference,
} from "@/types/task";

// =============================================================================
// Small, explicit work-order fixtures for the CMMS work-order surface tests.
//
// Deliberately NOT `MOCK_MAINTENANCE_TASKS` from src/data: those are demo data
// owned elsewhere, dated relative to today and liable to grow — a filter test
// asserting "two rows match" against a fixture somebody else is free to extend
// is a test that fails for a reason unrelated to the code it covers. View
// tests that exercise the real mock API still go through the demo data; unit
// tests build exactly the rows they mean.
// =============================================================================

export const TECH: Person = {
  displayName: "David Bulkley",
  email: "david.bulkley@altronic-llc.com",
  lookupId: 24,
};
export const OTHER_TECH: Person = {
  displayName: "Alyssa Garrett",
  email: "alyssa.garrett@altronic-llc.com",
  lookupId: 63,
};
export const SUPERVISOR: Person = {
  displayName: "Ray White",
  email: "ray.white@altronic-llc.com",
  lookupId: 22,
};

/**
 * A Department / Location reference, as the domain holds one since 2026-08-28.
 *
 * `ref(4, "MACH SHOP")` reads about as well as the bare string it replaced,
 * which matters: every filter, metric and prefill test names a department
 * dozens of times, and an inline object literal at each one buries the thing
 * the test is actually about.
 */
export function ref(lookupId: number, title: string): ProjectReference {
  return { lookupId, title };
}

/** One row of a reference list — the shape the two admin-managed lists hold. */
export function makeReferenceValue(
  overrides: Partial<MaintenanceReferenceValue> & { lookupId: number; title: string },
): MaintenanceReferenceValue {
  return { active: true, note: "", ...overrides };
}

/** Midday UTC, `offset` days from `from` — the date-only storage convention. */
export function day(offset: number, from: Date = new Date()): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset, 12, 0, 0),
  );
}

export function makeTask(overrides: Partial<MaintenanceTask> & { id: number }): MaintenanceTask {
  return {
    woNumber: `WO-2026-${String(overrides.id).padStart(4, "0")}`,
    title: `Work order ${overrides.id}`,
    description: "",
    status: "Backlog",
    priority: null,
    category: null,
    taskType: "Request",
    dueStatus: null,
    startDate: null,
    dueDate: null,
    completedDate: null,
    equipment: null,
    scheduleRef: null,
    operationsTaskRef: null,
    operationsProject: null,
    department: null,
    location: null,
    assigned: null,
    reportedBy: null,
    completedBy: null,
    watchers: [],
    techNotes: "",
    failureCause: "",
    resolution: "",
    partsUsed: "",
    laborHours: null,
    downtimeHours: null,
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-08-01T09:00:00Z"),
    modifiedAt: new Date("2026-08-01T09:00:00Z"),
    ...overrides,
  };
}

export function makeAsset(overrides: Partial<Equipment> & { lookupId: number }): Equipment {
  return {
    name: `Asset ${overrides.lookupId}`,
    description: "",
    serialNo: "",
    manufacturer: "",
    modelNumber: "",
    equipmentType: null,
    department: null,
    location: null,
    criticality: null,
    assetStatus: null,
    parentAsset: null,
    installDate: null,
    warrantyExpiry: null,
    responsibleTech: null,
    hasAttachments: false,
    ...overrides,
  };
}
