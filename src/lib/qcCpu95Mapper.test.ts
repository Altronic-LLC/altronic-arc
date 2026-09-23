import { describe, it, expect } from "vitest";
import type { GraphListItem, QcCpu95Record } from "@/types/task";
import {
  buildQcCpu95Fields,
  compareQcCpu95Records,
  QC_CPU95_PART_NUMBER_SUGGESTIONS,
  QC_CPU95_PART_NUMBERS,
  qcCpu95Altmode,
  qcCpu95Label,
  qcCpu95Status,
  qcCpu95StatusSortKey,
  toQcCpu95Record,
} from "./qcCpu95Mapper";

function item(fields: Record<string, unknown>, id = "1"): GraphListItem {
  return {
    id,
    fields,
    createdDateTime: "2026-05-13T12:00:00Z",
    lastModifiedDateTime: "2026-05-14T12:00:00Z",
  } as unknown as GraphListItem;
}

describe("qcCpu95Altmode", () => {
  it("matches every part number from the legacy Power Apps Switch()", () => {
    expect(qcCpu95Altmode("791950-08")).toBe(1);
    expect(qcCpu95Altmode("791950-16")).toBe(2);
    expect(qcCpu95Altmode("791950-20")).toBe(3);
    expect(qcCpu95Altmode("791962-20")).toBe(3);
    expect(qcCpu95Altmode("791950-18")).toBe(4);
    expect(qcCpu95Altmode("791952-18")).toBe(5);
    expect(qcCpu95Altmode("791962-18")).toBe(6);
  });

  it("falls back to 0 for anything else, including blank", () => {
    expect(qcCpu95Altmode("")).toBe(0);
    expect(qcCpu95Altmode("some-unknown-part")).toBe(0);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(qcCpu95Altmode("  791950-16  ")).toBe(2);
  });

  // Confirmed against real data (Tim, 2026-09-17): some older rows spell the
  // -08 variant without the leading zero.
  it("treats a bare single-digit suffix as equivalent to its zero-padded spelling", () => {
    expect(qcCpu95Altmode("791950-8")).toBe(1);
    expect(qcCpu95Altmode("791950-08")).toBe(1);
  });

  it("does not zero-pad a suffix that's already two digits", () => {
    expect(qcCpu95Altmode("791950-16")).toBe(2);
  });
});

describe("QC_CPU95_PART_NUMBERS", () => {
  it("is exactly the 7 part numbers with a known Altmode, in table order", () => {
    expect(QC_CPU95_PART_NUMBERS).toEqual([
      "791950-08",
      "791950-16",
      "791950-20",
      "791962-20",
      "791950-18",
      "791952-18",
      "791962-18",
    ]);
  });
});

describe("QC_CPU95_PART_NUMBER_SUGGESTIONS", () => {
  it("includes every canonical part number", () => {
    for (const pn of QC_CPU95_PART_NUMBERS) {
      expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).toContain(pn);
    }
  });

  // "791950-08" is the only canonical spelling with a zero-padded
  // single-digit suffix, so it's the only one with an unpadded alias.
  it("adds '791950-8' as its own suggestion alongside '791950-08'", () => {
    expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).toContain("791950-8");
    expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).toContain("791950-08");
  });

  it("adds no alias for a part number that's already two digits", () => {
    expect(QC_CPU95_PART_NUMBER_SUGGESTIONS).not.toContain("791950-6");
    expect(QC_CPU95_PART_NUMBER_SUGGESTIONS.filter((pn) => pn === "791950-16")).toHaveLength(1);
  });
});

describe("toQcCpu95Record", () => {
  it("reads the serial number out of Title", () => {
    const record = toQcCpu95Record(item({ Title: "25564", AltronicPartNumber: "791950-16" }));
    expect(record.values.serialNumber).toBe("25564");
    expect(record.values.altronicPartNumber).toBe("791950-16");
  });

  it("maps a checked boolean column to the 'Yes' convention", () => {
    const record = toQcCpu95Record(item({ InRepair: true }));
    expect(record.values.inRepair).toBe("Yes");
  });

  it("maps an unchecked / missing boolean column to an empty string", () => {
    const record = toQcCpu95Record(item({ InRepair: false }));
    expect(record.values.inRepair).toBe("");
    const sparse = toQcCpu95Record(item({}));
    expect(sparse.values.inRepair).toBe("");
  });

  it("reads a date-only column into the yyyy-mm-dd form DateField expects", () => {
    const record = toQcCpu95Record(item({ DateTested: "2026-05-13T12:00:00Z" }));
    expect(record.values.dateTested).toBe("2026-05-13");
  });

  it("leaves a blank column as an empty string, never 'null' or 'undefined'", () => {
    const record = toQcCpu95Record(item({}));
    expect(record.values.testRpm).toBe("");
    expect(record.values.comments).toBe("");
  });

  it("carries a plain number/text column through as a string", () => {
    const record = toQcCpu95Record(item({ TestRPM: "1200" }));
    expect(record.values.testRpm).toBe("1200");
  });

  it("parses the numeric item id and the Graph-level created/modified stamps", () => {
    const record = toQcCpu95Record(item({}, "42"));
    expect(record.id).toBe(42);
    expect(record.createdAt.toISOString()).toBe("2026-05-13T12:00:00.000Z");
    expect(record.modifiedAt.toISOString()).toBe("2026-05-14T12:00:00.000Z");
  });
});

