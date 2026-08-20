import { describe, it, expect } from "vitest";
import type { VisitReport } from "@/types/task";
import {
  applyVisitReportFilters,
  EMPTY_VISIT_REPORT_FILTERS,
  groupVisitsByDay,
  hasVisitReportFilters,
  visitDayKey,
} from "./visitReportFilters";
import { visitReportFilterSearch } from "@/hooks/useVisitReportFilters";

const reports = [
  {
    id: 1,
    customerName: "CSI Compressco",
    rmName: "Curtis Ward",
    reasonForVisit: "Site Visit",
    customerStatus: "Satisfied",
    product: "DE-4000",
    visitSummary: "",
    actionItems: "",
    city: "",
    state: "",
    visitDate: new Date("2026-08-11T12:00:00Z"),
  },
  {
    id: 2,
    customerName: "AGES",
    rmName: "Wes Wagner",
    reasonForVisit: "Sales Call",
    customerStatus: "Quote Request",
    product: "CPU95",
    visitSummary: "",
    actionItems: "",
    city: "",
    state: "",
    visitDate: new Date("2026-08-11T12:00:00Z"),
  },
  {
    id: 3,
    customerName: "Bluestem",
    rmName: "Curtis Ward",
    reasonForVisit: "Training",
    customerStatus: "Issue",
    product: "",
    visitSummary: "",
    actionItems: "",
    city: "",
    state: "",
    visitDate: null,
  },
] as VisitReport[];

const filters = (over: Partial<typeof EMPTY_VISIT_REPORT_FILTERS>) => ({
  ...EMPTY_VISIT_REPORT_FILTERS,
  ...over,
});

describe("applyVisitReportFilters", () => {
  it("returns everything when nothing is set", () => {
    expect(applyVisitReportFilters(reports, EMPTY_VISIT_REPORT_FILTERS)).toHaveLength(3);
  });

  it("filters by manager, reason and status", () => {
    expect(applyVisitReportFilters(reports, filters({ rm: "Curtis Ward" }))).toHaveLength(2);
    expect(applyVisitReportFilters(reports, filters({ reason: "Training" }))).toHaveLength(1);
    expect(applyVisitReportFilters(reports, filters({ status: "Issue" }))).toHaveLength(1);
  });

  it("filters by the visit's year", () => {
    expect(applyVisitReportFilters(reports, filters({ year: "2026" }))).toHaveLength(2);
    expect(applyVisitReportFilters(reports, filters({ year: "2024" }))).toHaveLength(0);
  });

  it("searches every field, not just the customer", () => {
    expect(applyVisitReportFilters(reports, filters({ q: "CPU95" }))).toHaveLength(1);
  });

  it("combines filters", () => {
    const out = applyVisitReportFilters(reports, filters({ rm: "Curtis Ward", status: "Issue" }));
    expect(out.map((r) => r.id)).toEqual([3]);
  });
});

describe("hasVisitReportFilters", () => {
  it("is false only when every filter is blank", () => {
    expect(hasVisitReportFilters(EMPTY_VISIT_REPORT_FILTERS)).toBe(false);
    expect(hasVisitReportFilters(filters({ q: "x" }))).toBe(true);
  });
});

describe("grouping for the calendar", () => {
  it("keys a day in UTC terms", () => {
    // Local getters would slide a visit into the previous day for everyone
    // west of Greenwich — which is the whole department.
    expect(visitDayKey(new Date("2026-08-11T12:00:00Z"))).toBe("2026-08-11");
  });

  it("puts every visit on its day", () => {
    const byDay = groupVisitsByDay(reports);
    expect(byDay.get("2026-08-11")?.map((r) => r.id)).toEqual([1, 2]);
  });

  it("drops the undated ones rather than inventing a day for them", () => {
    const byDay = groupVisitsByDay(reports);
    expect([...byDay.values()].flat().map((r) => r.id)).not.toContain(3);
  });
});

describe("visitReportFilterSearch", () => {
  // Switching views has to keep the filters — linking to a bare path is what
  // silently reset them on the task List/Kanban pair.
  it("carries every filter across", () => {
    const out = visitReportFilterSearch("?q=coil&rm=Wes+Wagner&year=2026&reason=Training&status=Issue");
    const params = new URLSearchParams(out);
    expect(params.get("q")).toBe("coil");
    expect(params.get("rm")).toBe("Wes Wagner");
    expect(params.get("year")).toBe("2026");
    expect(params.get("reason")).toBe("Training");
    expect(params.get("status")).toBe("Issue");
  });

  it("leaves the calendar's month behind — it means nothing to the list", () => {
    expect(visitReportFilterSearch("?month=2026-08&rm=Wes+Wagner")).toBe("?rm=Wes+Wagner");
  });

  it("is empty when nothing is filtered", () => {
    expect(visitReportFilterSearch("")).toBe("");
    expect(visitReportFilterSearch("?month=2026-08")).toBe("");
  });
});
