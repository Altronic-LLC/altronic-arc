import { describe, expect, it } from "vitest";
import { comparePanelQcIssues, rawColumnValue } from "./PanelQcIssuesView";
import type { PanelQcIssue } from "@/types/task";
import { nextPanelQcTag } from "@/lib/panelQcNumber";
import { buildPanelQcLabelHtml, truncateLabelDescription } from "./PrintPanelQcIssueView";

const issue = (id: number, date: Date | null): PanelQcIssue => ({
  id, date, panelSerialNumber: "", panelPartNumber: "", subComponentPartNumber: "", partDescription: "", subComponentSerialNumber: "",
  defectCategory: null, failureReported: "", panelsResolution: "", repairTechnician: "",
  repairDefectCategory: null, repairIssueFound: "", repairResolution: "", status: "Created",
  watchers: [], comments: [], hasAttachments: false, tagNumber: "",
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
    const alpha = { ...issue(1, null), subComponentPartNumber: "100" };
    const beta = { ...issue(2, null), subComponentPartNumber: "200" };
    expect(comparePanelQcIssues(alpha, beta, "subComponentPartNumber", "asc")).toBeLessThan(0);
    expect(comparePanelQcIssues(alpha, beta, "subComponentPartNumber", "desc")).toBeGreaterThan(0);
  });
});

describe("Panel QC column filter values", () => {
  it("is a blank string for an unset text field, not the em dash the table displays", () => {
    expect(rawColumnValue(issue(1, null), "defectCategory")).toBe("");
  });

  it("counts comments and formats watchers/date the same way the table cells do", () => {
    const withExtras: PanelQcIssue = {
      ...issue(2, new Date("2026-09-02T12:00:00Z")),
      watchers: [{ displayName: "Ray White" }, { displayName: "Tim Webster" }],
      comments: [
        { timestamp: new Date(), authorName: "Ray", authorEmail: "ray@x.com", bodyHtml: "<p>a</p>" },
        { timestamp: new Date(), authorName: "Ray", authorEmail: "ray@x.com", bodyHtml: "<p>b</p>" },
      ],
    };
    expect(rawColumnValue(withExtras, "watchers")).toBe("Ray White, Tim Webster");
    expect(rawColumnValue(withExtras, "comments")).toBe("2");
    expect(rawColumnValue(withExtras, "date")).not.toBe("");
  });

  it("reads a plain text column straight off the issue", () => {
    expect(rawColumnValue({ ...issue(3, null), repairTechnician: "Calderone" }, "repairTechnician")).toBe("Calderone");
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

  describe("buildPanelQcLabelHtml (QZ Tray's silent-print path)", () => {
    it("includes every field QZ needs to render, with each element self-styled inline", () => {
      const labeled: PanelQcIssue = {
        ...issue(1, new Date("2026-09-08T12:00:00Z")),
        tagNumber: "P-2026-0099",
        subComponentSerialNumber: "SN-1",
        subComponentPartNumber: "PN-1",
        partDescription: "A short description",
      };
      const html = buildPanelQcLabelHtml(labeled);
      expect(html).toContain("P-2026-0099");
      expect(html).toContain("SN-1");
      expect(html).toContain("PN-1");
      expect(html).toContain("A short description");
      // No dependency on the app's Tailwind stylesheet or on flexbox — QZ
      // Tray's own HTML renderer has neither, so every element carries its
      // OWN inline `style=`, and no `className`/`class=` shows up at all.
      expect(html).not.toContain("class=");
      expect(html).not.toMatch(/display:\s*flex/);
      expect(html.match(/style="/g)?.length).toBeGreaterThan(1);
    });

    it("escapes HTML-significant characters in free-text fields", () => {
      const withMarkup: PanelQcIssue = {
        ...issue(2, null),
        partDescription: "<script>alert(1)</script> & more",
      };
      const html = buildPanelQcLabelHtml(withMarkup);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&amp; more");
    });

    it("falls back to an em dash for blank fields, same as the on-screen label", () => {
      const html = buildPanelQcLabelHtml(issue(3, null));
      expect(html).toContain(">—<");
    });
  });
});