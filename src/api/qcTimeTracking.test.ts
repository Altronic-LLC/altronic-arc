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

  // An entry is a record that QC spent time on something. Correcting one is
  // an edit; removing one is a deliberate trip to SharePoint — the absence of
  // a delete function is the feature, not an oversight.
  it("exposes no delete at all", () => {
    const exported = Object.keys(qcTimeApi);
    expect(exported.filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});
