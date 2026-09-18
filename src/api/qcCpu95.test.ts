import { afterEach, describe, it, expect } from "vitest";
import * as qcCpu95Api from "./qcCpu95";
import {
  __resetQcCpu95MockStore,
  createQcCpu95Record,
  getQcCpu95Record,
  listQcCpu95Records,
  updateQcCpu95Record,
} from "./qcCpu95";
import { qcCpu95EmptyValues } from "@/lib/qcCpu95Fields";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

afterEach(() => {
  __resetQcCpu95MockStore();
});

describe("QC CPU-95 test sheet API", () => {
  it("lists the seeded fixtures", async () => {
    const records = await listQcCpu95Records();
    expect(records.length).toBeGreaterThan(0);
  });

  it("creates a test sheet and reads it back", async () => {
    const created = await createQcCpu95Record({
      ...qcCpu95EmptyValues(),
      serialNumber: "TEST-1",
      altronicPartNumber: "791950-16",
    });
    expect(created.values.serialNumber).toBe("TEST-1");

    const found = await getQcCpu95Record(created.id);
    expect(found?.values.altronicPartNumber).toBe("791950-16");
  });

  it("puts a new sheet at the front of the list", async () => {
    const created = await createQcCpu95Record({
      ...qcCpu95EmptyValues(),
      serialNumber: "TEST-NEWEST",
      dateTested: "2099-01-01",
    });
    const records = await listQcCpu95Records();
    expect(records[0].id).toBe(created.id);
  });

  it("saves every field on an edit", async () => {
    const created = await createQcCpu95Record({ ...qcCpu95EmptyValues(), serialNumber: "TEST-2" });
    const updated = await updateQcCpu95Record(created.id, {
      ...qcCpu95EmptyValues(),
      serialNumber: "TEST-2-RENAMED",
      comments: "Edited.",
    });
    expect(updated.values.serialNumber).toBe("TEST-2-RENAMED");
    expect(updated.values.comments).toBe("Edited.");
  });

  it("returns null for a test sheet that isn't there", async () => {
    expect(await getQcCpu95Record(999_999)).toBeNull();
  });

  it("rejects an update to a missing test sheet", async () => {
    await expect(updateQcCpu95Record(999_999, qcCpu95EmptyValues())).rejects.toThrow();
  });

  // No delete: a test sheet is a signed, dated record — the same "correct
  // with an edit" rule as FAIT and Visit Reports.
  it("exposes no delete function", () => {
    const exported = Object.keys(qcCpu95Api);
    expect(exported.filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});
