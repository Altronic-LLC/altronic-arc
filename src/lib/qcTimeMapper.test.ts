import { describe, it, expect } from "vitest";
import type { GraphListItem, QcTimeEntry } from "@/types/task";
import {
  QC_TIME_SELECT,
  buildQcTimeFields,
  compareQcTimeEntries,
  qcTimeEntryInput,
  toQcTimeEntry,
} from "./qcTimeMapper";

function item(fields: Record<string, unknown>, id = "1"): GraphListItem {
  return { id, fields } as unknown as GraphListItem;
}

const REAL_ROW = item({
  Title: "DE-4000 Refresh",
  Week: 35,
  DateintoQC: "2026-08-24T12:00:00Z",
  DateStarted: "2026-08-25T12:00:00Z",
  SAPNo: "SAP-40021",
  SerialNo: "SN-88213",
  PerformedByPeople: [
    { LookupId: 61, LookupValue: "Kim Tech", Email: "kim.tech@altronic-llc.com" },
  ],
  PerformedByRaw: "Kim Tech",
  HoursRaw: "6.5",
  EffortType: "New Panel",
  Notes: "First article — extra time on wiring checks.",
  Created: "2026-08-25T13:00:00Z",
  Modified: "2026-08-25T14:00:00Z",
});

describe("toQcTimeEntry", () => {
  it("reads Project out of the Title column", () => {
    expect(toQcTimeEntry(REAL_ROW).project).toBe("DE-4000 Refresh");
  });

  it("maps the rest of the fields", () => {
    const entry = toQcTimeEntry(REAL_ROW);
    expect(entry).toMatchObject({
      id: 1,
      week: 35,
      sapNo: "SAP-40021",
      serialNo: "SN-88213",
      performedByRaw: "Kim Tech",
      hoursRaw: "6.5",
      effortType: "New Panel",
    });
    expect(entry.notes).toContain("wiring checks");
  });

  it("resolves the multi-person PerformedByPeople column", () => {
    const entry = toQcTimeEntry(REAL_ROW);
    expect(entry.performedBy).toEqual([
      expect.objectContaining({ displayName: "Kim Tech", lookupId: 61 }),
    ]);
  });

  it("handles a combo row — two people in one multi-person column", () => {
    const combo = item({
      Title: "CPU-XL Standard",
      PerformedByPeople: [
        { LookupId: 24, LookupValue: "David Bulkley", Email: "david.bulkley@altronic-llc.com" },
        { LookupId: 46, LookupValue: "Sarah Shaffer", Email: "sarah.shaffer@altronic-llc.com" },
      ],
    });
    expect(toQcTimeEntry(combo).performedBy).toHaveLength(2);
  });

  it("copes with the sparse rows real data actually has", () => {
    // Week, both dates and Hours are all blank on plenty of real rows.
    const sparse = toQcTimeEntry(item({ Title: "Field Return Rework" }));
    expect(sparse.week).toBeNull();
    expect(sparse.dateIntoQc).toBeNull();
    expect(sparse.dateStarted).toBeNull();
    expect(sparse.hoursRaw).toBe("");
    expect(sparse.performedBy).toEqual([]);
    expect(sparse.effortType).toBeNull();
  });

  it("keeps a non-numeric Hours value as-is, rather than dropping it", () => {
    const entry = toQcTimeEntry(item({ Title: "x", HoursRaw: "see notes" }));
    expect(entry.hoursRaw).toBe("see notes");
  });

  it("renders an unrecognised EffortType as itself rather than blank", () => {
    // The column allows fill-in values; a future choice ARC hasn't heard of
    // should still show, not vanish.
    const entry = toQcTimeEntry(item({ Title: "x", EffortType: "Warranty Rework" }));
    expect(entry.effortType).toBe("Warranty Rework");
  });

  it("does not select any column outside the known set", () => {
    for (const column of ["ID", "Attachments", "ContentType"]) {
      expect(QC_TIME_SELECT).not.toContain(column);
    }
  });
});

describe("buildQcTimeFields", () => {
  const input = {
    project: "  DE-4000 Refresh  ",
    week: 35,
    dateIntoQc: new Date("2026-08-24T12:00:00Z"),
    dateStarted: new Date("2026-08-25T12:00:00Z"),
    sapNo: "  SAP-40021  ",
    serialNo: "  SN-88213  ",
    performedBy: [],
    hoursRaw: "  6.5  ",
    effortType: "New Panel" as const,
    notes: "  Some notes.  ",
  };
  const KIM = { displayName: "Kim Tech", email: "kim.tech@altronic-llc.com", lookupId: 61 };

  it("writes the project to Title, trimmed", () => {
    expect(buildQcTimeFields(input, []).Title).toBe("DE-4000 Refresh");
  });

  it("trims text fields", () => {
    const fields = buildQcTimeFields(input, []);
    expect(fields.SAPNo).toBe("SAP-40021");
    expect(fields.SerialNo).toBe("SN-88213");
    expect(fields.HoursRaw).toBe("6.5");
    expect(fields.Notes).toBe("Some notes.");
  });

  it("writes dates at midday UTC", () => {
    const fields = buildQcTimeFields(input, []);
    expect(fields.DateintoQC).toBe("2026-08-24T12:00:00Z");
    expect(fields.DateStarted).toBe("2026-08-25T12:00:00Z");
  });

  it("writes PerformedByPeople as the two-key multi-person shape", () => {
    const fields = buildQcTimeFields(input, [KIM]);
    expect(fields["PerformedByPeopleLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    expect(fields.PerformedByPeopleLookupId).toEqual([61]);
  });

  it("drops a person with no lookupId from the write, rather than failing the whole save", () => {
    const unresolved = { displayName: "Nobody Found", email: "ghost@example.com" };
    const fields = buildQcTimeFields(input, [KIM, unresolved]);
    expect(fields.PerformedByPeopleLookupId).toEqual([61]);
  });

  it("sends a null date rather than an invalid one", () => {
    const fields = buildQcTimeFields({ ...input, dateIntoQc: null }, []);
    expect(fields.DateintoQC).toBeNull();
  });

  it("sends week as null, not zero, when unset", () => {
    const fields = buildQcTimeFields({ ...input, week: null }, []);
    expect(fields.Week).toBeNull();
  });
});

describe("qcTimeEntryInput", () => {
  it("round-trips a stored entry into form input", () => {
    const entry = toQcTimeEntry(REAL_ROW);
    const input = qcTimeEntryInput(entry);
    expect(input.project).toBe(entry.project);
    expect(input.performedBy).toBe(entry.performedBy);
    // performedByRaw is deliberately NOT part of the editable input — it's a
    // read-only backup of the original import text.
    expect(input).not.toHaveProperty("performedByRaw");
  });
});

describe("compareQcTimeEntries", () => {
  const entries = [
    { id: 1, week: 34, dateStarted: new Date("2026-08-18T12:00:00Z") },
    { id: 2, week: 35, dateStarted: new Date("2026-08-25T12:00:00Z") },
    { id: 3, week: null, dateStarted: null },
    { id: 4, week: 35, dateStarted: new Date("2026-08-26T12:00:00Z") },
  ] as QcTimeEntry[];

  it("sorts newest week first, then newest Date Started within a week, undated last", () => {
    expect([...entries].sort(compareQcTimeEntries).map((e) => e.id)).toEqual([4, 2, 1, 3]);
  });
});
