import { describe, it, expect } from "vitest";
import type { Comment, Task } from "@/types/task";
import {
  earlierLinkedComments,
  isUnlinkedBuildRequest,
  taskForBuildRequest,
  taskLinkOptions,
} from "./buildRequestTaskLink";
import { buildMirroredBody } from "./commentMirror";

function task(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    numberedTitle: `T${id}-0017-Task ${id}`,
    status: "BACKLOG",
    parentProject: null,
    comments: [],
    ...over,
  } as Task;
}

function comment(over: Partial<Comment> = {}): Comment {
  return {
    timestamp: new Date("2026-10-01T12:00:00Z"),
    authorName: "Ray White",
    authorEmail: "ray.white@altronic-llc.com",
    bodyHtml: "<p>Board revision C is in.</p>",
    ...over,
  };
}

describe("taskLinkOptions", () => {
  const project17 = { lookupId: 17, title: "0017-AMP" };
  const project20 = { lookupId: 20, title: "0020-HUB" };

  it("lists open tasks in the build request's project first, then other open ones, then Complete", () => {
    const tasks = [
      task(1, { parentProject: project20 }),
      task(2, { parentProject: project17, status: "Complete" }),
      task(3, { parentProject: project17 }),
      task(4),
      task(5, { parentProject: project17 }),
    ];
    expect(taskLinkOptions(tasks, [17]).map((o) => o.value)).toEqual(["5", "3", "4", "1", "2"]);
  });

  it("marks a Complete task in its label", () => {
    const [opt] = taskLinkOptions([task(2, { status: "Complete" })], []);
    expect(opt.label).toBe("T2-0017-Task 2 (Complete)");
  });

  it("offers every task — ordering only, nothing dropped", () => {
    expect(taskLinkOptions([task(1), task(2), task(3)], [])).toHaveLength(3);
  });
});

describe("taskForBuildRequest", () => {
  const project = { lookupId: 17, title: "0017-AMP 5000" };

  it("numbers the new task in the project and names the build request", () => {
    const existing = [task(1, { parentProject: project }), task(2, { parentProject: project })];
    const draft = taskForBuildRequest({
      title: " HUB V4 ",
      brNo: "BR_2026-0090",
      project,
      engineer: null,
      allTasks: existing,
    });
    expect(draft).toEqual({
      title: "HUB V4",
      numberedTitle: "T3-0017-HUB V4",
      description: "Created for build request BR_2026-0090.",
      parentProjectLookupId: 17,
      assigned: [],
    });
  });

  it("assigns the build request's engineer when one was picked", () => {
    const engineer = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
    const draft = taskForBuildRequest({ title: "X", brNo: "B", project, engineer, allTasks: [] });
    expect("assigned" in draft && draft.assigned).toEqual([engineer]);
  });

  it("refuses with no project — the number would read as project 0000", () => {
    const draft = taskForBuildRequest({ title: "X", brNo: "B", project: null, engineer: null, allTasks: [] });
    expect(draft).toEqual({ problem: expect.stringMatching(/project reference/i) });
  });

  it("refuses with no title", () => {
    const draft = taskForBuildRequest({ title: "  ", brNo: "B", project, engineer: null, allTasks: [] });
    expect(draft).toEqual({ problem: expect.stringMatching(/name/i) });
  });
});

describe("isUnlinkedBuildRequest", () => {
  it("is true only when no task is named", () => {
    expect(isUnlinkedBuildRequest({ taskReferenceLookupId: null })).toBe(true);
    expect(isUnlinkedBuildRequest({ taskReferenceLookupId: 12 })).toBe(false);
  });
});

describe("earlierLinkedComments", () => {
  it("shows the other record's own comments that aren't here", () => {
    const other = [comment()];
    expect(earlierLinkedComments(other, [])).toEqual(other);
  });

  it("leaves out a comment already here — the mirror's copy, matched by author and words, not time", () => {
    const original = comment();
    const mirrorHere = comment({
      timestamp: new Date("2026-10-01T12:00:03Z"),
      bodyHtml: buildMirroredBody(original.bodyHtml, { kind: "task", id: 12, label: "T12" }),
    });
    expect(earlierLinkedComments([original], [mirrorHere])).toEqual([]);
  });

  it("leaves out copies the other record holds — they came from somewhere else", () => {
    const mirrored = comment({
      bodyHtml: buildMirroredBody("<p>From a part</p>", {
        kind: "buildRequestItem",
        id: 4,
        label: "671001-01",
      }),
    });
    expect(earlierLinkedComments([mirrored], [])).toEqual([]);
  });

  it("leaves out ARC's 'Raised from task' note", () => {
    const note = comment({ bodyHtml: "<p><em>Raised from task <strong>T3</strong>.</em></p>" });
    expect(earlierLinkedComments([note], [])).toEqual([]);
  });

  it("leaves out the discussion a build request carried over when raised from the task", () => {
    // The carried copy keeps the original author and words, so it matches.
    const onTask = comment({ bodyHtml: "<p>Use the new connector.</p>" });
    const carriedOnBr = comment({ bodyHtml: "<p>Use the new connector.</p>" });
    expect(earlierLinkedComments([onTask], [carriedOnBr])).toEqual([]);
  });

  it("keeps the same words from a DIFFERENT author", () => {
    const other = [comment({ authorEmail: "glenn.terry@altronic-llc.com", authorName: "Glenn Terry" })];
    expect(earlierLinkedComments(other, [comment()])).toHaveLength(1);
  });

  it("orders newest first", () => {
    const older = comment({ bodyHtml: "<p>a</p>", timestamp: new Date("2026-09-01T12:00:00Z") });
    const newer = comment({ bodyHtml: "<p>b</p>", timestamp: new Date("2026-10-01T12:00:00Z") });
    expect(earlierLinkedComments([older, newer], [])).toEqual([newer, older]);
  });
});
