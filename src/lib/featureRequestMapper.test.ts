import { describe, expect, it } from "vitest";
import type { FeatureRequest, GraphListItem, Person } from "@/types/task";
import {
  attachFeatureRequestPeople,
  compareFeatureRequests,
  featureRequestLabel,
  isOpenFeatureRequest,
  toFeatureRequest,
} from "./featureRequestMapper";

function makeItem(fields: Record<string, unknown>, id = "1"): GraphListItem {
  return {
    id,
    fields,
    createdDateTime: "2026-08-01T12:00:00Z",
    lastModifiedDateTime: "2026-08-02T12:00:00Z",
    createdBy: { user: { displayName: "Ray White", email: "ray.white@altronic-llc.com" } },
  } as GraphListItem;
}

describe("toFeatureRequest", () => {
  it("maps a fully-populated item", () => {
    const request = toFeatureRequest(
      makeItem({
        Title: "Bulk status change",
        Description: "Would save time.",
        Department: "Engineering",
        RequestedBy: { LookupId: 5, LookupValue: "Sheila Horn", Email: "sheila.horn@altronic-llc.com" },
        Priority: "Medium",
        Status: "In Work",
        TargetVersion: "v0.140.0",
        Communication: "",
        Watchers: [],
        Attachments: false,
      }),
    );
    expect(request.id).toBe(1);
    expect(request.title).toBe("Bulk status change");
    expect(request.department).toBe("Engineering");
    expect(request.requestedBy?.displayName).toBe("Sheila Horn");
    expect(request.priority).toBe("Medium");
    expect(request.status).toBe("In Work");
    expect(request.targetVersion).toBe("v0.140.0");
  });

  it("falls back to Pending Review on an unrecognised status", () => {
    const request = toFeatureRequest(makeItem({ Title: "X", Status: "Bogus" }));
    expect(request.status).toBe("Pending Review");
  });

  it("clamps an unrecognised department/priority to null", () => {
    const request = toFeatureRequest(
      makeItem({ Title: "X", Department: "Not A Dept", Priority: "Urgent!" }),
    );
    expect(request.department).toBeNull();
    expect(request.priority).toBeNull();
  });

  it("reads a bare RequestedByLookupId as a nameless Person (single-person column trap)", () => {
    const request = toFeatureRequest(makeItem({ Title: "X", RequestedByLookupId: 42 }));
    expect(request.requestedBy).toEqual({ displayName: "", lookupId: 42 });
  });

  it("holds requestedBy as null when nothing is set", () => {
    const request = toFeatureRequest(makeItem({ Title: "X" }));
    expect(request.requestedBy).toBeNull();
  });

  it("parses the Communication thread", () => {
    const request = toFeatureRequest(
      makeItem({
        Title: "X",
        Communication:
          "08/01/2026 09:00:00 AM|||Ray White|||ray.white@altronic-llc.com|||<p>hello</p>",
      }),
    );
    expect(request.comments).toHaveLength(1);
    expect(request.comments[0].bodyHtml).toBe("<p>hello</p>");
  });
});

describe("attachFeatureRequestPeople", () => {
  it("fills in a nameless requestedBy from the site directory", () => {
    const request: FeatureRequest = {
      id: 1,
      title: "X",
      description: "",
      department: null,
      requestedBy: { displayName: "", lookupId: 42 },
      priority: null,
      status: "Pending Review",
      targetVersion: "",
      comments: [],
      watchers: [],
      hasAttachments: false,
      createdAt: new Date(),
      modifiedAt: new Date(),
      author: null,
    };
    const directory = new Map<number, Person>([
      [42, { displayName: "Jerrod Waldron", email: "jerrod.waldron@altronic-llc.com", lookupId: 42 }],
    ]);
    attachFeatureRequestPeople([request], directory);
    expect(request.requestedBy?.displayName).toBe("Jerrod Waldron");
  });

  it("leaves an unresolvable lookupId as nameless (renders as User #n elsewhere)", () => {
    const request: FeatureRequest = {
      id: 1,
      title: "X",
      description: "",
      department: null,
      requestedBy: { displayName: "", lookupId: 999 },
      priority: null,
      status: "Pending Review",
      targetVersion: "",
      comments: [],
      watchers: [],
      hasAttachments: false,
      createdAt: new Date(),
      modifiedAt: new Date(),
      author: null,
    };
    attachFeatureRequestPeople([request], new Map());
    expect(request.requestedBy?.displayName).toBe("");
    expect(request.requestedBy?.lookupId).toBe(999);
  });
});

function makeRequest(overrides: Partial<FeatureRequest>): FeatureRequest {
  return {
    id: 1,
    title: "X",
    description: "",
    department: null,
    requestedBy: null,
    priority: null,
    status: "Pending Review",
    targetVersion: "",
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdAt: new Date("2026-08-01"),
    modifiedAt: new Date("2026-08-01"),
    author: null,
    ...overrides,
  };
}

describe("isOpenFeatureRequest", () => {
  it("Pending Review and In Work are open", () => {
    expect(isOpenFeatureRequest(makeRequest({ status: "Pending Review" }))).toBe(true);
    expect(isOpenFeatureRequest(makeRequest({ status: "In Work" }))).toBe(true);
  });
  it("Completed and Not Implementing are closed", () => {
    expect(isOpenFeatureRequest(makeRequest({ status: "Completed" }))).toBe(false);
    expect(isOpenFeatureRequest(makeRequest({ status: "Not Implementing" }))).toBe(false);
  });
});

describe("compareFeatureRequests", () => {
  it("sorts open requests before closed ones", () => {
    const open = makeRequest({ id: 1, status: "Pending Review", createdAt: new Date("2026-01-01") });
    const closed = makeRequest({ id: 2, status: "Completed", createdAt: new Date("2026-08-01") });
    const sorted = [closed, open].sort(compareFeatureRequests);
    expect(sorted.map((r) => r.id)).toEqual([1, 2]);
  });

  it("sorts newest first within the same open/closed bucket", () => {
    const older = makeRequest({ id: 1, status: "In Work", createdAt: new Date("2026-01-01") });
    const newer = makeRequest({ id: 2, status: "In Work", createdAt: new Date("2026-08-01") });
    const sorted = [older, newer].sort(compareFeatureRequests);
    expect(sorted.map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("featureRequestLabel", () => {
  it("uses the title when present", () => {
    expect(featureRequestLabel(makeRequest({ id: 5, title: "Dark mode" }))).toBe("Dark mode");
  });
  it("falls back to a numbered placeholder when the title is blank", () => {
    expect(featureRequestLabel(makeRequest({ id: 5, title: "" }))).toBe("Feature Request #5");
  });
});
