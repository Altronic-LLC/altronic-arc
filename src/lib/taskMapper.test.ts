import { describe, it, expect } from "vitest";
import { parseLookupSingle, parsePersonField, parseSinglePersonField, toTask } from "./taskMapper";
import type { GraphItemFields, GraphListItem } from "@/types/task";

function makeItem(fields: GraphItemFields = {}, overrides: Partial<GraphListItem> = {}): GraphListItem {
  return {
    id: "42",
    createdDateTime: "2024-01-01T00:00:00Z",
    lastModifiedDateTime: "2024-01-02T00:00:00Z",
    fields,
    ...overrides,
  };
}

describe("toTask — basic mapping", () => {
  it("parses numeric id from string", () => {
    expect(toTask(makeItem({}, { id: "42" })).id).toBe(42);
  });

  it("maps title and description", () => {
    const t = toTask(makeItem({ Title: "Hello", Description: "World" }));
    expect(t.title).toBe("Hello");
    expect(t.description).toBe("World");
  });

  it("falls back to (untitled) when Title missing", () => {
    const t = toTask(makeItem({}));
    expect(t.title).toBe("(untitled)");
    expect(t.numberedTitle).toBe("(untitled)");
  });

  it("falls back to Title when NumberedTitle missing", () => {
    expect(toTask(makeItem({ Title: "X" })).numberedTitle).toBe("X");
  });

  it("prefers NumberedTitle over Title when both present", () => {
    const t = toTask(makeItem({ Title: "Plain", NumberedTitle: "T1-0000-Plain" }));
    expect(t.numberedTitle).toBe("T1-0000-Plain");
    expect(t.title).toBe("Plain");
  });

  it("uses empty string when Description missing", () => {
    expect(toTask(makeItem({})).description).toBe("");
  });
});

describe("toTask — status / priority / category clamping", () => {
  it("keeps valid status as-is", () => {
    expect(toTask(makeItem({ Status: "In Progress" })).status).toBe("In Progress");
  });

  it("clamps invalid status to BACKLOG", () => {
    expect(toTask(makeItem({ Status: "Bogus" })).status).toBe("BACKLOG");
  });

  it("clamps missing status to BACKLOG", () => {
    expect(toTask(makeItem({})).status).toBe("BACKLOG");
  });

  it("keeps valid priority", () => {
    expect(toTask(makeItem({ Priority: "High" })).priority).toBe("High");
  });

  it("returns null for invalid priority", () => {
    expect(toTask(makeItem({ Priority: "Critical" })).priority).toBeNull();
  });

  it("returns null for missing priority", () => {
    expect(toTask(makeItem({})).priority).toBeNull();
  });

  it("keeps valid category", () => {
    expect(toTask(makeItem({ Category: "Software" })).category).toBe("Software");
  });

  it("returns null for invalid category", () => {
    expect(toTask(makeItem({ Category: "Banana" })).category).toBeNull();
  });
});

describe("toTask — labels parsing", () => {
  it("parses ;# delimited labels", () => {
    const t = toTask(makeItem({ Labels: "bug;#enhancement;#invalid" }));
    expect(t.labels).toEqual(["bug", "enhancement", "invalid"]);
  });

  it("parses comma-delimited labels", () => {
    const t = toTask(makeItem({ Labels: "bug, enhancement, question" }));
    expect(t.labels).toEqual(["bug", "enhancement", "question"]);
  });

  it("filters out values that aren't valid labels", () => {
    const t = toTask(makeItem({ Labels: "bug;#notRealLabel" }));
    expect(t.labels).toEqual(["bug"]);
  });

  it("returns empty array for missing Labels", () => {
    expect(toTask(makeItem({})).labels).toEqual([]);
  });

  it("returns empty array for empty-string Labels", () => {
    expect(toTask(makeItem({ Labels: "" })).labels).toEqual([]);
  });
});

