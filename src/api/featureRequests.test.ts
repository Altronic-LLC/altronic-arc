import { describe, expect, it } from "vitest";
import {
  addFeatureRequestComment,
  createFeatureRequest,
  editFeatureRequestComment,
  getFeatureRequest,
  listFeatureRequests,
  setFeatureRequestWatchers,
  updateFeatureRequestFields,
} from "./featureRequests";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 1 };
const SHEILA = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com", lookupId: 2 };

describe("featureRequests mock CRUD", () => {
  it("creates a request with Status defaulted to Pending Review and RequestedBy auto-filled", async () => {
    const created = await createFeatureRequest(
      { title: "Add dark mode toggle to print view", description: "so it matches the app", department: "Engineering", priority: "Low" },
      RAY,
    );
    expect(created.status).toBe("Pending Review");
    expect(created.requestedBy).toEqual(RAY);
    expect(created.department).toBe("Engineering");
    expect(created.priority).toBe("Low");

    const all = await listFeatureRequests();
    expect(all.some((r) => r.id === created.id)).toBe(true);
  });

  it("auto-watches the requester on create", async () => {
    const created = await createFeatureRequest(
      { title: "X", description: "", department: null, priority: null },
      SHEILA,
    );
    expect(created.watchers.some((w) => w.email === SHEILA.email)).toBe(true);
  });

  it("gets a request by id, and null for a missing one", async () => {
    const created = await createFeatureRequest(
      { title: "Findable", description: "", department: null, priority: null },
      RAY,
    );
    const found = await getFeatureRequest(created.id);
    expect(found?.title).toBe("Findable");
    expect(await getFeatureRequest(999999)).toBeNull();
  });

  it("updates status, priority, department and target version", async () => {
    const created = await createFeatureRequest(
      { title: "To Update", description: "", department: null, priority: null },
      RAY,
    );
    const updated = await updateFeatureRequestFields(created.id, {
      Status: "In Work",
      Priority: "High",
      Department: "Panels",
      TargetVersion: "v0.150.0",
    });
    expect(updated.status).toBe("In Work");
    expect(updated.priority).toBe("High");
    expect(updated.department).toBe("Panels");
    expect(updated.targetVersion).toBe("v0.150.0");
  });

  it("replaces watchers wholesale", async () => {
    const created = await createFeatureRequest(
      { title: "Watchable", description: "", department: null, priority: null },
      RAY,
    );
    const replaced = await setFeatureRequestWatchers(created.id, [RAY, SHEILA]);
    expect(replaced.watchers).toHaveLength(2);
  });

  it("appends and edits comments (newest first)", async () => {
    const created = await createFeatureRequest(
      { title: "Commentable", description: "", department: null, priority: null },
      RAY,
    );
    const withComment = await addFeatureRequestComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>first</p>",
    });
    expect(withComment.comments[0].bodyHtml).toBe("<p>first</p>");

    const edited = await editFeatureRequestComment(
      created.id,
      {
        timestamp: withComment.comments[0].timestamp,
        authorEmail: "ray.white@altronic-llc.com",
      },
      "<p>edited</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>edited</p>");
  });

  it("throws a clear error updating a request that doesn't exist", async () => {
    await expect(updateFeatureRequestFields(999999, { Status: "Completed" })).rejects.toThrow(
      /not found/,
    );
  });
});
