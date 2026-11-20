import type { Comment, PanelOrder, PanelProject, PanelTask } from "@/types/task";
import { isPanelTaskOpen } from "./panelTaskStatus";
import { panelOrderCreatedAt } from "./panelOrderArchive";

// =============================================================================
// Panel Project Dashboard (BusinessIT#42, from the live demo with Mark,
// 2026-11-19) — the level above Panel Orders and Panel Tasks: everything that
// hangs off one Panel Project Reference, read-only, linking down to the app
// that owns each record. Pure: no React, no fetching.
// =============================================================================

/** The orders on a project, newest first. */
export function ordersForProject(orders: readonly PanelOrder[], projectId: number): PanelOrder[] {
  return orders
    .filter((o) => o.projectRef?.lookupId === projectId)
    .sort((a, b) => panelOrderCreatedAt(b).getTime() - panelOrderCreatedAt(a).getTime());
}

/**
 * The tasks on a project: every task whose Project Reference is this project,
 * PLUS every task raised for one of the project's orders. A standard task
 * copies its order's project when it's raised, and doesn't follow the order if
 * the order is moved to another project later — it still belongs to that
 * order, so it shows where the order does.
 */
export function tasksForProject(
  tasks: readonly PanelTask[],
  projectId: number,
  orderIds: ReadonlySet<number>,
): PanelTask[] {
  return tasks.filter(
    (t) =>
      t.projectRef?.lookupId === projectId ||
      (t.orderRef !== null && orderIds.has(t.orderRef.lookupId)),
  );
}

export interface ProjectComment {
  comment: Comment;
  source: { kind: "order" | "task"; id: number; title: string };
}

/** Every comment on the project's orders and tasks, newest first, each saying where it was posted. */
export function projectCommunications(
  orders: readonly PanelOrder[],
  tasks: readonly PanelTask[],
): ProjectComment[] {
  const out: ProjectComment[] = [];
  for (const o of orders) {
    for (const c of o.comments) out.push({ comment: c, source: { kind: "order", id: o.id, title: o.title } });
  }
  for (const t of tasks) {
    for (const c of t.comments) out.push({ comment: c, source: { kind: "task", id: t.id, title: t.title } });
  }
  return out.sort((a, b) => b.comment.timestamp.getTime() - a.comment.timestamp.getTime());
}

/** An order still in work — not Shipped and not archived. */
export function isPanelOrderOpen(order: PanelOrder): boolean {
  return !order.archived && order.status !== "Shipped";
}

export interface PanelProjectSummary {
  project: PanelProject;
  orders: number;
  openOrders: number;
  openTasks: number;
  comments: number;
  /** How many different customers its orders are for. */
  customers: number;
  /** The latest change to any of its orders or tasks, or comment on one; null when it has none. */
  lastActivity: Date | null;
}

/**
 * One summary row per project, for the dashboard's list. Built in ONE pass
 * over the orders and tasks rather than filtering them once per project — the
 * project list runs to hundreds since the Panel Job Dashboard move.
 */
export function summarisePanelProjects(
  projects: readonly PanelProject[],
  orders: readonly PanelOrder[],
  tasks: readonly PanelTask[],
): PanelProjectSummary[] {
  const byId = new Map<number, PanelProjectSummary>();
  for (const p of projects) {
    byId.set(p.id, { project: p, orders: 0, openOrders: 0, openTasks: 0, comments: 0, customers: 0, lastActivity: null });
  }
  const touch = (s: PanelProjectSummary, when: Date | null | undefined) => {
    if (!when || Number.isNaN(when.getTime())) return;
    if (!s.lastActivity || when > s.lastActivity) s.lastActivity = when;
  };

  const orderProject = new Map<number, number>();
  const customerSets = new Map<number, Set<string>>();
  for (const o of orders) {
    if (!o.projectRef) continue;
    orderProject.set(o.id, o.projectRef.lookupId);
    const s = byId.get(o.projectRef.lookupId);
    if (!s) continue;
    s.orders += 1;
    if (isPanelOrderOpen(o)) s.openOrders += 1;
    const c = o.customer.trim().toLowerCase().replace(/\s+/g, " ");
    if (c) {
      const set = customerSets.get(s.project.id) ?? new Set<string>();
      set.add(c);
      customerSets.set(s.project.id, set);
    }
    s.comments += o.comments.length;
    touch(s, o.modifiedAt);
    for (const c of o.comments) touch(s, c.timestamp);
  }

  for (const t of tasks) {
    // The same rule as tasksForProject: its own project, and the project of
    // the order it was raised for — counted once even when both name one.
    const ids = new Set<number>();
    if (t.projectRef) ids.add(t.projectRef.lookupId);
    const viaOrder = t.orderRef ? orderProject.get(t.orderRef.lookupId) : undefined;
    if (viaOrder !== undefined) ids.add(viaOrder);
    for (const id of ids) {
      const s = byId.get(id);
      if (!s) continue;
      if (isPanelTaskOpen(t.status)) s.openTasks += 1;
      s.comments += t.comments.length;
      touch(s, t.modifiedAt);
      for (const c of t.comments) touch(s, c.timestamp);
    }
  }
  for (const [id, set] of customerSets) byId.get(id)!.customers = set.size;
  return [...byId.values()];
}

