import { describe, it, expect } from "vitest";
import type { OperationsTask, Person } from "@/types/task";
import type { Filters } from "@/components/FilterBar";
import { applyOperationsFilters, collectOperationsPeople } from "./operationsTaskFilters";

const ALICE: Person = { displayName: "Alice", email: "alice@x.com", lookupId: 1 };
const BOB: Person = { displayName: "Bob", email: "bob@x.com", lookupId: 2 };
const CAROL_NO_EMAIL: Person = { displayName: "Carol", lookupId: 3 };

function task(over: Partial<OperationsTask> = {}): OperationsTask {
  return {
    id: 1,
    taskNumber: "Task 0000-1",
    title: "Title",
    description: "Description",
    status: "WIP",
    priority: null,
    taskType: null,
    location: null,
    dueDate: null,
    createdAt: new Date("2026-01-01"),
    modifiedAt: new Date("2026-01-01"),
    authorLookupId: 1,
    author: null,
    editorLookupId: 1,
    assigned: null,
    watchers: [],
    parentProject: null,
    equipment: null,
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

describe("collectOperationsPeople", () => {
  it("deduplicates across the single assignee and watchers", () => {
    const tasks = [task({ assigned: ALICE, watchers: [BOB] }), task({ id: 2, assigned: ALICE })];
    const people = collectOperationsPeople(tasks);
    expect(people).toHaveLength(2);
    expect(people.map((p) => p.displayName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("handles a null assignee gracefully", () => {
    const people = collectOperationsPeople([task({ assigned: null, watchers: [BOB] })]);
    expect(people.map((p) => p.displayName)).toEqual(["Bob"]);
  });

  it("falls back to displayName when a person has no email", () => {
    const people = collectOperationsPeople([task({ assigned: CAROL_NO_EMAIL })]);
    expect(people).toHaveLength(1);
    expect(people[0].displayName).toBe("Carol");
  });

  it("returns empty array when no tasks have people", () => {
    expect(collectOperationsPeople([task()])).toEqual([]);
  });
});

describe("applyOperationsFilters", () => {
  describe("status filter", () => {
    it("ALL_ACTIVE hides both Complete and Canceled", () => {
      const tasks = [
        task({ id: 1, status: "Complete" }),
        task({ id: 2, status: "Canceled" }),
        task({ id: 3, status: "WIP" }),
      ];
      const out = applyOperationsFilters(tasks, "ALL_ACTIVE", NO_FILTERS);
      expect(out.map((t) => t.id)).toEqual([3]);
    });

    it("specific status keeps only matching", () => {
      const tasks = [task({ status: "Backlog" }), task({ id: 2, status: "WIP" })];
      const out = applyOperationsFilters(tasks, "Backlog", NO_FILTERS);
      expect(out.map((t) => t.id)).toEqual([1]);
    });

    it("null statusFilter keeps everything", () => {
      const tasks = [task({ status: "Complete" }), task({ id: 2, status: "WIP" })];
      expect(applyOperationsFilters(tasks, null, NO_FILTERS)).toHaveLength(2);
    });
  });

  describe("project filter", () => {
    it("keeps only tasks whose parent project matches one of the selected ids", () => {
      const tasks = [
        task({ id: 1, parentProject: { lookupId: 10, title: "P1" } }),
        task({ id: 2, parentProject: { lookupId: 20, title: "P2" } }),
        task({ id: 3, parentProject: null }),
      ];
      const out = applyOperationsFilters(tasks, null, { ...NO_FILTERS, projectIds: [10] });
      expect(out.map((t) => t.id)).toEqual([1]);
    });

    it("empty projectIds means no project filter", () => {
      const tasks = [task({ parentProject: null }), task({ id: 2, parentProject: null })];
      expect(applyOperationsFilters(tasks, null, { ...NO_FILTERS, projectIds: [] })).toHaveLength(2);
    });
  });

  describe("assigned filter (single-person)", () => {
    it("matches the single assignee's email", () => {
      const tasks = [
        task({ id: 1, assigned: ALICE }),
        task({ id: 2, assigned: BOB }),
        task({ id: 3, assigned: null }),
      ];
      const out = applyOperationsFilters(tasks, null, { ...NO_FILTERS, assignedEmails: ["alice@x.com"] });
      expect(out.map((t) => t.id)).toEqual([1]);
    });

    it("excludes unassigned tasks when an assigned filter is set", () => {
      const out = applyOperationsFilters([task({ assigned: null })], null, {
        ...NO_FILTERS,
        assignedEmails: ["alice@x.com"],
      });
      expect(out).toEqual([]);
    });

    it("falls back to displayName when assignee has no email", () => {
      const out = applyOperationsFilters([task({ assigned: CAROL_NO_EMAIL })], null, {
        ...NO_FILTERS,
        assignedEmails: ["Carol"],
      });
      expect(out).toHaveLength(1);
    });

    it("empty assignedEmails means no assigned filter", () => {
      expect(
        applyOperationsFilters([task({ assigned: null })], null, {
          ...NO_FILTERS,
          assignedEmails: [],
        }),
      ).toHaveLength(1);
    });
  });

  describe("createdBy filter", () => {
    it("matches against the assignee + watchers (best-effort)", () => {
      const tasks = [task({ id: 1, watchers: [ALICE] }), task({ id: 2, assigned: BOB })];
      const out = applyOperationsFilters(tasks, null, { ...NO_FILTERS, createdByEmail: "alice@x.com" });
      expect(out.map((t) => t.id)).toEqual([1]);
    });
  });

  describe("search filter", () => {
    it("matches title, taskNumber, description, and stripped comment text", () => {
      expect(
        applyOperationsFilters([task({ title: "Conveyor Install" })], null, {
          ...NO_FILTERS,
          search: "conveyor",
        }),
      ).toHaveLength(1);
      expect(
        applyOperationsFilters([task({ taskNumber: "Task 0002-4" })], null, {
          ...NO_FILTERS,
          search: "0002-4",
        }),
      ).toHaveLength(1);
      expect(
        applyOperationsFilters(
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
        ),
      ).toHaveLength(1);
    });

    it("returns nothing when search needle has no match", () => {
      const out = applyOperationsFilters([task({ title: "Foo" })], null, {
        ...NO_FILTERS,
        search: "bar",
      });
      expect(out).toEqual([]);
    });
  });

  it("combines multiple filters with AND semantics", () => {
    const tasks = [
      task({ id: 1, assigned: ALICE, parentProject: { lookupId: 10, title: "P" }, title: "Match" }),
      task({ id: 2, assigned: ALICE, parentProject: { lookupId: 20, title: "Q" }, title: "Match" }),
      task({ id: 3, assigned: BOB, parentProject: { lookupId: 10, title: "P" }, title: "Match" }),
    ];
    const out = applyOperationsFilters(tasks, null, {
      ...NO_FILTERS,
      projectIds: [10],
      assignedEmails: ["alice@x.com"],
      search: "match",
    });
    expect(out.map((t) => t.id)).toEqual([1]);
  });
});
