import { describe, expect, it } from "vitest";
import { comparePanelQcIssues } from "./PanelQcIssuesView";
import type { PanelQcIssue } from "@/types/task";

const issue = (id: number, date: Date | null): PanelQcIssue => ({
  id, date, panelSerialNumber: "", partNumber: "", partDescription: "", serialReferenceNote: "",
  defectCategory: null, comments: "", correctiveAction: "", productionTechnician: "",
  productionRepairNotes: "", productionResolution: "",
});

describe("Panel QC issue sorting", () => {
  it("puts empty dates after dated issues in both directions", () => {
    const undated = issue(1, null);
    const dated = issue(2, new Date("2026-09-02T12:00:00Z"));
    expect(comparePanelQcIssues(dated, undated, "date", "desc")).toBeLessThan(0);
    expect(comparePanelQcIssues(undated, dated, "date", "asc")).toBeGreaterThan(0);
  });

  it("sorts text fields according to the selected direction", () => {
    const alpha = { ...issue(1, null), partNumber: "100" };
    const beta = { ...issue(2, null), partNumber: "200" };
    expect(comparePanelQcIssues(alpha, beta, "partNumber", "asc")).toBeLessThan(0);
    expect(comparePanelQcIssues(alpha, beta, "partNumber", "desc")).toBeGreaterThan(0);
  });
});