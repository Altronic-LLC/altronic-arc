import { describe, it, expect } from "vitest";
import * as visitReportsApi from "./visitReports";
import {
  createVisitReport,
  getVisitReport,
  listVisitReports,
  updateVisitReport,
  updateVisitReportFields,
} from "./visitReports";
import type { VisitReportInput } from "@/types/task";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

const input: VisitReportInput = {
  customerName: "Test Customer",
  rmName: "Curtis Ward",
  reasonForVisit: "Site Visit",
  visitSummary: "Walked the yard.",
  actionItems: "Send the quote.",
  visitDate: new Date("2026-08-18T12:00:00Z"),
  customerStatus: "Satisfied",
  product: "DE-4000",
  city: "Midland",
  state: "Texas",
};

describe("visit reports API", () => {
  it("lists the reports newest visit first", async () => {
    const reports = await listVisitReports();
    expect(reports.length).toBeGreaterThan(0);
    const dates = reports.map((r) => r.visitDate?.getTime() ?? -Infinity);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("creates a report and reads it back", async () => {
    const created = await createVisitReport(input);
    expect(created.customerName).toBe("Test Customer");

    const found = await getVisitReport(created.id);
    expect(found?.rmName).toBe("Curtis Ward");
    expect(found?.city).toBe("Midland");
  });

  it("puts a new report at the top of the list when it's the newest visit", async () => {
    const created = await createVisitReport({
      ...input,
      customerName: "Newest Visit",
      visitDate: new Date("2030-01-01T12:00:00Z"),
    });
    const reports = await listVisitReports();
    expect(reports[0].id).toBe(created.id);
  });

  it("patches a single column", async () => {
    const created = await createVisitReport(input);
    const updated = await updateVisitReportFields(created.id, {
      CustomerStatus: "Issue",
    });
    expect(updated.customerStatus).toBe("Issue");
    // …and leaves the rest alone.
    expect(updated.customerName).toBe("Test Customer");
  });

  it("saves the whole form", async () => {
    const created = await createVisitReport(input);
    const updated = await updateVisitReport(created.id, {
      ...input,
      customerName: "Renamed Customer",
      city: "Odessa",
    });
    expect(updated.customerName).toBe("Renamed Customer");
    expect(updated.city).toBe("Odessa");
  });

  it("returns null for a report that isn't there", async () => {
    expect(await getVisitReport(999_999)).toBeNull();
  });

  it("rejects an update to a missing report", async () => {
    await expect(updateVisitReportFields(999_999, { Title: "x" })).rejects.toThrow();
  });

  // A visit report is a record of something that happened. Correcting one is
  // an edit; removing one is a deliberate trip to SharePoint. The absence is
  // the feature — a future screen can't quietly acquire a delete button.
  it("exposes no delete at all", () => {
    const exported = Object.keys(visitReportsApi);
    expect(exported.filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});
