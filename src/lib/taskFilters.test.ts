import { describe, it, expect } from "vitest";
import type { Person, Task } from "@/types/task";
import type { Filters } from "@/components/FilterBar";
import { applyFilters, collectPeople } from "./taskFilters";

const ALICE: Person = { displayName: "Alice", email: "alice@x.com", lookupId: 1 };
const BOB: Person = { displayName: "Bob", email: "bob@x.com", lookupId: 2 };
const CAROL_NO_EMAIL: Person = { displayName: "Carol", lookupId: 3 };

function task(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    numberedTitle: "T1-X-Title",
    title: "Title",
    description: "Description",
    status: "In Progress",
    priority: null,
    category: null,
    labels: [],
    dueDate: null,
    createdAt: new Date("2026-01-01"),
    modifiedAt: new Date("2026-01-01"),
    authorLookupId: 1,
    author: null,
    editorLookupId: 1,
    parentProject: null,
    relatedProjects: [],
    parentTask: null,
    childTasks: [],
    assigned: [],
    watchers: [],
    softwareRevision: "",
    eirReference: null,
    comments: [],
    hasAttachments: false,
    ...over,
  };
}

const NO_FILTERS: Filters = {
  search: "",
  projectIds: [],
  assignedEmails: [],
  createdByEmail: null,
};

