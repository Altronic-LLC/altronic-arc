import { describe, expect, it } from "vitest";
import type { Comment, PanelOrder, PanelProject, PanelTask } from "@/types/task";
import {
  isPanelOrderOpen,
  narrowToCustomer,
  NO_CUSTOMER,
  ordersForProject,
  panelProjectLabel,
  panelProjectPath,
  projectCommunications,
  projectCustomers,
  summarisePanelProjects,
  tasksForProject,
} from "./panelProjectDashboard";

const at = (iso: string) => new Date(iso);
const comment = (iso: string, body = "hi"): Comment => ({
  timestamp: at(iso),
  authorName: "Pat Example",
  authorEmail: "pat@example.com",
  bodyHtml: `<p>${body}</p>`,
});

function order(id: number, projectId: number | null, extra: Partial<PanelOrder> = {}): PanelOrder {
  return {
    id,
    title: `Order ${id}`,
    status: "Submitted",
    projectRef: projectId === null ? null : { lookupId: projectId, title: `P-${projectId}` },
    salesOrder: "",
    sapNumber: "",
    drawingNumber: "",
    purchaseOrder: "",
    customerReference: "",
    customer: "",
    customerContactEmail: "",
    orderNotes: "",
    engineerAssigned: null,
    watchers: [],
    comments: [],
    hasAttachments: false,
    createdAt: at("2026-01-01T12:00:00Z"),
    modifiedAt: at("2026-01-01T12:00:00Z"),
    author: null,
    archived: false,
    legacySource: "",
    legacyCreatedAt: null,
    ...extra,
  };
}

function task(id: number, projectId: number | null, orderId: number | null, extra: Partial<PanelTask> = {}): PanelTask {
  return {
    id,
    title: `Task ${id}`,
    status: "New",
    taskType: null,
    workType: null,
    priority: null,
    projectRef: projectId === null ? null : { lookupId: projectId, title: `P-${projectId}` },
    orderRef: orderId === null ? null : { lookupId: orderId, title: `Order ${orderId}` },
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
    createdAt: at("2026-01-01T12:00:00Z"),
    modifiedAt: at("2026-01-01T12:00:00Z"),
    author: null,
    ...extra,
  };
}

const project = (id: number, extra: Partial<PanelProject> = {}): PanelProject => ({
  id,
  title: `P-${id}`,
  projectType: null,
  description: "",
  dwgNo: "",
  customer: "",
  department: null,
  ...extra,
});

describe("ordersForProject", () => {
  it("keeps the project's orders, newest first by when they were created (the old list's date for a moved one)", () => {
    const orders = [
      order(1, 7, { createdAt: at("2026-03-01T00:00:00Z") }),
      order(2, 8),
      order(3, 7, { createdAt: at("2026-01-01T00:00:00Z"), legacyCreatedAt: at("2026-05-01T00:00:00Z") }),
      order(4, null),
    ];
    expect(ordersForProject(orders, 7).map((o) => o.id)).toEqual([3, 1]);
  });
});

describe("tasksForProject", () => {
  it("takes the project's own tasks AND those raised for its orders, even if their project differs", () => {
    const tasks = [task(1, 7, null), task(2, 9, 50), task(3, 9, 51), task(4, null, null)];
    expect(tasksForProject(tasks, 7, new Set([50])).map((t) => t.id)).toEqual([1, 2]);
  });
});

describe("projectCommunications", () => {
  it("merges order and task comments newest first, each naming where it was posted", () => {
    const o = order(1, 7, { comments: [comment("2026-02-01T00:00:00Z", "old")] });
    const t = task(5, 7, 1, { comments: [comment("2026-04-01T00:00:00Z", "new")] });
    const out = projectCommunications([o], [t]);
    expect(out.map((c) => c.source)).toEqual([
      { kind: "task", id: 5, title: "Task 5" },
      { kind: "order", id: 1, title: "Order 1" },
    ]);
  });
});

describe("isPanelOrderOpen", () => {
  it("is false for a shipped or archived order", () => {
    expect(isPanelOrderOpen(order(1, 7))).toBe(true);
    expect(isPanelOrderOpen(order(1, 7, { status: "Shipped" }))).toBe(false);
    expect(isPanelOrderOpen(order(1, 7, { archived: true }))).toBe(false);
  });
});