describe("toTask — dates", () => {
  it("parses dueDate ISO string", () => {
    const t = toTask(makeItem({ DueDate: "2026-01-15T00:00:00Z" }));
    expect(t.dueDate?.toISOString().startsWith("2026-01-15")).toBe(true);
  });

  it("returns null dueDate when missing", () => {
    expect(toTask(makeItem({})).dueDate).toBeNull();
  });

  it("returns null dueDate for unparseable string", () => {
    expect(toTask(makeItem({ DueDate: "not-a-date" })).dueDate).toBeNull();
  });

  it("parses createdAt and modifiedAt from item-level fields", () => {
    const t = toTask(
      makeItem(
        {},
        {
          createdDateTime: "2024-01-01T00:00:00Z",
          lastModifiedDateTime: "2024-01-02T00:00:00Z",
        },
      ),
    );
    expect(t.createdAt.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(t.modifiedAt.toISOString()).toBe("2024-01-02T00:00:00.000Z");
  });
});

describe("toTask — person fields", () => {
  it("parses a single-person Assigned object", () => {
    const t = toTask(
      makeItem({
        Assigned: { LookupId: 46, LookupValue: "Sarah", Email: "sarah@e.com" },
      }),
    );
    expect(t.assigned).toEqual([
      { displayName: "Sarah", email: "sarah@e.com", lookupId: 46 },
    ]);
  });

  it("parses a multi-person Assigned array", () => {
    const t = toTask(
      makeItem({
        Assigned: [
          { LookupId: 1, LookupValue: "A", Email: "a@e.com" },
          { LookupId: 2, LookupValue: "B", Email: "b@e.com" },
        ],
      }),
    );
    expect(t.assigned.map((p) => p.lookupId)).toEqual([1, 2]);
  });

  it("skips entries without a displayName / LookupValue", () => {
    const t = toTask(
      makeItem({
        Assigned: [
          { LookupId: 1 }, // no display name → skipped
          { LookupId: 2, LookupValue: "Real" },
        ],
      }),
    );
    expect(t.assigned).toHaveLength(1);
    expect(t.assigned[0].displayName).toBe("Real");
  });

  it("skips non-object entries silently", () => {
    const t = toTask(
      makeItem({
        Assigned: [null, "string", 42, { LookupId: 1, LookupValue: "OK" }],
      }),
    );
    expect(t.assigned).toHaveLength(1);
    expect(t.assigned[0].displayName).toBe("OK");
  });

  it("returns empty arrays when person fields are missing", () => {
    const t = toTask(makeItem({}));
    expect(t.assigned).toEqual([]);
    expect(t.watchers).toEqual([]);
  });

  it("accepts lowercase alias keys (displayName / email / lookupId)", () => {
    const t = toTask(
      makeItem({
        Watchers: [{ displayName: "X", email: "x@e.com", lookupId: 99 }],
      }),
    );
    expect(t.watchers[0]).toEqual({
      displayName: "X",
      email: "x@e.com",
      lookupId: 99,
    });
  });

  it("falls back to the 'title' field for display name", () => {
    const t = toTask(makeItem({ Watchers: [{ title: "TitleName", LookupId: 7 }] }));
    expect(t.watchers[0].displayName).toBe("TitleName");
  });
});

describe("toTask — parent / related projects", () => {
  it("maps parent project lookupId with blank title", () => {
    const t = toTask(makeItem({ Parent_x0020_Project_x0020_ReferLookupId: 7 }));
    expect(t.parentProject).toEqual({ lookupId: 7, title: "" });
  });

  it("returns null parentProject when missing", () => {
    expect(toTask(makeItem({})).parentProject).toBeNull();
  });

  it("parses relatedProjects from a plain array", () => {
    const t = toTask(
      makeItem({
        ProjectReference: [
          { LookupId: 1, LookupValue: "Alpha" },
          { LookupId: 2, LookupValue: "Beta" },
        ],
      }),
    );
    expect(t.relatedProjects).toEqual([
      { lookupId: 1, title: "Alpha" },
      { lookupId: 2, title: "Beta" },
    ]);
  });

  it("parses relatedProjects from a { results: [...] } wrapper", () => {
    const t = toTask(
      makeItem({
        ProjectReference: { results: [{ LookupId: 1, LookupValue: "Alpha" }] },
      }),
    );
    expect(t.relatedProjects).toHaveLength(1);
    expect(t.relatedProjects[0]).toEqual({ lookupId: 1, title: "Alpha" });
  });

  it("skips relatedProjects entries with no lookupId", () => {
    const t = toTask(
      makeItem({
        ProjectReference: [{ LookupId: 0 }, { LookupId: 5, LookupValue: "Valid" }],
      }),
    );
    expect(t.relatedProjects).toEqual([{ lookupId: 5, title: "Valid" }]);
  });

  it("handles relatedProjects when shape is unrecognised", () => {
    const t = toTask(makeItem({ ProjectReference: "garbage" }));
    expect(t.relatedProjects).toEqual([]);
  });

  it("accepts lowercase alias keys for relatedProjects", () => {
    const t = toTask(
      makeItem({ ProjectReference: [{ lookupId: 9, title: "Lowercase" }] }),
    );
    expect(t.relatedProjects[0]).toEqual({ lookupId: 9, title: "Lowercase" });
  });

  it("skips non-object entries in relatedProjects (null / primitives)", () => {
    const t = toTask(
      makeItem({
        ProjectReference: [null, 42, "string", { LookupId: 5, LookupValue: "Real" }],
      }),
    );
    expect(t.relatedProjects).toEqual([{ lookupId: 5, title: "Real" }]);
  });

  it("falls back to empty title when neither LookupValue nor title present", () => {
    const t = toTask(makeItem({ ProjectReference: [{ LookupId: 5 }] }));
    expect(t.relatedProjects[0]).toEqual({ lookupId: 5, title: "" });
  });
});

describe("toTask — parent task / children / misc", () => {
  it("maps parentTask lookupId with placeholder fields (filled later)", () => {
    const t = toTask(makeItem({ ParentTaskLookupId: 99 }));
    expect(t.parentTask).toEqual({ id: 99, numberedTitle: "", status: "BACKLOG" });
  });

  it("returns null parentTask when missing", () => {
    expect(toTask(makeItem({})).parentTask).toBeNull();
  });

  it("starts childTasks as empty (filled by taskGraph)", () => {
    expect(toTask(makeItem({})).childTasks).toEqual([]);
  });

  it("maps softwareRevision when present, empty string when missing", () => {
    expect(toTask(makeItem({ SoftwareRevision: "v1.2" })).softwareRevision).toBe("v1.2");
    expect(toTask(makeItem({})).softwareRevision).toBe("");
  });

  it("parses comments from Communication field", () => {
    const t = toTask(
      makeItem({
        Communication: "07/18/2024 7:28:33 PM|||S|||s@e.com|||<p>x</p>",
      }),
    );
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].authorName).toBe("S");
  });

  it("returns empty comments when Communication missing", () => {
    expect(toTask(makeItem({})).comments).toEqual([]);
  });

  it("maps hasAttachments to true/false", () => {
    expect(toTask(makeItem({ Attachments: true })).hasAttachments).toBe(true);
    expect(toTask(makeItem({ Attachments: false })).hasAttachments).toBe(false);
    expect(toTask(makeItem({})).hasAttachments).toBe(false);
  });

  it("handles numeric and string lookup IDs (toInt fallback)", () => {
    expect(toTask(makeItem({ AuthorLookupId: "5" })).authorLookupId).toBe(5);
    expect(toTask(makeItem({ AuthorLookupId: 6 })).authorLookupId).toBe(6);
    expect(toTask(makeItem({ AuthorLookupId: "garbage" })).authorLookupId).toBe(0);
    expect(toTask(makeItem({})).authorLookupId).toBe(0);
  });

  it("falls back to 0 lookupId for non-string non-number values in toInt", () => {
    const t = toTask(
      makeItem({
        Watchers: [{ LookupId: { weird: true }, LookupValue: "X", Email: "x@e.com" }],
      }),
    );
    expect(t.watchers[0].lookupId).toBe(0);
  });
});