describe("collectPeople", () => {
  it("deduplicates across assigned and watchers", () => {
    const tasks = [
      task({ assigned: [ALICE, BOB] }),
      task({ assigned: [ALICE], watchers: [BOB] }),
    ];
    const people = collectPeople(tasks);
    expect(people).toHaveLength(2);
    expect(people.map((p) => p.displayName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("falls back to displayName when a person has no email", () => {
    const tasks = [task({ assigned: [CAROL_NO_EMAIL, CAROL_NO_EMAIL] })];
    const people = collectPeople(tasks);
    expect(people).toHaveLength(1);
    expect(people[0].displayName).toBe("Carol");
  });

  it("returns empty array when no tasks have people", () => {
    expect(collectPeople([task()])).toEqual([]);
  });
});

describe("applyFilters", () => {
  describe("status filter", () => {
    it("ALL_ACTIVE hides Complete tasks", () => {
      const tasks = [task({ status: "Complete" }), task({ id: 2, status: "In Progress" })];
      const out = applyFilters(tasks, "ALL_ACTIVE", NO_FILTERS);
      expect(out.map((t) => t.id)).toEqual([2]);
    });

    it("specific status keeps only matching", () => {
      const tasks = [task({ status: "BACKLOG" }), task({ id: 2, status: "In Progress" })];
      const out = applyFilters(tasks, "BACKLOG", NO_FILTERS);
      expect(out.map((t) => t.id)).toEqual([1]);
    });

    it("null statusFilter keeps everything", () => {
      const tasks = [task({ status: "Complete" }), task({ id: 2, status: "In Progress" })];
      const out = applyFilters(tasks, null, NO_FILTERS);
      expect(out).toHaveLength(2);
    });
  });

  describe("project filter", () => {
    it("keeps only tasks whose parent project matches one of the selected ids", () => {
      const tasks = [
        task({ parentProject: { lookupId: 10, title: "P1" } }),
        task({ id: 2, parentProject: { lookupId: 20, title: "P2" } }),
        task({ id: 3, parentProject: { lookupId: 30, title: "P3" } }),
        task({ id: 4, parentProject: null }),
      ];
      const out = applyFilters(tasks, null, { ...NO_FILTERS, projectIds: [10, 30] });
      expect(out.map((t) => t.id)).toEqual([1, 3]);
    });

    it("empty projectIds means no project filter", () => {
      const tasks = [
        task({ parentProject: { lookupId: 10, title: "P1" } }),
        task({ id: 2, parentProject: null }),
      ];
      const out = applyFilters(tasks, null, { ...NO_FILTERS, projectIds: [] });
      expect(out).toHaveLength(2);
    });

    it("excludes tasks with no parent project when projectIds is non-empty", () => {
      const tasks = [task({ parentProject: null })];
      const out = applyFilters(tasks, null, { ...NO_FILTERS, projectIds: [10] });
      expect(out).toEqual([]);
    });
  });

  describe("assigned filter", () => {
    it("matches when at least one assignee email is in the list", () => {
      const tasks = [
        task({ assigned: [ALICE] }),
        task({ id: 2, assigned: [BOB] }),
        task({ id: 3, assigned: [] }),
      ];
      const out = applyFilters(tasks, null, {
        ...NO_FILTERS,
        assignedEmails: ["alice@x.com", "bob@x.com"],
      });
      expect(out.map((t) => t.id)).toEqual([1, 2]);
    });

    it("falls back to displayName when assignee has no email", () => {
      const tasks = [task({ assigned: [CAROL_NO_EMAIL] })];
      const out = applyFilters(tasks, null, { ...NO_FILTERS, assignedEmails: ["Carol"] });
      expect(out).toHaveLength(1);
    });

    it("excludes tasks where no assignee matches any selected email", () => {
      const tasks = [task({ assigned: [ALICE] })];
      const out = applyFilters(tasks, null, { ...NO_FILTERS, assignedEmails: ["bob@x.com"] });
      expect(out).toEqual([]);
    });

    it("empty assignedEmails means no assigned filter", () => {
      const tasks = [task({ assigned: [] })];
      const out = applyFilters(tasks, null, { ...NO_FILTERS, assignedEmails: [] });
      expect(out).toHaveLength(1);
    });
  });

  describe("createdBy filter", () => {
    it("matches against assigned+watchers (best-effort)", () => {
      const tasks = [
        task({ watchers: [ALICE] }),
        task({ id: 2, assigned: [BOB] }),
      ];
      const out = applyFilters(tasks, null, { ...NO_FILTERS, createdByEmail: "alice@x.com" });
      expect(out.map((t) => t.id)).toEqual([1]);
    });

    it("excludes when no candidate matches", () => {
      const out = applyFilters(
        [task({ assigned: [ALICE] })],
        null,
        { ...NO_FILTERS, createdByEmail: "bob@x.com" },
      );
      expect(out).toEqual([]);
    });
  });

  describe("search filter", () => {
    it("matches title", () => {
      const out = applyFilters(
        [task({ title: "Engineering Workflow" })],
        null,
        { ...NO_FILTERS, search: "workflow" },
      );
      expect(out).toHaveLength(1);
    });

    it("matches description", () => {
      const out = applyFilters(
        [task({ description: "needs purchase order" })],
        null,
        { ...NO_FILTERS, search: "PURCHASE" },
      );
      expect(out).toHaveLength(1);
    });

    it("matches numberedTitle", () => {
      const out = applyFilters(
        [task({ numberedTitle: "T42-CB-thing" })],
        null,
        { ...NO_FILTERS, search: "t42" },
      );
      expect(out).toHaveLength(1);
    });

    it("strips HTML tags from comments before matching", () => {
      const out = applyFilters(
        [
          task({
            comments: [
              {
                timestamp: new Date(),
                authorName: "A",
                authorEmail: "a@x.com",
                bodyHtml: "<p>hello <b>world</b></p>",
              },
            ],
          }),
        ],
        null,
        { ...NO_FILTERS, search: "hello world" },
      );
      expect(out).toHaveLength(1);
    });

    it("returns nothing when search needle has no match", () => {
      const out = applyFilters([task({ title: "Foo" })], null, {
        ...NO_FILTERS,
        search: "bar",
      });
      expect(out).toEqual([]);
    });
  });

  it("combines multiple filters with AND semantics", () => {
    const tasks = [
      task({ assigned: [ALICE], parentProject: { lookupId: 10, title: "P" }, title: "Match" }),
      task({ id: 2, assigned: [ALICE], parentProject: { lookupId: 20, title: "Q" }, title: "Match" }),
      task({ id: 3, assigned: [BOB], parentProject: { lookupId: 10, title: "P" }, title: "Match" }),
    ];
    const out = applyFilters(tasks, null, {
      ...NO_FILTERS,
      projectIds: [10],
      assignedEmails: ["alice@x.com"],
      search: "match",
    });
    expect(out.map((t) => t.id)).toEqual([1]);
  });
});