describe("buildQcCpu95Fields", () => {
  it("round-trips a record's values back into the same internal column shape", () => {
    const original = toQcCpu95Record(
      item({
        Title: "25564",
        AltronicPartNumber: "791950-16",
        InRepair: true,
        DateTested: "2026-05-13T12:00:00Z",
        TestRPM: "1200",
      }),
    );
    const fields = buildQcCpu95Fields(original.values);
    expect(fields.Title).toBe("25564");
    expect(fields.AltronicPartNumber).toBe("791950-16");
    expect(fields.InRepair).toBe(true);
    expect(fields.DateTested).toBe("2026-05-13T12:00:00Z");
    expect(fields.TestRPM).toBe("1200");
  });

  it("writes a boolean column as a real boolean, not the string 'Yes'", () => {
    const fields = buildQcCpu95Fields({ inRepair: "Yes" });
    expect(fields.InRepair).toBe(true);
  });

  it("writes an empty boolean as false, not blank", () => {
    const fields = buildQcCpu95Fields({ inRepair: "" });
    expect(fields.InRepair).toBe(false);
  });

  it("writes a blank number column as null, not an empty string", () => {
    const fields = buildQcCpu95Fields({ testCurrentLoop: "" });
    expect(fields.TestCurrentLoop).toBeNull();
  });

  it("writes a blank date column as null", () => {
    const fields = buildQcCpu95Fields({ dateTested: "" });
    expect(fields.DateTested).toBeNull();
  });

  it("defaults every missing key to a blank write rather than throwing", () => {
    expect(() => buildQcCpu95Fields({})).not.toThrow();
  });
});

function labelFixture(id: number, serialNumber: string, altronicPartNumber: string): QcCpu95Record {
  return {
    id,
    values: { serialNumber, altronicPartNumber },
    createdAt: new Date(),
    modifiedAt: new Date(),
  };
}

describe("qcCpu95Label", () => {
  it("prefers 'serial — part number' when both are present", () => {
    expect(qcCpu95Label(labelFixture(1, "25564", "791950-16"))).toBe("25564 — 791950-16");
  });

  it("falls back to the serial number alone", () => {
    expect(qcCpu95Label(labelFixture(1, "25564", ""))).toBe("25564");
  });

  it("falls back to the part number alone", () => {
    expect(qcCpu95Label(labelFixture(1, "", "791950-16"))).toBe("791950-16");
  });

  it("falls back to a numbered placeholder when both are blank", () => {
    expect(qcCpu95Label(labelFixture(7, "", ""))).toBe("Test sheet #7");
  });
});

describe("compareQcCpu95Records", () => {
  function fixture(id: number, dateTested: string, daysAgo: number): QcCpu95Record {
    return {
      id,
      values: { dateTested },
      createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      modifiedAt: new Date(),
    };
  }

  it("sorts newest Date Tested first", () => {
    const records = [fixture(1, "2026-05-01", 5), fixture(2, "2026-06-01", 5)];
    expect([...records].sort(compareQcCpu95Records).map((r) => r.id)).toEqual([2, 1]);
  });

  it("falls back to createdAt when Date Tested is blank", () => {
    const older = { ...fixture(1, "", 10) };
    const newer = { ...fixture(2, "", 1) };
    expect([older, newer].sort(compareQcCpu95Records).map((r) => r.id)).toEqual([2, 1]);
  });
});

function statusFixture(overrides: Record<string, string>): QcCpu95Record {
  return { id: 1, values: overrides, createdAt: new Date(), modifiedAt: new Date() };
}

