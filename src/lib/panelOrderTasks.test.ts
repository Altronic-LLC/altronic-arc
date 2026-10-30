import { describe, expect, it } from "vitest";
import type { PanelTask, PanelTaskTemplate, Person } from "@/types/task";
import {
  DEFAULT_PANEL_TASK_TEMPLATES,
  activeTemplates,
  buildOrderTasksAssignedEmails,
  missingTemplates,
  panelTaskTemplateProblem,
  standardTaskInputs,
  standardTaskTitle,
  tasksForOrder,
} from "./panelOrderTasks";

const ANA: Person = { displayName: "Ana Ruiz", email: "ana.ruiz@example.com", lookupId: 7 };
const BEN: Person = { displayName: "Ben Okafor", email: "ben.okafor@example.com" };

const TEMPLATES: PanelTaskTemplate[] = DEFAULT_PANEL_TASK_TEMPLATES.map((t, i) => ({ ...t, id: i + 1 }));
const ORDER = {
  id: 12,
  title: "Skid panel build",
  projectRef: { lookupId: 3, title: "P-0001" },
  sapNumber: "9200-0004-00",
};

function task(id: number, title: string, orderId: number | null): PanelTask {
  return {
    id,
    title,
    status: "New",
    taskType: null,
    workType: null,
    priority: null,
    projectRef: null,
    orderRef: orderId === null ? null : { lookupId: orderId, title: "" },
    chainStep: null,
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
  };
}

describe("the default templates", () => {
  it("are Wrike's blueprint: four tasks with their usual hours", () => {
    expect(DEFAULT_PANEL_TASK_TEMPLATES.map((t) => [t.title, t.taskType, t.estimatedHours])).toEqual([
      ["Drawing Creation", "Drawings", 24],
      ["BOM Creation", "BOM", 2],
      ["SOO Creation", "SOO", 6],
      ["Programming", "Programming", 16],
    ]);
  });
});

describe("activeTemplates", () => {
  it("keeps active, named rows in SortOrder", () => {
    const rows: PanelTaskTemplate[] = [
      { ...TEMPLATES[0], id: 1, sortOrder: 3 },
      { ...TEMPLATES[1], id: 2, sortOrder: 1 },
      { ...TEMPLATES[2], id: 3, sortOrder: 2, active: false },
      { ...TEMPLATES[3], id: 4, sortOrder: 0, title: "  " },
    ];
    expect(activeTemplates(rows).map((t) => t.id)).toEqual([2, 1]);
  });
});

describe("standardTaskTitle", () => {
  it("leads with the project reference, like Wrike's Job #", () => {
    expect(standardTaskTitle(ORDER, { title: "BOM Creation" })).toBe("P-0001 — BOM Creation");
  });

  it("falls back to the order title with no project", () => {
    expect(standardTaskTitle({ ...ORDER, projectRef: null }, { title: "BOM Creation" })).toBe(
      "Skid panel build — BOM Creation",
    );
  });
});

describe("standardTaskInputs", () => {
  it("assigns every task to the order's engineer", () => {
    const inputs = standardTaskInputs(ORDER, TEMPLATES, ANA);
    expect(inputs).toHaveLength(4);
    expect(inputs.every((i) => i.assigned.length === 1 && i.assigned[0] === ANA)).toBe(true);
    expect(inputs[0]).toEqual({
      title: "P-0001 — Drawing Creation",
      taskType: "Drawings",
      workType: "Production Order",
      estimatedHours: 24,
      projectLookupId: 3,
      orderLookupId: 12,
      chainStep: 1,
      sapNumber: "9200-0004-00",
      assigned: [ANA],
    });
    // The chain runs in template order.
    expect(inputs.map((i) => i.chainStep)).toEqual([1, 2, 3, 4]);
  });

  it("leaves every task unassigned when the order has no engineer", () => {
    expect(standardTaskInputs(ORDER, TEMPLATES, null).every((i) => i.assigned.length === 0)).toBe(true);
  });
});

