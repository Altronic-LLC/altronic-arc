import { describe, expect, it } from "vitest";
import {
  buildCarriedCommunication,
  buildRequestForTask,
  buildRequestPrefillFromTask,
  buildRequestsForTask,
  taskLabel,
} from "./buildRequestFromTask";
import { parseCommunication } from "./communicationParser";
import type { BuildRequest, Comment, Task } from "@/types/task";

// =============================================================================
// Raising a Build Request from a task.
//
// Ray, 2026-09-20: "a clean way to create a build request from a task... linked
// back and forth from task and build request and copy task comments to the
// build request comments."
//
// The cases worth pinning are the ones where a carried thread would be WORSE
// than no thread: an inverted timeline, comments re-credited to whoever
// pressed the button, or a link that points at the wrong record.
// =============================================================================

function comment(overrides: Partial<Comment> & { timestamp: Date }): Comment {
  return {
    authorName: "Sarah Shaffer",
    authorEmail: "sarah.shaffer@altronic-llc.com",
    bodyHtml: "<p>a comment</p>",
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 47,
    title: "HUB V4 refresh",
    numberedTitle: "T3-0017-HUB V4 refresh",
    description: "",
    status: "In Progress",
    priority: null,
    category: null,
    labels: [],
    dueDate: null,
    assigned: [],
    watchers: [],
    parentProject: { lookupId: 12, title: "0017 — HUB" },
    relatedProjects: [],
    parentTask: null,
    childTasks: [],
    comments: [],
    hasAttachments: false,
    eirReference: null,
    softwareRevision: null,
    ...overrides,
  } as unknown as Task;
}

const RAISED_BY = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const NOW = new Date("2026-09-20T15:00:00Z");

describe("taskLabel", () => {
  it("prefers the numbered title — that's how people refer to a task", () => {
    expect(taskLabel(task())).toBe("T3-0017-HUB V4 refresh");
  });

  it("falls back to the plain title, then to the id", () => {
    expect(taskLabel(task({ numberedTitle: "" }))).toBe("HUB V4 refresh");
    expect(taskLabel(task({ numberedTitle: "", title: "" }))).toBe("Task #47");
  });
});

