import { describe, it, expect } from "vitest";
import * as api from "./grayMarketRequests";
import {
  addGrayMarketComment,
  createGrayMarketRequest,
  editGrayMarketComment,
  getGrayMarketRequest,
  listGrayMarketRequests,
  setGrayMarketWatchers,
  updateGrayMarketFields,
} from "./grayMarketRequests";
import type { GrayMarketRequestInput } from "@/types/task";

// USE_MOCK is true under Vitest — these run against the in-memory store.

const input: GrayMarketRequestInput = {
  title: "1000-9999-00",
  status: "Open",
  requestDate: new Date("2026-08-19T12:00:00Z"),
  testingRequired: "Yes",
  requestor: { displayName: "Ray White", email: "ray@altronic-llc.com", lookupId: 22 },
  values: { vendor: "AERI", partDescription: "TEST PART" },
};

describe("gray market requests API", () => {
  it("lists newest first", async () => {
    const rows = await listGrayMarketRequests();
    const dates = rows.map((r) => r.requestDate?.getTime() ?? -Infinity);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("creates a request and assigns the next log number", async () => {
    const existing = await listGrayMarketRequests();
    const created = await createGrayMarketRequest(input, existing);
    expect(created.logNo).toMatch(/^GMR_\d{4}-\d{3,}$/);
    expect(created.title).toBe("1000-9999-00");
  });

  it("makes the requestor a watcher on the new request", async () => {
    // Whoever raises it watches it — the rule everywhere else in ARC.
    const created = await createGrayMarketRequest(input, await listGrayMarketRequests());
    expect(created.watchers.map((w) => w.displayName)).toContain("Ray White");
  });

  it("patches a single column", async () => {
    const created = await createGrayMarketRequest(input, await listGrayMarketRequests());
    const updated = await updateGrayMarketFields(created.id, { Vendor: "Digi-Key" });
    expect(updated.values.vendor).toBe("Digi-Key");
    expect(updated.title).toBe("1000-9999-00");
  });

  it("patches the named columns too", async () => {
    const created = await createGrayMarketRequest(input, await listGrayMarketRequests());
    const updated = await updateGrayMarketFields(created.id, { RequestStatus: "Complete" });
    expect(updated.status).toBe("Complete");
  });

  it("posts a comment, newest first", async () => {
    const created = await createGrayMarketRequest(input, await listGrayMarketRequests());
    await addGrayMarketComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray@altronic-llc.com",
      bodyHtml: "<p>First</p>",
    });
    const after = await addGrayMarketComment(created.id, {
      authorName: "Priya Nair",
      authorEmail: "priya@altronic-llc.com",
      bodyHtml: "<p>Second</p>",
    });
    expect(after.comments.map((c) => c.bodyHtml)).toEqual(["<p>Second</p>", "<p>First</p>"]);
  });

  it("edits one comment without touching the others", async () => {
    const created = await createGrayMarketRequest(input, await listGrayMarketRequests());
    const withComment = await addGrayMarketComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray@altronic-llc.com",
      bodyHtml: "<p>Typo</p>",
    });
    const target = withComment.comments[0];
    const edited = await editGrayMarketComment(
      created.id,
      { timestamp: target.timestamp, authorEmail: "ray@altronic-llc.com" },
      "<p>Fixed</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>Fixed</p>");
  });

  it("replaces the watcher list", async () => {
    const created = await createGrayMarketRequest(input, await listGrayMarketRequests());
    const updated = await setGrayMarketWatchers(created.id, []);
    expect(updated.watchers).toHaveLength(0);
  });

  it("returns null for a request that isn't there", async () => {
    expect(await getGrayMarketRequest(999_999)).toBeNull();
  });

  // A request records a part that was bought. Correcting one is an edit;
  // removing one is a deliberate trip to SharePoint. The absence is the point.
  it("exposes no delete", () => {
    expect(Object.keys(api).filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });
});