describe("toTask — author (createdBy.user)", () => {
  it("maps createdBy.user to author Person", () => {
    const t = toTask(
      makeItem({}, {
        createdBy: { user: { displayName: "Sarah Shaffer", email: "sarah@x.com" } },
      }),
    );
    expect(t.author).toEqual({ displayName: "Sarah Shaffer", email: "sarah@x.com" });
  });

  it("handles missing email on the user", () => {
    const t = toTask(
      makeItem({}, { createdBy: { user: { displayName: "Guest User" } } }),
    );
    expect(t.author).toEqual({ displayName: "Guest User", email: undefined });
  });

  it("returns null author when createdBy is absent", () => {
    expect(toTask(makeItem()).author).toBeNull();
  });

  it("returns null author when createdBy.user has no displayName", () => {
    const t = toTask(makeItem({}, { createdBy: { user: { email: "x@x.com" } } }));
    expect(t.author).toBeNull();
  });
});

describe("toTask — EIRReference hyperlink", () => {
  it("parses the { Url, Description } object shape", () => {
    const t = toTask(
      makeItem({ EIRReference: { Url: "https://x/eir/9", Description: "EIR_2026-0042" } }),
    );
    expect(t.eirReference).toEqual({ url: "https://x/eir/9", label: "EIR_2026-0042" });
  });

  it("falls back to the url as label when Description is missing", () => {
    const t = toTask(makeItem({ EIRReference: { Url: "https://x/eir/9" } }));
    expect(t.eirReference).toEqual({ url: "https://x/eir/9", label: "https://x/eir/9" });
  });

  it("accepts a bare string value", () => {
    const t = toTask(makeItem({ EIRReference: "EIR_2026-0042" }));
    expect(t.eirReference).toEqual({ url: "EIR_2026-0042", label: "EIR_2026-0042" });
  });

  it("is null when absent, empty, or an empty object", () => {
    expect(toTask(makeItem({})).eirReference).toBeNull();
    expect(toTask(makeItem({ EIRReference: "" })).eirReference).toBeNull();
    expect(toTask(makeItem({ EIRReference: {} })).eirReference).toBeNull();
  });
});