describe("tasksForOrder", () => {
  it("keeps only the order's tasks, oldest first", () => {
    const tasks = [task(5, "b", 12), task(2, "a", 12), task(3, "other", 99), task(4, "loose", null)];
    expect(tasksForOrder(tasks, 12).map((t) => t.id)).toEqual([2, 5]);
  });
});

describe("missingTemplates", () => {
  it("returns only the standard tasks the order hasn't got", () => {
    const existing = [task(1, "P-0001 — Drawing Creation", 12), task(2, "p-0001 — bom creation ", 12)];
    expect(missingTemplates(ORDER, TEMPLATES, existing).map((t) => t.title)).toEqual([
      "SOO Creation",
      "Programming",
    ]);
  });

  it("returns them all for an order with no tasks", () => {
    expect(missingTemplates(ORDER, TEMPLATES, [])).toHaveLength(4);
  });
});

describe("panelTaskTemplateProblem", () => {
  it("needs a name", () => {
    expect(panelTaskTemplateProblem({ title: " ", taskType: null, estimatedHours: 2 })).toMatch(/name/);
  });

  it("refuses a type Panel Tasks don't have", () => {
    expect(panelTaskTemplateProblem({ title: "x", taskType: "Welding", estimatedHours: null })).toMatch(
      /isn't a Panel Task type/,
    );
  });

  it("refuses negative, unreadable or huge hours", () => {
    expect(panelTaskTemplateProblem({ title: "x", taskType: null, estimatedHours: -1 })).toBeTruthy();
    expect(panelTaskTemplateProblem({ title: "x", taskType: null, estimatedHours: Number.NaN })).toBeTruthy();
    expect(panelTaskTemplateProblem({ title: "x", taskType: null, estimatedHours: 2001 })).toBeTruthy();
  });

  it("accepts blank hours and a known type", () => {
    expect(panelTaskTemplateProblem({ title: "x", taskType: "BOM", estimatedHours: null })).toBeNull();
  });
});

describe("buildOrderTasksAssignedEmails", () => {
  const tasks = [
    { id: 21, title: "P-0001 — Drawing Creation", estimatedHours: 24 },
    { id: 22, title: "P-0001 — BOM Creation", estimatedHours: 2 },
  ];

  it("sends the engineer ONE email listing every task, linked", () => {
    const emails = buildOrderTasksAssignedEmails({ order: ORDER, tasks, engineer: ANA, actor: BEN });
    expect(emails).toHaveLength(1);
    expect(emails[0].email).toBe(ANA.email);
    expect(emails[0].subject).toBe("You've been assigned to Skid panel build and its 2 tasks");
    expect(emails[0].detailHtml).toContain("/panels/task/21");
    expect(emails[0].detailHtml).toContain("P-0001 — BOM Creation</a> — 2h");
  });

  it("says the tasks were ADDED when raised from the order's page", () => {
    const [email] = buildOrderTasksAssignedEmails({ order: ORDER, tasks, engineer: ANA, actor: BEN, when: "added" });
    expect(email.subject).toBe("You've been assigned 2 tasks on Skid panel build");
    expect(email.headlineHtml).toMatch(/added 2 standard tasks/);
  });

  it("sends nothing with no engineer, no address, or to the engineer who raised it", () => {
    expect(buildOrderTasksAssignedEmails({ order: ORDER, tasks, engineer: null, actor: BEN })).toEqual([]);
    expect(
      buildOrderTasksAssignedEmails({ order: ORDER, tasks, engineer: { displayName: "No Mail" }, actor: BEN }),
    ).toEqual([]);
    expect(buildOrderTasksAssignedEmails({ order: ORDER, tasks, engineer: ANA, actor: ANA })).toEqual([]);
  });

  it("escapes the titles", () => {
    const [email] = buildOrderTasksAssignedEmails({
      order: ORDER,
      tasks: [{ id: 1, title: "<b>x</b>", estimatedHours: null }],
      engineer: ANA,
      actor: BEN,
    });
    expect(email.detailHtml).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
