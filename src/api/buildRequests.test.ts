import { describe, it, expect } from "vitest";
import {
  addBuildRequestComment,
  createBuildRequest,
  listBuildRequests,
  setBuildRequestEngineer,
  updateBuildRequestFields,
} from "./buildRequests";
import {
  createBuildRequestItem,
  deleteBuildRequestItem,
  listBuildRequestItems,
  updateBuildRequestItemFields,
} from "./buildRequestItems";

// USE_MOCK is true under Vitest — these exercise the in-memory stores.

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 };

describe("buildRequests mock CRUD", () => {
  it("creates a header with defaults and lists it", async () => {
    const created = await createBuildRequest({
      title: "Test Header",
      brNo: "BR_2026-9001",
      requestor: RAY,
      parentProjectLookupIds: [243],
    });
    expect(created.status).toBe("Submitted");
    expect(created.brNo).toBe("BR_2026-9001");
    expect(created.requestor?.displayName).toBe("Ray White");

    const all = await listBuildRequests();
    expect(all.some((b) => b.id === created.id)).toBe(true);
  });

  it("updates header fields (status + blocked reason)", async () => {
    const created = await createBuildRequest({ title: "To Block", brNo: "BR_2026-9002" });
    const updated = await updateBuildRequestFields(created.id, {
      BRStatus: "Blocked",
      BlockedReason: "Part Shortage",
    });
    expect(updated.status).toBe("Blocked");
    expect(updated.blockedReason).toBe("Part Shortage");
  });

  it("sets the single-person engineer", async () => {
    const created = await createBuildRequest({ title: "Assignable", brNo: "BR_2026-9003" });
    const updated = await setBuildRequestEngineer(created.id, RAY);
    expect(updated.engineerAssigned?.lookupId).toBe(22);
  });

  it("appends a header comment (newest first)", async () => {
    const created = await createBuildRequest({ title: "Commentable", brNo: "BR_2026-9004" });
    const updated = await addBuildRequestComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>first</p>",
    });
    expect(updated.comments[0].bodyHtml).toBe("<p>first</p>");
  });
});

describe("buildRequestItems mock CRUD", () => {
  it("creates an item joined to its header and lists it", async () => {
    const header = await createBuildRequest({ title: "With Parts", brNo: "BR_2026-9005" });
    const item = await createBuildRequestItem({
      partNumber: "999001-1",
      buildRequestLookupId: header.id,
      qty: 5,
      partType: "PCB",
    });
    expect(item.buildRequestLookupId).toBe(header.id);
    expect(item.partType).toBe("PCB");

    const all = await listBuildRequestItems();
    expect(all.some((i) => i.id === item.id)).toBe(true);
  });

  it("updates checklist booleans and multi-choice arrays", async () => {
    const header = await createBuildRequest({ title: "Checklist", brNo: "BR_2026-9006" });
    const item = await createBuildRequestItem({
      partNumber: "999002-1",
      buildRequestLookupId: header.id,
      partType: "PCB",
    });
    const updated = await updateBuildRequestItemFields(item.id, {
      Completed_x0020_BOM: true,
      Testing: ["AOI", "In Circuit"],
      Part_x0020_Status: "Review Checklist",
    });
    expect(updated.checklist.Completed_x0020_BOM).toBe(true);
    expect(updated.testing).toEqual(["AOI", "In Circuit"]);
    expect(updated.partStatus).toBe("Review Checklist");
  });

  it("deletes an item", async () => {
    const header = await createBuildRequest({ title: "Deletable", brNo: "BR_2026-9007" });
    const item = await createBuildRequestItem({
      partNumber: "999003-1",
      buildRequestLookupId: header.id,
    });
    await deleteBuildRequestItem(item.id);
    const all = await listBuildRequestItems();
    expect(all.some((i) => i.id === item.id)).toBe(false);
  });
});
