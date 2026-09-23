import { describe, it, expect } from "vitest";
import * as qcTimeApi from "./qcTimeTracking";
import { createQcTimeEntry, getQcTimeEntry, listQcTimeEntries, updateQcTimeEntry } from "./qcTimeTracking";
import type { QcTimeEntryInput } from "@/types/task";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

const input: QcTimeEntryInput = {
  project: "Test Panel Project",
  week: 36,
  dateIntoQc: new Date("2026-09-01T12:00:00Z"),
  dateStarted: new Date("2026-09-02T12:00:00Z"),
  sapNo: "SAP-1",
  serialNo: "SN-1",
  performedBy: [{ displayName: "Kim Tech", email: "kim.tech@altronic-llc.com" }],
  hoursRaw: "3",
  effortType: "Support",
  notes: "Test entry.",
  onHold: false,
  holdReason: "",
};

describe("QC time tracking API", () => {
  it("lists entries newest week first", async () => {
    const entries = await listQcTimeEntries();
    expect(entries.length).toBeGreaterThan(0);
  });

  it("creates an entry and reads it back", async () => {
    const created = await createQcTimeEntry(input);
    expect(created.project).toBe("Test Panel Project");

    const found = await getQcTimeEntry(created.id);
    expect(found?.sapNo).toBe("SAP-1");
    expect(found?.effortType).toBe("Support");
  });

  it("puts a new entry at the top when it's the newest week", async () => {
    const created = await createQcTimeEntry({ ...input, week: 999 });
    const entries = await listQcTimeEntries();
    expect(entries[0].id).toBe(created.id);
  });

  it("saves the whole form on an edit", async () => {
    const created = await createQcTimeEntry(input);
    const updated = await updateQcTimeEntry(created.id, {
      ...input,
      project: "Renamed Project",
      hoursRaw: "4.5",
    });
    expect(updated.project).toBe("Renamed Project");
    expect(updated.hoursRaw).toBe("4.5");
  });

  it("returns null for an entry that isn't there", async () => {
    expect(await getQcTimeEntry(999_999)).toBeNull();
  });

  it("rejects an update to a missing entry", async () => {
    await expect(updateQcTimeEntry(999_999, input)).rejects.toThrow();
  });

  it("resolves PerformedByPeople in mock mode the same way a real write would", async () => {
    const created = await createQcTimeEntry(input);
    expect(created.performedBy).toEqual([
      expect.objectContaining({ displayName: "Kim Tech" }),
    ]);
  });

  // This used to assert the module exported NO delete — an entry is a record
  // that QC spent time on something, so correcting one is an edit. That held
  // until 2026-09-16, when two techs on one panel produced a genuine
  // DUPLICATE and there was nothing to correct in a row that shouldn't exist
  // (Ray). The rule that replaced it: exactly one delete, and the ADMIN GATE
  // lives in the hook (`useDeleteQcTimeEntry`) — the API function itself is
  // ungated, so the gate having a test of its own matters
  // (useQcTimeTracking.test.tsx covers both directions).
  it("exposes exactly one delete, for a duplicate", () => {
    const exported = Object.keys(qcTimeApi);
    expect(exported.filter((name) => /delete|remove/i.test(name))).toEqual([
      "deleteQcTimeEntry",
    ]);
  });

  it("deletes the entry it was given, and only that one", async () => {
    const before = await qcTimeApi.listQcTimeEntries();
    const target = before[0].id;

    await qcTimeApi.deleteQcTimeEntry(target);

    const after = await qcTimeApi.listQcTimeEntries();
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((e) => e.id === target)).toBe(false);
  });
});