describe("buildCarriedCommunication", () => {
  it("writes a header saying where the build request came from", () => {
    const out = buildCarriedCommunication({ task: task(), raisedBy: RAISED_BY, now: NOW });
    const parsed = parseCommunication(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].bodyHtml).toContain("Raised from task");
    expect(parsed[0].bodyHtml).toContain("T3-0017-HUB V4 refresh");
    expect(parsed[0].authorName).toBe("Ray White");
  });

  it("does NOT promise a carried discussion when there are no comments", () => {
    const out = buildCarriedCommunication({ task: task(), raisedBy: RAISED_BY, now: NOW });
    expect(out).not.toContain("carried over below");
  });

  it("carries every comment across", () => {
    const t = task({
      comments: [
        comment({ timestamp: new Date("2026-09-02T10:00:00Z"), bodyHtml: "<p>second</p>" }),
        comment({ timestamp: new Date("2026-09-01T10:00:00Z"), bodyHtml: "<p>first</p>" }),
      ],
    });
    const parsed = parseCommunication(
      buildCarriedCommunication({ task: t, raisedBy: RAISED_BY, now: NOW }),
    );
    // Two carried + the header.
    expect(parsed).toHaveLength(3);
    expect(parsed.map((c) => c.bodyHtml).join("")).toContain("first");
    expect(parsed.map((c) => c.bodyHtml).join("")).toContain("second");
  });

  it("stores them OLDEST-first, so the thread isn't inverted", () => {
    // The parser hands comments back NEWEST-first. Writing them out in that
    // display order would store the thread backwards — the bug this pins.
    const t = task({
      comments: [
        comment({ timestamp: new Date("2026-09-02T10:00:00Z"), bodyHtml: "<p>second</p>" }),
        comment({ timestamp: new Date("2026-09-01T10:00:00Z"), bodyHtml: "<p>first</p>" }),
      ],
    });
    const raw = buildCarriedCommunication({ task: t, raisedBy: RAISED_BY, now: NOW });
    expect(raw.indexOf("first")).toBeLessThan(raw.indexOf("second"));
  });

  it("KEEPS each comment's original author and timestamp", () => {
    // A carried comment is a record of what was said, not a re-post by
    // whoever pressed the button. Re-stamping would credit the wrong person
    // and collapse the whole timeline onto one instant.
    const when = new Date("2026-09-01T14:30:00Z");
    const t = task({
      comments: [
        comment({
          timestamp: when,
          authorName: "Jerrod Waldron",
          authorEmail: "jerrod.waldron@altronic-llc.com",
        }),
      ],
    });
    const parsed = parseCommunication(
      buildCarriedCommunication({ task: t, raisedBy: RAISED_BY, now: NOW }),
    );
    const carried = parsed.find((c) => c.authorName === "Jerrod Waldron");
    expect(carried).toBeDefined();
    expect(carried!.authorEmail).toBe("jerrod.waldron@altronic-llc.com");
    expect(carried!.timestamp.getTime()).toBe(when.getTime());
  });

  it("escapes the task label rather than injecting it as markup", () => {
    const t = task({ numberedTitle: '<img src=x onerror="alert(1)">' });
    const out = buildCarriedCommunication({ task: t, raisedBy: RAISED_BY, now: NOW });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("falls back to an author name rather than writing an empty one", () => {
    const out = buildCarriedCommunication({
      task: task(),
      raisedBy: { displayName: "", email: undefined },
      now: NOW,
    });
    expect(parseCommunication(out)[0].authorName).toBe("ARC");
  });
});

describe("buildRequestPrefillFromTask", () => {
  it("prefills the plain title, NOT the numbered one", () => {
    // The BR's Title column is "Product or Project Name". "T3-0017-…" is a
    // task identifier and means nothing on a build request.
    expect(buildRequestPrefillFromTask(task()).title).toBe("HUB V4 refresh");
  });

  it("carries the parent project across", () => {
    expect(buildRequestPrefillFromTask(task()).parentProjectLookupIds).toEqual([12]);
  });

  it("carries no project when the task has none", () => {
    expect(
      buildRequestPrefillFromTask(task({ parentProject: null })).parentProjectLookupIds,
    ).toEqual([]);
  });

  it("points the task reference at the task's own id", () => {
    expect(buildRequestPrefillFromTask(task()).taskReferenceLookupId).toBe(47);
  });

  it("does NOT carry status, assignee or dates", () => {
    // Each is a deliberate omission — a task's workflow, engineer and due
    // date are not a build request's. Pinned so a later "helpful" addition
    // has to argue with a test.
    const prefill = buildRequestPrefillFromTask(
      task({ status: "On Hold", dueDate: new Date("2026-10-01T12:00:00Z") }),
    );
    expect(Object.keys(prefill).sort()).toEqual([
      "parentProjectLookupIds",
      "taskReferenceLookupId",
      "title",
    ]);
  });
});

function br(id: number, taskId: number | null): BuildRequest {
  return { id, brNo: `BR-${id}`, taskReferenceLookupId: taskId } as unknown as BuildRequest;
}

describe("deriving the reverse link", () => {
  const all = [br(1, 47), br(2, 99), br(3, 47), br(4, null)];

  it("finds the build requests raised from a task", () => {
    expect(buildRequestsForTask(all, 47).map((b) => b.id)).toEqual([3, 1]);
  });

  it("returns them NEWEST first", () => {
    // A task re-raised after a cancelled BR should lead with the current one.
    expect(buildRequestForTask(all, 47)?.id).toBe(3);
  });

  it("returns nothing for a task with no build request", () => {
    expect(buildRequestsForTask(all, 1234)).toEqual([]);
    expect(buildRequestForTask(all, 1234)).toBeNull();
  });

  it("never matches a build request with NO task reference", () => {
    // `null === null` would otherwise link every unlinked BR to every task
    // whose id we failed to resolve.
    expect(buildRequestsForTask(all, null)).toEqual([]);
    expect(buildRequestForTask(all, null)).toBeNull();
  });
});
