import { describe, expect, it } from "vitest";
import type { PanelTask, PanelTaskStatus, Person } from "@/types/task";
import {
  buildChainOpenedEmails,
  chainStartStatus,
  chainTasksReadyToOpen,
  chainWaitingOn,
  holdWrites,
  orderHoldChange,
  releaseWrites,
  tasksOpenedBy,
} from "./panelOrderChain";

const ANA: Person = { displayName: "Ana Ruiz", email: "ana.ruiz@example.com" };
const BEN: Person = { displayName: "Ben Okafor", email: "ben.okafor@example.com" };

function task(
  id: number,
  status: PanelTaskStatus,
  chainStep: number | null,
  orderId: number | null = 12,
  over: Partial<PanelTask> = {},
): PanelTask {
  return {
    id,
    title: `Task ${id}`,
    status,
    taskType: null,
    workType: null,
    priority: null,
    projectRef: null,
    orderRef: orderId === null ? null : { lookupId: orderId, title: "" },
    chainStep,
    statusBeforeHold: null,
    sapNumber: "",
    assigned: [],
    description: "",
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    watchers: [],
    comments: [],
    hasAttachments: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    author: null,
    ...over,
  };
}

/** Drawing (1) → BOM (2) → SOO (3) → Programming (4), as a new order raises them. */
const chain = (s1: PanelTaskStatus, s2: PanelTaskStatus, s3: PanelTaskStatus, s4: PanelTaskStatus) => [
  task(1, s1, 1),
  task(2, s2, 2),
  task(3, s3, 3),
  task(4, s4, 4),
];

describe("chainStartStatus", () => {
  it("raises the first step as New and the rest as Awaiting Pre-Req", () => {
    const batch = [1, 2, 3, 4].map((step) => task(0, "New", step));
    expect([1, 2, 3, 4].map((step) => chainStartStatus(step, 12, batch))).toEqual([
      "New",
      "Awaiting Pre-Req",
      "Awaiting Pre-Req",
      "Awaiting Pre-Req",
    ]);
  });

  it("raises a missing step as New once everything before it is done", () => {
    const existing = [task(1, "Completed", 1), task(2, "Canceled", 2)];
    expect(chainStartStatus(3, 12, existing)).toBe("New");
  });

  it("makes a missing step wait behind an earlier one still to do", () => {
    expect(chainStartStatus(3, 12, [task(1, "In Progress", 1)])).toBe("Awaiting Pre-Req");
  });

  it("ignores another order's tasks and tasks outside the chain", () => {
    const others = [task(1, "In Progress", 1, 99), task(2, "In Progress", null)];
    expect(chainStartStatus(2, 12, others)).toBe("New");
  });

  it("lets steps sharing a number start together", () => {
    expect(chainStartStatus(2, 12, [task(1, "New", 2)])).toBe("New");
  });
});

describe("tasksOpenedBy", () => {
  it("opens the next step when one is Completed", () => {
    const tasks = chain("Completed", "Awaiting Pre-Req", "Awaiting Pre-Req", "Awaiting Pre-Req");
    expect(tasksOpenedBy(tasks[0], tasks).map((t) => t.id)).toEqual([2]);
  });

  it("treats a Canceled step as done, so the job isn't stuck", () => {
    const tasks = chain("Canceled", "Awaiting Pre-Req", "Awaiting Pre-Req", "Awaiting Pre-Req");
    expect(tasksOpenedBy(tasks[0], tasks).map((t) => t.id)).toEqual([2]);
  });

  it("opens nothing while an earlier step is still to do", () => {
    // BOM finished by hand before Drawing: SOO still waits for Drawing.
    const tasks = chain("In Progress", "Completed", "Awaiting Pre-Req", "Awaiting Pre-Req");
    expect(tasksOpenedBy(tasks[1], tasks)).toEqual([]);
  });

  it("never reopens a step somebody already started", () => {
    const tasks = chain("Completed", "In Progress", "Awaiting Pre-Req", "Awaiting Pre-Req");
    expect(tasksOpenedBy(tasks[0], tasks)).toEqual([]);
  });

  it("opens nothing when the changed task isn't done, or isn't chained", () => {
    const tasks = chain("In Progress", "Awaiting Pre-Req", "Awaiting Pre-Req", "Awaiting Pre-Req");
    expect(tasksOpenedBy(tasks[0], tasks)).toEqual([]);
    const loose = task(9, "Completed", null);
    expect(tasksOpenedBy(loose, [...tasks, loose])).toEqual([]);
  });

  it("only opens tasks of the same order", () => {
    const other = task(20, "Awaiting Pre-Req", 2, 99);
    const tasks = [...chain("Completed", "Awaiting Pre-Req", "Awaiting Pre-Req", "Awaiting Pre-Req"), other];
    expect(tasksOpenedBy(tasks[0], tasks).map((t) => t.id)).toEqual([2]);
  });
});