describe("qcCpu95Status", () => {
  it("is 'new' with nothing filled in", () => {
    expect(qcCpu95Status(statusFixture({}))).toBe("new");
  });

  it("is 'repair' once In Repair is checked", () => {
    expect(qcCpu95Status(statusFixture({ inRepair: "Yes" }))).toBe("repair");
  });

  it("is 'complete' once Final Inspection By and Date are both set", () => {
    expect(
      qcCpu95Status(
        statusFixture({ finalInspectionBy: "JN", finalInspectionDate: "2026-05-13" }),
      ),
    ).toBe("complete");
  });

  it("is not 'complete' with only one of Final Inspection By / Date set", () => {
    expect(qcCpu95Status(statusFixture({ finalInspectionBy: "JN" }))).toBe("new");
    expect(qcCpu95Status(statusFixture({ finalInspectionDate: "2026-05-13" }))).toBe("new");
  });

  it("prefers 'complete' over 'repair' — a unit fixed and signed off is done, not still flagged", () => {
    expect(
      qcCpu95Status(
        statusFixture({
          inRepair: "Yes",
          finalInspectionBy: "JN",
          finalInspectionDate: "2026-05-13",
        }),
      ),
    ).toBe("complete");
  });

  // Barcode-scanned in (Serial Number + Altronic Part Number) but nothing
  // from the actual test yet — Tim, 2026-09-17.
  it("is 'queued' when only Serial Number and Altronic Part Number are filled in", () => {
    expect(
      qcCpu95Status(
        statusFixture({ serialNumber: "26305", altronicPartNumber: "791950-18" }),
      ),
    ).toBe("queued");
  });

  it("is NOT 'queued' with only one of the two identifying fields set", () => {
    expect(qcCpu95Status(statusFixture({ serialNumber: "26305" }))).toBe("new");
    expect(qcCpu95Status(statusFixture({ altronicPartNumber: "791950-18" }))).toBe("new");
  });

  it("is NOT 'queued' once any other field has a value", () => {
    expect(
      qcCpu95Status(
        statusFixture({
          serialNumber: "26305",
          altronicPartNumber: "791950-18",
          testRpm: "1200",
        }),
      ),
    ).toBe("new");
  });

  it("prefers 'repair' over 'queued' — a unit flagged for repair is never just queued", () => {
    expect(
      qcCpu95Status(
        statusFixture({
          serialNumber: "26305",
          altronicPartNumber: "791950-18",
          inRepair: "Yes",
        }),
      ),
    ).toBe("repair");
  });
});

describe("qcCpu95StatusSortKey", () => {
  // A genuinely 'queued' record can never carry a Date Tested — filling one
  // in is exactly what disqualifies it from 'queued' (see qcCpu95Status
  // above) — so these fixtures deliberately have none, unlike the other
  // statuses tested below. An earlier version of this pair gave the queued
  // fixture a dateTested anyway, which silently made its real status 'new'
  // rather than 'queued' and passed for the wrong reason.
  it("ranks every 'new' record below every 'queued' record, whatever their dates", () => {
    const newest = statusFixture({ dateTested: "2026-12-31" });
    const queued = statusFixture({ serialNumber: "26305", altronicPartNumber: "791950-18" });
    expect(qcCpu95Status(queued)).toBe("queued");
    expect(qcCpu95StatusSortKey(newest)).toBeLessThan(qcCpu95StatusSortKey(queued));
  });

  it("ranks every 'queued' record below every 'repair' record, whatever their dates", () => {
    const queued = statusFixture({ serialNumber: "26305", altronicPartNumber: "791950-18" });
    const oldestRepair = statusFixture({ dateTested: "2020-01-01", inRepair: "Yes" });
    expect(qcCpu95Status(queued)).toBe("queued");
    expect(qcCpu95StatusSortKey(queued)).toBeLessThan(qcCpu95StatusSortKey(oldestRepair));
  });

  it("ranks every 'repair' record below every 'complete' record, whatever their dates", () => {
    const newestRepair = statusFixture({ dateTested: "2026-12-31", inRepair: "Yes" });
    const oldestComplete = statusFixture({
      dateTested: "2020-01-01",
      finalInspectionBy: "JN",
      finalInspectionDate: "2020-01-02",
    });
    expect(qcCpu95StatusSortKey(newestRepair)).toBeLessThan(qcCpu95StatusSortKey(oldestComplete));
  });

  it("within the same status, ranks the newer Date Tested lower (sorts first, ascending)", () => {
    const older = statusFixture({ dateTested: "2026-01-01" });
    const newer = statusFixture({ dateTested: "2026-06-01" });
    expect(qcCpu95StatusSortKey(newer)).toBeLessThan(qcCpu95StatusSortKey(older));
  });
});
