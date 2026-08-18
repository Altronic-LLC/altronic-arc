import { describe, it, expect } from "vitest";
import type { GraphListItem, VisitReport } from "@/types/task";
import {
  buildVisitReportFields,
  compareVisitReports,
  rmNameOptions,
  toVisitReport,
  visitYear,
  visitReportInput,
  visitYearOptions,
  VISIT_REPORT_SELECT,
} from "./visitReportMapper";

// Field names and shapes come from the live list —
// scripts/visit-reports-schema.json, captured 2026-08-18.

function item(fields: Record<string, unknown>, id = "1"): GraphListItem {
  return { id, fields } as unknown as GraphListItem;
}

const REAL_ROW = item({
  Title: "CSI Compressco",
  RMName: "Neal Keeton",
  ReasonForVisit: "General Visit",
  VisitSummary: "This is a test for the new RM visit report.",
  ActionItems: "Dave Bell to provide pricing.",
  // Rows written before ARC sit at 22:00Z, not midday.
  VisitDate: "2022-08-15T22:00:00Z",
  CustomerStatus: "Satisfied",
  Product: "DE-4000",
  City0: "Midland",
  State0: "Texas",
  Attachments: false,
  Created: "2022-08-22T20:07:26Z",
  Modified: "2022-08-23T19:06:24Z",
});

describe("toVisitReport", () => {
  it("reads Customer Name out of the Title column", () => {
    // The list repurposes Title — there is no "title" in the domain type.
    expect(toVisitReport(REAL_ROW).customerName).toBe("CSI Compressco");
  });

  it("reads City and State from City0 / State0", () => {
    // The trailing zero is real: a City/State column existed before.
    const report = toVisitReport(REAL_ROW);
    expect(report.city).toBe("Midland");
    expect(report.state).toBe("Texas");
  });

  it("maps the rest of the fields", () => {
    const report = toVisitReport(REAL_ROW);
    expect(report).toMatchObject({
      id: 1,
      rmName: "Neal Keeton",
      reasonForVisit: "General Visit",
      customerStatus: "Satisfied",
      product: "DE-4000",
      hasAttachments: false,
    });
    expect(report.visitSummary).toContain("RM visit report");
    expect(report.actionItems).toBe("Dave Bell to provide pricing.");
  });

  it("keeps the visit on the day the SharePoint LIST VIEW shows", () => {
    // This row stores 2022-08-15T22:00:00Z — midnight on the 16th in a site
    // two hours ahead of UTC, which is what the list view displays.
    //
    // Its calculated Day column reads "15", because SharePoint computes
    // calculated columns in UTC. They disagree with the date users see, so
    // they are NOT the thing to check against — that mistake is what shipped
    // every visit a day early (Ray, 2026-08-18).
    const report = toVisitReport(REAL_ROW);
    expect(report.visitDate?.getUTCFullYear()).toBe(2022);
    expect(report.visitDate?.getUTCMonth()).toBe(7); // August
    expect(report.visitDate?.getUTCDate()).toBe(16);
  });

  it("copes with the optional fields being absent", () => {
    const report = toVisitReport(item({ Title: "Sparse Co", VisitDate: null }));
    expect(report.actionItems).toBe("");
    expect(report.product).toBe("");
    expect(report.city).toBe("");
    expect(report.state).toBe("");
    expect(report.visitDate).toBeNull();
  });

  it("does not select the calculated columns", () => {
    // Month / Year / Day / Cal Title are read-only and derived; the app
    // computes what it needs from visitDate instead.
    for (const column of ["Month", "Year", "Day", "Cal_x0020_Title"]) {
      expect(VISIT_REPORT_SELECT).not.toContain(column);
    }
  });
});

describe("buildVisitReportFields", () => {
  const input = {
    customerName: "  AGES  ",
    rmName: "Wes Wagner",
    reasonForVisit: "Sales Call",
    visitSummary: "  Met the new ops manager.  ",
    actionItems: "  Send pricing.  ",
    visitDate: new Date("2026-08-04T12:00:00Z"),
    customerStatus: "Quote Request",
    product: "  CPU95  ",
    city: "  Oklahoma City  ",
    state: "Oklahoma",
  };

  it("writes the customer name to Title, trimmed", () => {
    expect(buildVisitReportFields(input).Title).toBe("AGES");
  });

  it("writes City0 / State0, not City / State", () => {
    const fields = buildVisitReportFields(input);
    expect(fields.City0).toBe("Oklahoma City");
    expect(fields.State0).toBe("Oklahoma");
    expect(fields).not.toHaveProperty("City");
    expect(fields).not.toHaveProperty("State");
  });

  it("writes the visit date at midday UTC so the day can't shift", () => {
    expect(buildVisitReportFields(input).VisitDate).toBe("2026-08-04T12:00:00Z");
  });

  // Writing a calculated column is a 400.
  it("never writes the calculated columns", () => {
    const fields = buildVisitReportFields(input);
    for (const column of ["Month", "Year", "Day", "Cal_x0020_Title"]) {
      expect(fields).not.toHaveProperty(column);
    }
  });

  it("sends a null visit date rather than an invalid one", () => {
    expect(buildVisitReportFields({ ...input, visitDate: null }).VisitDate).toBeNull();
  });
});