describe("parseSinglePersonField — used by Operations Task List's single-value Assigned", () => {
  it("returns the first (only) person for a single-person object", () => {
    const p = parseSinglePersonField({ LookupId: 46, LookupValue: "Sarah", Email: "sarah@e.com" });
    expect(p).toEqual({ displayName: "Sarah", email: "sarah@e.com", lookupId: 46 });
  });

  it("returns the first entry when handed a multi-person array (defensive)", () => {
    const p = parseSinglePersonField([
      { LookupId: 1, LookupValue: "A" },
      { LookupId: 2, LookupValue: "B" },
    ]);
    expect(p?.displayName).toBe("A");
  });

  it("returns null for empty/missing input", () => {
    expect(parseSinglePersonField(undefined)).toBeNull();
    expect(parseSinglePersonField(null)).toBeNull();
    expect(parseSinglePersonField([])).toBeNull();
  });

  it("is consistent with parsePersonField's first element", () => {
    const raw = { LookupId: 9, LookupValue: "X", Email: "x@e.com" };
    expect(parseSinglePersonField(raw)).toEqual(parsePersonField(raw)[0]);
  });
});

describe("parseLookupSingle — used by Operations Task List's single lookups (Project Ref, Equipment)", () => {
  it("parses a resolved lookup object", () => {
    expect(parseLookupSingle({ LookupId: 3, LookupValue: "0002-PVA Machine" })).toEqual({
      lookupId: 3,
      title: "0002-PVA Machine",
    });
  });

  it("accepts the lowercase alias keys", () => {
    expect(parseLookupSingle({ lookupId: 4, title: "Lowercase" })).toEqual({
      lookupId: 4,
      title: "Lowercase",
    });
  });

  it("falls back to empty title when LookupValue is missing", () => {
    expect(parseLookupSingle({ LookupId: 5 })).toEqual({ lookupId: 5, title: "" });
  });

  it("returns null when there's no lookupId", () => {
    expect(parseLookupSingle({ LookupValue: "No id" })).toBeNull();
    expect(parseLookupSingle({ LookupId: 0 })).toBeNull();
  });

  it("returns null for non-object / empty input", () => {
    expect(parseLookupSingle(null)).toBeNull();
    expect(parseLookupSingle(undefined)).toBeNull();
    expect(parseLookupSingle("garbage")).toBeNull();
    expect(parseLookupSingle(42)).toBeNull();
  });
});
