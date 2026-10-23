import { describe, it, expect } from "vitest";
import type { GraphListItem } from "@/types/task";
import {
  buildQcFormFields,
  compareQcFormRecords,
  qcFieldLabel,
  qcFormEmptyValues,
  qcFormRecordLabel,
  qcFormStatus,
  qcFormStatusSortKey,
  qcNounHeading,
  qcSectionTitle,
  qcVisibleFields,
  toQcFormRecord,
  type QcFormRecord,
  type QcFormSpec,
} from "./qcFormEngine";
import { QC_CPU95_FORM } from "./qcCpu95Form";
import { QC_FORMS, qcFormById } from "./qcForms";

// =============================================================================
// The QC form engine, run against the CPU-95 spec — the form it was pulled
// out of, so every rule CPU-95 had is pinned here against the engine (QC
// Forms roadmap, Phase 0). The last block checks every REGISTERED spec is
// well formed, so a new form that names a key it hasn't got fails here.
// =============================================================================

const SPEC = QC_CPU95_FORM;
const toRecord = (item: GraphListItem) => toQcFormRecord(SPEC, item);
const build = (values: Record<string, string>) => buildQcFormFields(SPEC, values);

function item(fields: Record<string, unknown>, id = "1"): GraphListItem {
  return {
    id,
    fields,
    createdDateTime: "2026-05-13T12:00:00Z",
    lastModifiedDateTime: "2026-05-14T12:00:00Z",
  } as unknown as GraphListItem;
}

describe("toQcFormRecord", () => {
  it("reads the serial number out of Title", () => {
    const record = toRecord(item({ Title: "25564", AltronicPartNumber: "791950-16" }));
    expect(record.values.serialNumber).toBe("25564");
    expect(record.values.altronicPartNumber).toBe("791950-16");
  });

  it("maps a checked boolean column to the 'Yes' convention", () => {
    const record = toRecord(item({ InRepair: true }));
    expect(record.values.inRepair).toBe("Yes");
  });

  it("maps an unchecked / missing boolean column to an empty string", () => {
    const record = toRecord(item({ InRepair: false }));
    expect(record.values.inRepair).toBe("");
    const sparse = toRecord(item({}));
    expect(sparse.values.inRepair).toBe("");
  });

  it("reads a date-only column into the yyyy-mm-dd form DateField expects", () => {
    const record = toRecord(item({ DateTested: "2026-05-13T12:00:00Z" }));
    expect(record.values.dateTested).toBe("2026-05-13");
  });

  it("leaves a blank column as an empty string, never 'null' or 'undefined'", () => {
    const record = toRecord(item({}));
    expect(record.values.testRpm).toBe("");
    expect(record.values.comments).toBe("");
  });

  it("carries a plain number/text column through as a string", () => {
    const record = toRecord(item({ TestRpm: "1200", Startup20vE1: 137 }));
    expect(record.values.testRpm).toBe("1200");
    expect(record.values.startup20vE1).toBe("137");
  });

  it("reads a check's Yes / No / N/A, and anything else as unanswered", () => {
    const record = toRecord(item({ FinalMultiFire: "N/A", FinalGndSD: "No", FinalGndGLead: "Yes", InspClean: "maybe" }));
    expect(record.values.finalMultiFire).toBe("N/A");
    expect(record.values.finalGndSD).toBe("No");
    expect(record.values.finalGndGLead).toBe("Yes");
    expect(record.values.inspClean).toBe("");
  });

  it("reads a date-time (the oven ON/OFF) as a local date and time", () => {
    const on = new Date(2026, 8, 18, 13, 5);
    const record = toRecord(item({ OvenOn: on.toISOString(), OvenOff: null }));
    expect(record.values.ovenOn).toBe("2026-09-18T13:05");
    expect(record.values.ovenOff).toBe("");
  });

  it("parses the numeric item id and the Graph-level created/modified stamps", () => {
    const record = toRecord(item({}, "42"));
    expect(record.id).toBe(42);
    expect(record.createdAt.toISOString()).toBe("2026-05-13T12:00:00.000Z");
    expect(record.modifiedAt.toISOString()).toBe("2026-05-14T12:00:00.000Z");
  });

  it("reads only the columns the form declares", () => {
    const record = toRecord(item({ Title: "1", LegacySource: "CPU-95#4" }));
    expect(record.values).not.toHaveProperty("LegacySource");
    expect(Object.keys(record.values)).toHaveLength(SPEC.fields.length);
  });
});