describe("ordering and options", () => {
  const reports = [
    { id: 1, visitDate: new Date("2026-01-05T12:00:00Z"), rmName: "Curtis Ward" },
    { id: 2, visitDate: new Date("2026-08-11T12:00:00Z"), rmName: "Neal Keeton" },
    { id: 3, visitDate: null, rmName: "" },
    { id: 4, visitDate: new Date("2024-11-06T12:00:00Z"), rmName: "curtis ward" },
  ] as VisitReport[];

  it("sorts newest visit first, undated last", () => {
    expect([...reports].sort(compareVisitReports).map((r) => r.id)).toEqual([2, 1, 4, 3]);
  });

  it("offers the column's managers PLUS anyone the data holds", () => {
    // Reports go back years; managers leave. Offering only the current choices
    // would make an old report un-editable without reassigning it.
    const options = rmNameOptions(reports);
    expect(options).toContain("Neal Keeton"); // in the data, not in the choices
    expect(options).toContain("Curtis Ward"); // in both
    expect(options).toContain("Gregg Grubbs"); // in the choices, not the data
  });

  it("does not list the same manager twice for a difference in casing", () => {
    // "Paul McHenry" and "Paul Mchenry" both exist in the real list.
    const options = rmNameOptions(reports);
    expect(options.filter((o) => o.toLowerCase() === "curtis ward")).toHaveLength(1);
  });

  it("lists the years present, newest first", () => {
    expect(visitYearOptions(reports)).toEqual(["2026", "2024"]);
  });

  it("reads a visit's year in UTC terms", () => {
    expect(visitYear(reports[1])).toBe("2026");
    expect(visitYear(reports[2])).toBe("");
  });
});

describe("legacy dates — the day the SharePoint list view shows", () => {
  // Every row on the live list stores its date-only value at 22:00Z, i.e.
  // midnight in a site two hours ahead of UTC. Reading the UTC date showed the
  // day BEFORE the one the list view shows: "the app says June 21, the list
  // says June 22" (Ray, 2026-08-18).
  it("reads a 22:00Z row as the NEXT day", () => {
    const report = toVisitReport(item({ Title: "x", VisitDate: "2026-06-21T22:00:00Z" }));
    expect(report.visitDate?.getUTCDate()).toBe(22);
    expect(report.visitDate?.getUTCMonth()).toBe(5); // June
  });

  it("rolls the month and the year over with it", () => {
    const newYear = toVisitReport(item({ Title: "x", VisitDate: "2025-12-31T22:00:00Z" }));
    expect(newYear.visitDate?.getUTCFullYear()).toBe(2026);
    expect(visitYear(newYear)).toBe("2026");
  });

  it("leaves a row this app wrote (midday UTC) on its own day", () => {
    const report = toVisitReport(item({ Title: "x", VisitDate: "2026-06-22T12:00:00Z" }));
    expect(report.visitDate?.getUTCDate()).toBe(22);
  });

  it("leaves a morning value alone, for a site behind UTC", () => {
    const report = toVisitReport(item({ Title: "x", VisitDate: "2026-06-22T05:00:00Z" }));
    expect(report.visitDate?.getUTCDate()).toBe(22);
  });

  it("round-trips: read a legacy row, save it back, read the same day", () => {
    const report = toVisitReport(item({ Title: "x", VisitDate: "2026-06-21T22:00:00Z" }));
    const written = buildVisitReportFields({
      ...visitReportInput(report),
    }).VisitDate as string;
    expect(written).toBe("2026-06-22T12:00:00Z");
    const reread = toVisitReport(item({ Title: "x", VisitDate: written }));
    expect(reread.visitDate?.getUTCDate()).toBe(22);
  });
});

describe("editing only sends what changed", () => {
  const stored = toVisitReport(
    item({
      Title: "AGES",
      // A manager who has left — no longer one of the column's choices.
      RMName: "Neal Keeton",
      ReasonForVisit: "Site Visit",
      VisitSummary: "Original summary.",
      ActionItems: "",
      VisitDate: "2022-08-15T22:00:00Z",
      CustomerStatus: "Satisfied",
      Product: "DE-4000",
      City0: "Midland",
      State0: "Texas",
    }),
  );

  it("sends nothing when nothing was touched", () => {
    expect(buildVisitReportFields(visitReportInput(stored), stored)).toEqual({});
  });

  // Re-sending "Neal Keeton" to a choice column that no longer offers him is
  // rejected outright, which would fail an edit for a reason unrelated to what
  // the user changed.
  it("does not re-send a choice value that is no longer a valid choice", () => {
    const fields = buildVisitReportFields(
      { ...visitReportInput(stored), visitSummary: "Corrected a typo." },
      stored,
    );
    expect(fields).toEqual({ VisitSummary: "Corrected a typo." });
    expect(fields).not.toHaveProperty("RMName");
  });

  it("does send a choice the user actually changed", () => {
    const fields = buildVisitReportFields(
      { ...visitReportInput(stored), customerStatus: "Issue" },
      stored,
    );
    expect(fields).toEqual({ CustomerStatus: "Issue" });
  });

  it("sends every field on a create, where there is nothing to diff against", () => {
    const fields = buildVisitReportFields(visitReportInput(stored));
    expect(Object.keys(fields).sort()).toEqual([
      "ActionItems",
      "City0",
      "CustomerStatus",
      "Product",
      "RMName",
      "ReasonForVisit",
      "State0",
      "Title",
      "VisitDate",
      "VisitSummary",
    ]);
  });
});
