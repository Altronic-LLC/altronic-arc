import { describe, expect, it } from "vitest";
import { comparePanelQcIssues } from "./PanelQcIssuesView";
import type { PanelQcIssue } from "@/types/task";
import { nextPanelQcTag } from "@/lib/panelQcNumber";
import { truncateLabelDescription } from "./PrintPanelQcIssueView";

const issue = (id: number, date: Date | null): PanelQcIssue => ({
  id, date, panelSerialNumber: "", partNumber: "", partDescription: "", serialReferenceNote: "",
  defectCategory: null, comments: "", correctiveAction: "", productionTechnician: "",
  productionRepairNotes: "", productionResolution: "", communication: "", watchers: [], tagNumber: "",
});

describe("Panel QC issue sorting", () => {
  it("supports newest TAG Number first with blank tags last", () => {
    const older = issue(1, null);
    older.tagNumber = "P-2026-0024";
    const newest = issue(2, null);
    newest.tagNumber = "P-2026-0025";
    const undated = issue(3, null);
    expect([newest, older, undated].sort((left, right) => comparePanelQcIssues(left, right, "tagNumber", "desc"))).toEqual([newest, older, undated]);
  });

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

describe("Panel QC tag numbering", () => {
  it("increments the highest tag for the current year and ignores other years", () => {
    const issues = [issue(1, null), issue(2, null), issue(3, null)];
    issues[0].tagNumber = "P-2026-0024";
    issues[1].tagNumber = "P-2026-0007";
    issues[2].tagNumber = "P-2025-9999";
    expect(nextPanelQcTag(issues, new Date("2026-09-03T12:00:00"))).toBe("P-2026-0025");
  });
});

describe("Panel QC label printing", () => {
  it("truncates descriptions to fit the label", () => {
    const description = "A".repeat(120);
    const truncated = truncateLabelDescription(description);
    expect(truncated).toHaveLength(105);
    expect(truncated.endsWith("…")).toBe(true);
  });
});