describe("buildQcFormFields", () => {
  it("round-trips a record's values back into the same internal column shape", () => {
    const original = toRecord(
      item({
        Title: "25564",
        AltronicPartNumber: "791950-16",
        InRepair: true,
        DateTested: "2026-05-13T12:00:00Z",
        TestRpm: "1200",
        FinalMultiFire: "N/A",
        OvenOn: "2026-09-18T18:05:00.000Z",
      }),
    );
    const fields = build(original.values);
    expect(fields.Title).toBe("25564");
    expect(fields.AltronicPartNumber).toBe("791950-16");
    expect(fields.InRepair).toBe(true);
    expect(fields.DateTested).toBe("2026-05-13T12:00:00Z");
    expect(fields.TestRpm).toBe("1200");
    expect(fields.FinalMultiFire).toBe("N/A");
    expect(fields.OvenOn).toBe("2026-09-18T18:05:00.000Z");
  });

  it("writes an unanswered check as null, never 'No'", () => {
    const fields = build({ finalMultiFire: "", finalGndSD: "Yes" });
    expect(fields.FinalMultiFire).toBeNull();
    expect(fields.FinalGndSD).toBe("Yes");
  });

  it("writes a blank date-time as null", () => {
    expect(build({ ovenOn: "" }).OvenOn).toBeNull();
  });

  it("writes a boolean column as a real boolean, not the string 'Yes'", () => {
    expect(build({ inRepair: "Yes" }).InRepair).toBe(true);
  });

  it("writes an empty boolean as false, not blank", () => {
    expect(build({ inRepair: "" }).InRepair).toBe(false);
  });

  it("writes a blank number column as null, not an empty string", () => {
    expect(build({ testCurrentLoop: "" }).TestCurrentLoop).toBeNull();
  });

  it("writes a blank date column as null", () => {
    expect(build({ dateTested: "" }).DateTested).toBeNull();
  });

  it("defaults every missing key to a blank write rather than throwing", () => {
    expect(() => build({})).not.toThrow();
  });
});

describe("qcFormEmptyValues", () => {
  it("gives every declared field key a blank string", () => {
    const empty = qcFormEmptyValues(SPEC);
    expect(Object.keys(empty)).toHaveLength(SPEC.fields.length);
    for (const field of SPEC.fields) expect(empty[field.key]).toBe("");
  });
});

describe("visibility and labels, from the spec's unit", () => {
  it("shows every field on the blank form", () => {
    expect(qcVisibleFields(SPEC, null)).toHaveLength(SPEC.fields.length);
  });

  it("shows a unit only its variant's fields and its own grid rows", () => {
    const keys = (pn: string) => qcVisibleFields(SPEC, { altronicPartNumber: pn }).map((f) => f.key);
    expect(keys("791955-16")).toContain("startupDisplayReady");
    expect(keys("791950-16")).not.toContain("startupDisplayReady");
    expect(keys("791950-08").filter((k) => k.startsWith("firingSpec"))).toHaveLength(8);
  });

  it("labels a grid slot with its row letter, and a field with the variant's wording", () => {
    const slot7 = SPEC.fields.find((f) => f.key === "firingSpec07")!;
    expect(qcFieldLabel(SPEC, slot7, { altronicPartNumber: "791950-18" })).toBe("G");
    const multiFire = SPEC.fields.find((f) => f.key === "finalMultiFire")!;
    expect(qcFieldLabel(SPEC, multiFire, { altronicPartNumber: "791955-16" })).toMatch(/Multi strike/);
    expect(qcFieldLabel(SPEC, multiFire, null)).toBe("Multi-fire, no warnings");
  });

  it("titles a section through the spec", () => {
    expect(qcSectionTitle(SPEC, "Firing Angles", { altronicPartNumber: "791950-08" })).toBe("Firing Angles — 8 Cyl");
    expect(qcSectionTitle(SPEC, "Header", null)).toBe("Header");
  });

  it("titles the noun for headings", () => {
    expect(qcNounHeading(SPEC)).toBe("Test Sheet");
  });
});

