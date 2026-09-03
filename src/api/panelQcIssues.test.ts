import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  USE_MOCK: true,
  SITES: { engineering: "test-engineering-site" },
  SP_PANEL_QC_ISSUES_LIST_ID: "issues",
  SP_PANEL_QC_DEFECTS_LIST_ID: "defects",
}));
import {
  createPanelQcDefect,
  createPanelQcIssue,
  listPanelQcDefects,
  listPanelQcIssues,
} from "@/api/panelQcIssues";

describe("Panel QC Issue Tracker", () => {
  it("loads the exported issue shape and defect categories", async () => {
    const [issues, defects] = await Promise.all([listPanelQcIssues(), listPanelQcDefects()]);

    expect(issues[0]).toMatchObject({
      panelSerialNumber: "20442272-300",
      defectCategory: "LED / Fuse Indicator Failure",
    });
    expect(defects.map((defect) => defect.name)).toContain("Other / Miscellaneous");
  });

  it("adds a defect category and an issue in mock mode", async () => {
    const category = await createPanelQcDefect("Fixture Failure");
    const issue = await createPanelQcIssue({
      panelSerialNumber: "TEST-001",
      date: null,
      partNumber: "",
      partDescription: "",
      serialReferenceNote: "",
      defectCategory: category.name,
      comments: "",
      correctiveAction: "",
      productionTechnician: "",
      productionRepairNotes: "",
      productionResolution: "",
      communication: "",
      watchers: [],
      tagNumber: "",
    });

    expect(issue).toMatchObject({ panelSerialNumber: "TEST-001", defectCategory: "Fixture Failure" });
    expect(issue.tagNumber).toMatch(/^P-\d{4}-\d{4}$/);
    expect((await listPanelQcDefects()).some((defect) => defect.name === "Fixture Failure")).toBe(true);
    expect((await listPanelQcIssues()).some((entry) => entry.id === issue.id)).toBe(true);
  });
});