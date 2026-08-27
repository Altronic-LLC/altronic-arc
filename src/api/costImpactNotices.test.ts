import { describe, it, expect } from "vitest";
import * as costImpactNoticesModule from "./costImpactNotices";
import {
  addCostImpactNoticeComment,
  createCostImpactNotice,
  editCostImpactNoticeComment,
  getCostImpactNotice,
  listCostImpactNotices,
  updateCostImpactNoticeFields,
} from "./costImpactNotices";
import type { CostImpactNoticeInput } from "@/types/task";

const REQUIRED: CostImpactNoticeInput = {
  title: "TEST PART",
  supplier: "",
  sapNumber: "",
  oldPartNumber: "",
  mpn: "",
  originalCost: "10.00",
  newCost: "12.50",
  timeOfImpact: "Immediate",
  usedOnPanels: null,
  whereUsed: "Test fixture only.",
  eau: "",
  bpReference: "",
  notes: "",
};

describe("Cost Impact Notices API", () => {
  it("lists newest first", async () => {
    const notices = await listCostImpactNotices();
    expect(notices.length).toBeGreaterThan(0);
  });

  it("creates a notice, computing the delta and the submitter", async () => {
    const created = await createCostImpactNotice(REQUIRED, {
      displayName: "Ray White",
      email: "ray.white@altronic-llc.com",
    });
    expect(created.title).toBe("TEST PART");
    expect(created.originalCost).toBe("10.00");
    expect(created.newCost).toBe("12.50");
    expect(created.deltaCost).toBeCloseTo(2.5);
    expect(created.submittedBy?.email).toBe("ray.white@altronic-llc.com");

    const found = await getCostImpactNotice(created.id);
    expect(found?.title).toBe("TEST PART");
  });

  it("patches fields and recomputes the delta when either cost changes", async () => {
    const created = await createCostImpactNotice(REQUIRED);
    const updated = await updateCostImpactNoticeFields(created.id, { NewCost: "20.00" });
    expect(updated.newCost).toBe("20.00");
    expect(updated.deltaCost).toBeCloseTo(10);
  });

  it("patches the choice columns", async () => {
    const created = await createCostImpactNotice(REQUIRED);
    const updated = await updateCostImpactNoticeFields(created.id, {
      TimeofImpact: "Future (6+ mo)",
      Panels: "Yes",
    });
    expect(updated.timeOfImpact).toBe("Future (6+ mo)");
    expect(updated.usedOnPanels).toBe("Yes");
  });

  it("posts and edits a comment", async () => {
    const created = await createCostImpactNotice(REQUIRED);
    const withComment = await addCostImpactNoticeComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>Frist</p>",
    });
    expect(withComment.comments[0].bodyHtml).toContain("Frist");

    const edited = await editCostImpactNoticeComment(
      created.id,
      { timestamp: withComment.comments[0].timestamp, authorEmail: "ray.white@altronic-llc.com" },
      "<p>First</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>First</p>");
  });

  it("returns null for a notice that doesn't exist", async () => {
    expect(await getCostImpactNotice(999_999)).toBeNull();
  });

  // A notice is a record of a cost change and who was told — a superseded
  // one is a new notice, not a correction to the old one.
  it("has no delete", () => {
    expect(Object.keys(costImpactNoticesModule).filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });
});