function labelFixture(id: number, serialNumber: string, altronicPartNumber: string): QcFormRecord {
  return { id, values: { serialNumber, altronicPartNumber }, createdAt: new Date(), modifiedAt: new Date() };
}

describe("qcFormRecordLabel", () => {
  it("prefers 'serial — part number' when both are present", () => {
    expect(qcFormRecordLabel(SPEC, labelFixture(1, "25564", "791950-16"))).toBe("25564 — 791950-16");
  });

  it("falls back to the serial number alone", () => {
    expect(qcFormRecordLabel(SPEC, labelFixture(1, "25564", ""))).toBe("25564");
  });

  it("falls back to the part number alone", () => {
    expect(qcFormRecordLabel(SPEC, labelFixture(1, "", "791950-16"))).toBe("791950-16");
  });

  it("falls back to a numbered placeholder when both are blank", () => {
    expect(qcFormRecordLabel(SPEC, labelFixture(7, "", ""))).toBe("Test sheet #7");
  });
});

describe("compareQcFormRecords", () => {
  const compare = compareQcFormRecords(SPEC);
  function fixture(id: number, dateTested: string, daysAgo: number): QcFormRecord {
    return {
      id,
      values: { dateTested },
      createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      modifiedAt: new Date(),
    };
  }

  it("sorts newest Date Tested first", () => {
    const records = [fixture(1, "2026-05-01", 5), fixture(2, "2026-06-01", 5)];
    expect([...records].sort(compare).map((r) => r.id)).toEqual([2, 1]);
  });

  it("falls back to createdAt when Date Tested is blank", () => {
    expect([fixture(1, "", 10), fixture(2, "", 1)].sort(compare).map((r) => r.id)).toEqual([2, 1]);
  });
});

function statusFixture(overrides: Record<string, string>): QcFormRecord {
  return { id: 1, values: overrides, createdAt: new Date(), modifiedAt: new Date() };
}
const status = (overrides: Record<string, string>) => qcFormStatus(SPEC, statusFixture(overrides));
const sortKey = (r: QcFormRecord) => qcFormStatusSortKey(SPEC, r);

describe("qcFormStatus", () => {
  it("is 'new' with nothing filled in", () => {
    expect(status({})).toBe("new");
  });

  it("is 'repair' once In Repair is checked", () => {
    expect(status({ inRepair: "Yes" })).toBe("repair");
  });

  it("is 'complete' once Final Inspection By and Date are both set", () => {
    expect(status({ finalInspectionBy: "JN", finalInspectionDate: "2026-05-13" })).toBe("complete");
  });

  it("is not 'complete' with only one of Final Inspection By / Date set", () => {
    expect(status({ finalInspectionBy: "JN" })).toBe("new");
    expect(status({ finalInspectionDate: "2026-05-13" })).toBe("new");
  });

  it("prefers 'complete' over 'repair' — a unit fixed and signed off is done, not still flagged", () => {
    expect(status({ inRepair: "Yes", finalInspectionBy: "JN", finalInspectionDate: "2026-05-13" })).toBe("complete");
  });

  // Barcode-scanned in (serial + part number) but nothing from the actual
  // test yet — Tim, 2026-09-17.
  it("is 'queued' when only the serial and part number are filled in", () => {
    expect(status({ serialNumber: "26305", altronicPartNumber: "791950-18" })).toBe("queued");
  });

  it("is NOT 'queued' with only one of the two identifying fields set", () => {
    expect(status({ serialNumber: "26305" })).toBe("new");
    expect(status({ altronicPartNumber: "791950-18" })).toBe("new");
  });

  it("is NOT 'queued' once any other field has a value", () => {
    expect(status({ serialNumber: "26305", altronicPartNumber: "791950-18", testRpm: "1200" })).toBe("new");
  });

  it("prefers 'repair' over 'queued' — a unit flagged for repair is never just queued", () => {
    expect(status({ serialNumber: "26305", altronicPartNumber: "791950-18", inRepair: "Yes" })).toBe("repair");
  });

  it("never reports Complete or In Repair for a form that names no keys for them", () => {
    const bare: QcFormSpec = { ...SPEC, status: { completeKeys: [], dateKey: "dateTested" } };
    expect(qcFormStatus(bare, statusFixture({ inRepair: "Yes" }))).toBe("new");
  });
});

