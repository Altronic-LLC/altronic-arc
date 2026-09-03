import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  USE_MOCK: true,
  SITES: { engineering: "test-engineering-site" },
  SP_PANEL_QC_ISSUES_LIST_ID: "issues",
  SP_PANEL_QC_DEFECTS_LIST_ID: "defects",
}));
import {
  addPanelQcIssueComment,
  createPanelQcDefect,
  createPanelQcIssue,
  editPanelQcIssueComment,
  listPanelQcDefects,
  listPanelQcIssues,
  setPanelQcIssueWatchers,
  unwatchPanelQcIssue,
  updatePanelQcIssue,
  watchPanelQcIssue,
} from "@/api/panelQcIssues";
import type { PanelQcIssueInput } from "@/types/task";

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 36 };
const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 46 };

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
      notes: "",
      correctiveAction: "",
      productionTechnician: "",
      productionRepairNotes: "",
      productionResolution: "",
      watchers: [],
      tagNumber: "",
    });

    expect(issue).toMatchObject({ panelSerialNumber: "TEST-001", defectCategory: "Fixture Failure" });
    expect(issue.tagNumber).toMatch(/^P-\d{4}-\d{4}$/);
    expect((await listPanelQcDefects()).some((defect) => defect.name === "Fixture Failure")).toBe(true);
    expect((await listPanelQcIssues()).some((entry) => entry.id === issue.id)).toBe(true);
  });

  it("watch / unwatch round-trip and wholesale replace", async () => {
    const issue = await createPanelQcIssue({ ...blankInput, panelSerialNumber: "WATCH-1" });
    const watched = await watchPanelQcIssue(issue.id, SARAH);
    expect(watched.watchers.some((w) => w.lookupId === 46)).toBe(true);
    const again = await watchPanelQcIssue(issue.id, SARAH);
    expect(again.watchers.filter((w) => w.lookupId === 46)).toHaveLength(1);
    const unwatched = await unwatchPanelQcIssue(issue.id, SARAH);
    expect(unwatched.watchers.some((w) => w.lookupId === 46)).toBe(false);
    const replaced = await setPanelQcIssueWatchers(issue.id, [RAY, SARAH]);
    expect(replaced.watchers).toHaveLength(2);
  });

  it("appends and edits comments (newest first)", async () => {
    const issue = await createPanelQcIssue({ ...blankInput, panelSerialNumber: "COMMENT-1" });
    const withComment = await addPanelQcIssueComment(issue.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>first</p>",
    });
    expect(withComment.comments[0].bodyHtml).toBe("<p>first</p>");

    const edited = await editPanelQcIssueComment(
      issue.id,
      { timestamp: withComment.comments[0].timestamp, authorEmail: "ray.white@altronic-llc.com" },
      "<p>edited</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>edited</p>");
  });

  it("leaves the whole-form save untouched watchers and comments", async () => {
    const issue = await createPanelQcIssue({ ...blankInput, panelSerialNumber: "PRESERVE-1" });
    await watchPanelQcIssue(issue.id, SARAH);
    await addPanelQcIssueComment(issue.id, { authorName: "Ray White", authorEmail: "ray.white@altronic-llc.com", bodyHtml: "<p>note</p>" });
    const saved = await updatePanelQcIssue(issue.id, { ...blankInput, panelSerialNumber: "PRESERVE-1-edited" });
    expect(saved.panelSerialNumber).toBe("PRESERVE-1-edited");
    expect(saved.watchers.some((w) => w.lookupId === 46)).toBe(true);
    expect(saved.comments).toHaveLength(1);
  });
});

const blankInput: PanelQcIssueInput = {
  panelSerialNumber: "",
  date: null,
  partNumber: "",
  partDescription: "",
  serialReferenceNote: "",
  defectCategory: null,
  notes: "",
  correctiveAction: "",
  productionTechnician: "",
  productionRepairNotes: "",
  productionResolution: "",
  watchers: [],
  tagNumber: "",
};