describe("summarisePanelProjects", () => {
  it("counts orders, open orders and open tasks per project, and the latest activity", () => {
    const orders = [
      order(1, 7, { modifiedAt: at("2026-03-01T00:00:00Z") }),
      order(2, 7, { status: "Shipped", comments: [comment("2026-06-01T00:00:00Z")] }),
    ];
    const tasks = [
      task(10, 7, 1),
      task(11, 7, null, { status: "Completed" }),
      // Raised for order 1 but carrying another project — still project 7's.
      task(12, 9, 1),
    ];
    const [p7, p9, p3] = summarisePanelProjects([project(7), project(9), project(3)], orders, tasks);
    expect(p7).toMatchObject({ orders: 2, openOrders: 1, openTasks: 2, comments: 1 });
    expect(p7.lastActivity).toEqual(at("2026-06-01T00:00:00Z"));
    expect(p9).toMatchObject({ orders: 0, openTasks: 1 });
    expect(p3).toMatchObject({ orders: 0, openOrders: 0, openTasks: 0, lastActivity: null });
  });

  it("counts a task once when its project and its order's project are the same", () => {
    const [p7] = summarisePanelProjects([project(7)], [order(1, 7)], [task(10, 7, 1)]);
    expect(p7.openTasks).toBe(1);
  });

  it("ignores orders and tasks pointing at a project that isn't on the list", () => {
    const [p7] = summarisePanelProjects([project(7)], [order(1, 99)], [task(10, 99, null)]);
    expect(p7).toMatchObject({ orders: 0, openTasks: 0 });
  });
});

describe("labels and paths", () => {
  it("labels with the description when there is one", () => {
    expect(panelProjectLabel({ title: "P-1", description: "Skid panels" })).toBe("P-1 — Skid panels");
    expect(panelProjectLabel({ title: "P-1", description: "" })).toBe("P-1");
    expect(panelProjectPath(12)).toBe("/panels/projects/12");
  });
});

describe("projectCustomers", () => {
  it("counts orders per customer, most first, one customer whatever its case or spacing, blanks last", () => {
    const orders = [
      order(1, 7, { customer: "Alegacy" }),
      order(2, 7, { customer: "alegacy " }),
      order(3, 7, { customer: "SEC", status: "Shipped" }),
      order(4, 7, { customer: "" }),
      order(5, 7, { customer: "SEC" }),
      order(6, 7, { customer: "AG" }),
    ];
    expect(projectCustomers(orders)).toEqual([
      { key: "Alegacy", orders: 2, openOrders: 2 },
      { key: "SEC", orders: 2, openOrders: 1 },
      { key: "AG", orders: 1, openOrders: 1 },
      { key: NO_CUSTOMER, orders: 1, openOrders: 1 },
    ]);
  });
});

describe("narrowToCustomer", () => {
  const orders = [order(1, 7, { customer: "Alegacy" }), order(2, 7, { customer: "SEC" }), order(3, 7, { customer: "" })];
  const tasks = [task(10, 7, 1), task(11, 7, 2), task(12, 7, null), task(13, 7, 99)];

  it("keeps everything with no customer picked", () => {
    const r = narrowToCustomer(orders, tasks, null);
    expect(r.orders).toHaveLength(3);
    expect(r.tasks).toHaveLength(4);
    expect(r.hiddenUnlinkedTasks).toBe(0);
  });

  it("keeps that customer's orders and the tasks raised for them, ignoring case", () => {
    const r = narrowToCustomer(orders, tasks, "alegacy");
    expect(r.orders.map((o) => o.id)).toEqual([1]);
    expect(r.tasks.map((t) => t.id)).toEqual([10]);
    // Task 12 has no order, task 13's order isn't on this project.
    expect(r.hiddenUnlinkedTasks).toBe(2);
  });

  it("can pick the orders with no customer", () => {
    expect(narrowToCustomer(orders, tasks, NO_CUSTOMER).orders.map((o) => o.id)).toEqual([3]);
  });
});

describe("summarisePanelProjects — customers", () => {
  it("counts the distinct customers on a project's orders, blanks not counted", () => {
    const [p7] = summarisePanelProjects(
      [project(7)],
      [order(1, 7, { customer: "SEC" }), order(2, 7, { customer: "sec" }), order(3, 7, { customer: "AG" }), order(4, 7)],
      [],
    );
    expect(p7.customers).toBe(2);
  });
});