describe("qcFormStatusSortKey", () => {
  // A genuinely 'queued' record can never carry a Date Tested — filling one
  // in is exactly what disqualifies it from 'queued' — so these fixtures
  // deliberately have none. An earlier version gave the queued fixture a
  // dateTested anyway, which silently made its real status 'new' and passed
  // for the wrong reason.
  it("ranks every 'new' record below every 'queued' record, whatever their dates", () => {
    const newest = statusFixture({ dateTested: "2026-12-31" });
    const queued = statusFixture({ serialNumber: "26305", altronicPartNumber: "791950-18" });
    expect(qcFormStatus(SPEC, queued)).toBe("queued");
    expect(sortKey(newest)).toBeLessThan(sortKey(queued));
  });

  it("ranks every 'queued' record below every 'repair' record, whatever their dates", () => {
    const queued = statusFixture({ serialNumber: "26305", altronicPartNumber: "791950-18" });
    const oldestRepair = statusFixture({ dateTested: "2020-01-01", inRepair: "Yes" });
    expect(qcFormStatus(SPEC, queued)).toBe("queued");
    expect(sortKey(queued)).toBeLessThan(sortKey(oldestRepair));
  });

  it("ranks every 'repair' record below every 'complete' record, whatever their dates", () => {
    const newestRepair = statusFixture({ dateTested: "2026-12-31", inRepair: "Yes" });
    const oldestComplete = statusFixture({
      dateTested: "2020-01-01",
      finalInspectionBy: "JN",
      finalInspectionDate: "2020-01-02",
    });
    expect(sortKey(newestRepair)).toBeLessThan(sortKey(oldestComplete));
  });

  it("within the same status, ranks the newer Date Tested lower (sorts first, ascending)", () => {
    expect(sortKey(statusFixture({ dateTested: "2026-06-01" }))).toBeLessThan(
      sortKey(statusFixture({ dateTested: "2026-01-01" })),
    );
  });
});

describe("every registered form", () => {
  it("has a unique id, and is found by it", () => {
    const ids = QC_FORMS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const form of QC_FORMS) expect(qcFormById(form.id)).toBe(form);
    expect(qcFormById("nope")).toBeNull();
    expect(qcFormById(undefined)).toBeNull();
  });

  for (const form of QC_FORMS) {
    describe(form.formNumber, () => {
      const keys = new Set(form.fields.map((f) => f.key));
      const has = (key: string) => expect(keys.has(key), key).toBe(true);

      it("declares every key and column once, each in a section it lists", () => {
        expect(keys.size).toBe(form.fields.length);
        expect(new Set(form.fields.map((f) => f.column)).size).toBe(form.fields.length);
        for (const f of form.fields) expect(form.sections, f.key).toContain(f.section);
      });

      it("names only keys it has — serial, part number, status, list and search", () => {
        has(form.serialKey);
        has(form.partNumberKey);
        form.status.completeKeys.forEach(has);
        if (form.status.repairKey) has(form.status.repairKey);
        has(form.status.dateKey);
        form.list.columns.forEach((c) => has(c.key));
        form.list.searchKeys.forEach(has);
      });

      it("puts the serial first, so a scan lands there", () => {
        expect(form.fields[0].key).toBe(form.serialKey);
      });

      it("names only keys it has in its grid", () => {
        const grid = form.firingGrid;
        if (!grid) return;
        has(grid.atSpecKey);
        for (const f of form.fields.filter((x) => x.slot)) {
          expect([grid.specKey(f.slot!), grid.actualKey(f.slot!)], f.key).toContain(f.key);
        }
      });
    });
  }
});