describe("chainTasksReadyToOpen", () => {
  it("finds a step whose turn came while the order was held", () => {
    const tasks = chain("Completed", "Awaiting Pre-Req", "Awaiting Pre-Req", "Awaiting Pre-Req");
    expect(chainTasksReadyToOpen(12, tasks).map((t) => t.id)).toEqual([2]);
  });
});

describe("chainWaitingOn", () => {
  it("names the earlier steps still to do", () => {
    const tasks = chain("Completed", "In Progress", "Awaiting Pre-Req", "Awaiting Pre-Req");
    expect(chainWaitingOn(tasks[3], tasks).map((t) => t.id)).toEqual([2, 3]);
  });

  it("is empty for a task that isn't waiting", () => {
    const tasks = chain("In Progress", "Awaiting Pre-Req", "Awaiting Pre-Req", "Awaiting Pre-Req");
    expect(chainWaitingOn(tasks[0], tasks)).toEqual([]);
  });
});

describe("orderHoldChange", () => {
  it("holds going On Hold and releases coming off it", () => {
    expect(orderHoldChange("In Engineering", "On Hold")).toBe("hold");
    expect(orderHoldChange("On Hold", "In Engineering")).toBe("release");
    expect(orderHoldChange("On Hold", "On Hold")).toBeNull();
    expect(orderHoldChange("Submitted", "In Engineering")).toBeNull();
  });
});

describe("holdWrites", () => {
  it("puts each open task On Hold - Internal and remembers its status", () => {
    const tasks = [
      task(1, "Completed", 1),
      task(2, "In Progress", 2),
      task(3, "Awaiting Pre-Req", 3),
      task(4, "Canceled", 4),
      task(5, "On Hold - Approval", null),
      task(6, "Ready", null, 99),
    ];
    expect(holdWrites(12, tasks)).toEqual([
      { id: 2, fields: { Status: "On Hold - Internal", StatusBeforeHold: "In Progress" } },
      { id: 3, fields: { Status: "On Hold - Internal", StatusBeforeHold: "Awaiting Pre-Req" } },
    ]);
  });

  it("never overwrites a status it is already remembering", () => {
    const held = task(2, "On Hold - Internal", 2, 12, { statusBeforeHold: "In Progress" });
    // Moved by hand while held, then the order is set On Hold again: the
    // remembered status stays the one the order's hold took away.
    const moved = task(3, "Ready", 3, 12, { statusBeforeHold: "Awaiting Pre-Req" });
    expect(holdWrites(12, [held, moved])).toEqual([]);
  });
});

describe("releaseWrites", () => {
  it("gives each held task its own status back and clears the memory", () => {
    const tasks = [
      task(2, "On Hold - Internal", 2, 12, { statusBeforeHold: "In Progress" }),
      task(3, "On Hold - Internal", 3, 12, { statusBeforeHold: "Awaiting Pre-Req" }),
      task(4, "Completed", 4),
    ];
    expect(releaseWrites(12, tasks)).toEqual([
      { id: 2, fields: { Status: "In Progress", StatusBeforeHold: null } },
      { id: 3, fields: { Status: "Awaiting Pre-Req", StatusBeforeHold: null } },
    ]);
  });

  it("leaves a task somebody moved by hand where they put it", () => {
    const moved = task(2, "Completed", 2, 12, { statusBeforeHold: "In Progress" });
    expect(releaseWrites(12, [moved])).toEqual([{ id: 2, fields: { StatusBeforeHold: null } }]);
  });
});

describe("buildChainOpenedEmails", () => {
  it("tells each assignee once, but not the person who finished the step before", () => {
    const opened = task(2, "Ready", 2, 12, { title: "BOM Creation", assigned: [ANA, BEN, { ...BEN }] });
    const emails = buildChainOpenedEmails({ task: opened, after: { title: "Drawing Creation" }, actor: ANA });
    expect(emails.map((e) => e.email)).toEqual([BEN.email]);
    expect(emails[0].subject).toBe("Ready to start: BOM Creation");
    expect(emails[0].headlineHtml).toContain("<strong>Drawing Creation</strong> is done");
  });

  it("sends nothing for a task nobody is assigned to", () => {
    const opened = task(2, "Ready", 2);
    expect(buildChainOpenedEmails({ task: opened, after: { title: "x" }, actor: ANA })).toEqual([]);
  });
});
