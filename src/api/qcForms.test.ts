import { afterEach, describe, it, expect } from "vitest";
import * as qcFormsApi from "./qcForms";
import {
  __resetQcFormMockStores,
  createQcFormRecord,
  getQcFormRecord,
  listQcFormRecords,
  updateQcFormRecord,
} from "./qcForms";
import { QC_FORM_LISTS } from "./qcFormLists";
import { qcFormEmptyValues, type QcFormSpec } from "@/lib/qcFormEngine";
import { QC_CPU95_FORM } from "@/lib/qcCpu95Form";
import { QC_FORMS } from "@/lib/qcForms";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

const SPEC = QC_CPU95_FORM;
const empty = () => qcFormEmptyValues(SPEC);

afterEach(() => {
  __resetQcFormMockStores();
});

describe("QC form API (CPU-95)", () => {
  it("lists the seeded fixtures", async () => {
    const records = await listQcFormRecords(SPEC);
    expect(records.length).toBeGreaterThan(0);
  });

  it("creates a test sheet and reads it back", async () => {
    const created = await createQcFormRecord(SPEC, { ...empty(), serialNumber: "TEST-1", altronicPartNumber: "791950-16" });
    expect(created.values.serialNumber).toBe("TEST-1");

    const found = await getQcFormRecord(SPEC, created.id);
    expect(found?.values.altronicPartNumber).toBe("791950-16");
  });

  it("puts a new sheet at the front of the list", async () => {
    const created = await createQcFormRecord(SPEC, { ...empty(), serialNumber: "TEST-NEWEST", dateTested: "2099-01-01" });
    const records = await listQcFormRecords(SPEC);
    expect(records[0].id).toBe(created.id);
  });

  it("saves every field on an edit", async () => {
    const created = await createQcFormRecord(SPEC, { ...empty(), serialNumber: "TEST-2" });
    const updated = await updateQcFormRecord(SPEC, created.id, {
      ...empty(),
      serialNumber: "TEST-2-RENAMED",
      comments: "Edited.",
    });
    expect(updated.values.serialNumber).toBe("TEST-2-RENAMED");
    expect(updated.values.comments).toBe("Edited.");
  });

  it("returns null for a test sheet that isn't there", async () => {
    expect(await getQcFormRecord(SPEC, 999_999)).toBeNull();
  });

  it("rejects an update to a missing test sheet", async () => {
    await expect(updateQcFormRecord(SPEC, 999_999, empty())).rejects.toThrow();
  });

  it("restores the fixtures on reset", async () => {
    const before = (await listQcFormRecords(SPEC)).length;
    await createQcFormRecord(SPEC, { ...empty(), serialNumber: "TEST-RESET" });
    __resetQcFormMockStores();
    expect(await listQcFormRecords(SPEC)).toHaveLength(before);
  });

  // No delete: a test sheet is a signed, dated record — the same "correct
  // with an edit" rule as FAIT and Visit Reports.
  it("exposes no delete function", () => {
    const exported = Object.keys(qcFormsApi);
    expect(exported.filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});

describe("each form's own store", () => {
  // A second form must never see the first one's sheets.
  const OTHER: QcFormSpec = { ...SPEC, id: "other-form" };

  it("keeps forms apart, and starts a form with no fixtures empty", async () => {
    expect(await listQcFormRecords(OTHER)).toEqual([]);
    const created = await createQcFormRecord(OTHER, { ...empty(), serialNumber: "OTHER-1" });
    expect((await listQcFormRecords(SPEC)).some((r) => r.id === created.id && r.values.serialNumber === "OTHER-1")).toBe(false);
  });
});

describe("the list registry", () => {
  it("has a SharePoint list for every registered form", () => {
    for (const form of QC_FORMS) expect(QC_FORM_LISTS[form.id], form.id).toBeDefined();
  });
});