/** The key for an order with no customer — "" can't be a URL value worth sharing. */
export const NO_CUSTOMER = "(none)";

export function orderCustomerKey(order: PanelOrder): string {
  return order.customer.trim() || NO_CUSTOMER;
}

export interface ProjectCustomer {
  /** The customer as written on the orders, or NO_CUSTOMER. */
  key: string;
  orders: number;
  openOrders: number;
}

/**
 * The customers on a project's orders, most orders first (ties by name). A
 * repeat panel is built for several customers, so the dashboard offers one
 * pill per customer to narrow the page to theirs (Tim, 2026-11-19).
 * Customers that differ only in case or spacing are one customer.
 */
export function projectCustomers(orders: readonly PanelOrder[]): ProjectCustomer[] {
  const byKey = new Map<string, ProjectCustomer>();
  for (const o of orders) {
    const name = orderCustomerKey(o);
    const k = name.toLowerCase().replace(/\s+/g, " ");
    const c = byKey.get(k) ?? { key: name, orders: 0, openOrders: 0 };
    c.orders += 1;
    if (isPanelOrderOpen(o)) c.openOrders += 1;
    byKey.set(k, c);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.orders - a.orders ||
      // "No customer" after every named one with the same count.
      Number(a.key === NO_CUSTOMER) - Number(b.key === NO_CUSTOMER) ||
      a.key.localeCompare(b.key),
  );
}

function sameCustomer(a: string, b: string): boolean {
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return n(a) === n(b);
}

/**
 * One customer's part of a project: their orders, and the tasks raised for
 * those orders. A task tied to no order has no customer, so it isn't shown
 * while a customer is picked — the caller says how many that hides.
 * `customer` null = everything.
 */
export function narrowToCustomer(
  orders: readonly PanelOrder[],
  tasks: readonly PanelTask[],
  customer: string | null,
): { orders: PanelOrder[]; tasks: PanelTask[]; hiddenUnlinkedTasks: number } {
  if (customer === null) return { orders: [...orders], tasks: [...tasks], hiddenUnlinkedTasks: 0 };
  const mine = orders.filter((o) => sameCustomer(orderCustomerKey(o), customer));
  const ids = new Set(mine.map((o) => o.id));
  const projectOrderIds = new Set(orders.map((o) => o.id));
  return {
    orders: mine,
    tasks: tasks.filter((t) => t.orderRef !== null && ids.has(t.orderRef.lookupId)),
    // Tasks on none of the project's orders — no customer to judge them by.
    hiddenUnlinkedTasks: tasks.filter((t) => t.orderRef === null || !projectOrderIds.has(t.orderRef.lookupId)).length,
  };
}

/** "P-0001 — Archrock skid panels" when there's a description, else the number. */
export function panelProjectLabel(project: Pick<PanelProject, "title" | "description">): string {
  return project.description ? `${project.title} — ${project.description}` : project.title;
}

/** The dashboard's address for one project. */
export function panelProjectPath(projectId: number): string {
  return `/panels/projects/${projectId}`;
}
