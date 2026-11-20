import type {
  PanelOrder,
  PanelTask,
  PanelTaskTemplate,
  PanelTaskType,
  PanelTaskWorkType,
  Person,
} from "@/types/task";
import { PANEL_TASK_TYPES } from "@/types/task";
import type { ChangeEmail } from "./changeAlerts";
import { escapeHtml } from "./mentions";
import { appItemUrl } from "./appUrl";
import { formatHours } from "./capacity";

// =============================================================================
// A Panel Order's STANDARD TASKS (pure, testable). Tim, 2026-10-29: creating a
// Panel Order does what submitting Wrike's "New Production Order" form did —
// it raises the tasks of the "Panel Blueprint - Production Job" for that job.
//
//   - The tasks come from the Panel Task Templates list (the panel managers
//     edit it in ARC), in SortOrder, active ones only.
//   - Each carries its template's type and hours, sits on the order's
//     Project Reference AND points at the order itself, and copies the
//     order's SAP #.
//   - They are CHAINED in template order (2026-10-30): the first is New, the
//     rest wait as Awaiting Pre-Req — lib/panelOrderChain.ts.
//   - If the order has an Engineer Assigned, every task is assigned to them;
//     blank means every task is unassigned. Any one can be reassigned later.
//   - No dates: the tasks land in the Capacity backlog to be scheduled.
//   - The engineer gets ONE email listing them all, not one per task.
//   - Changing the order's engineer later does NOT move the tasks — that
//     would undo a deliberate reassignment.
// =============================================================================

/**
 * Wrike's blueprint as it stood (read 2026-10-28; hours are the medians of
 * the real tasks). Seeds the template list and the demo, and is what ARC
 * raises while the list isn't set up.
 */
export const DEFAULT_PANEL_TASK_TEMPLATES: readonly Omit<PanelTaskTemplate, "id">[] = [
  { title: "Drawing Creation", taskType: "Drawings", estimatedHours: 24, sortOrder: 1, active: true },
  { title: "BOM Creation", taskType: "BOM", estimatedHours: 2, sortOrder: 2, active: true },
  { title: "SOO Creation", taskType: "SOO", estimatedHours: 6, sortOrder: 3, active: true },
  { title: "Programming", taskType: "Programming", estimatedHours: 16, sortOrder: 4, active: true },
];

/** The templates a new order raises: active, in SortOrder, then title. */
export function activeTemplates(templates: readonly PanelTaskTemplate[]): PanelTaskTemplate[] {
  return templates
    .filter((t) => t.active && t.title.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

/**
 * A raised task's title: the job, then the step — "P-0001 — Drawing
 * Creation", like Wrike's Job # prefix. The job is the order's Project
 * Reference, else its title.
 */
export function standardTaskTitle(
  order: Pick<PanelOrder, "title" | "projectRef">,
  template: Pick<PanelTaskTemplate, "title">,
): string {
  const job = order.projectRef?.title?.trim() || order.title.trim();
  const step = template.title.trim();
  return job ? `${job} — ${step}` : step;
}

/** What createPanelTask is handed for one standard task. */
export interface StandardTaskInput {
  title: string;
  taskType: PanelTaskType | null;
  /** Always Production Order: these are a production job's tasks, as in Wrike. */
  workType: PanelTaskWorkType;
  estimatedHours: number | null;
  projectLookupId: number | null;
  orderLookupId: number;
  /** The template's SortOrder: its place in the order's chain. */
  chainStep: number;
  sapNumber: string;
  assigned: Person[];
}

/**
 * The tasks a new order raises. `engineer` is the order's Engineer Assigned —
 * every task gets them, or nobody.
 */
export function standardTaskInputs(
  order: Pick<PanelOrder, "id" | "title" | "projectRef" | "sapNumber">,
  templates: readonly PanelTaskTemplate[],
  engineer: Person | null,
): StandardTaskInput[] {
  return activeTemplates(templates).map((t) => ({
    title: standardTaskTitle(order, t),
    taskType: t.taskType,
    workType: "Production Order",
    estimatedHours: t.estimatedHours,
    projectLookupId: order.projectRef?.lookupId ?? null,
    orderLookupId: order.id,
    chainStep: t.sortOrder,
    sapNumber: order.sapNumber ?? "",
    assigned: engineer ? [engineer] : [],
  }));
}

/** The tasks raised for one order, oldest first (the order they were raised in). */
export function tasksForOrder(tasks: readonly PanelTask[], orderId: number): PanelTask[] {
  return tasks.filter((t) => t.orderRef?.lookupId === orderId).sort((a, b) => a.id - b.id);
}

/**
 * The standard tasks an order is MISSING — templates whose task title isn't
 * on the order yet. The order page's button raises only these, so pressing it
 * after a partly failed create never doubles a task.
 */
export function missingTemplates(
  order: Pick<PanelOrder, "title" | "projectRef">,
  templates: readonly PanelTaskTemplate[],
  existing: readonly Pick<PanelTask, "title">[],
): PanelTaskTemplate[] {
  const have = new Set(existing.map((t) => t.title.trim().toLowerCase()));
  return activeTemplates(templates).filter(
    (t) => !have.has(standardTaskTitle(order, t).toLowerCase()),
  );
}

/** Why a template can't be saved, or null. */
export function panelTaskTemplateProblem(t: {
  title: string;
  taskType: string | null;
  estimatedHours: number | null;
}): string | null {
  if (!t.title.trim()) return "Give the task a name.";
  if (t.taskType && !(PANEL_TASK_TYPES as readonly string[]).includes(t.taskType)) {
    return `"${t.taskType}" isn't a Panel Task type.`;
  }
  if (t.estimatedHours !== null) {
    if (!Number.isFinite(t.estimatedHours) || t.estimatedHours < 0) {
      return "Hours must be a number, 0 or more.";
    }
    if (t.estimatedHours > 2000) return "Hours looks too large — over 2,000.";
  }
  return null;
}

/**
 * The ONE email to the order's engineer: the order, and every task raised
 * for it, each linked. Nothing when there's no engineer, no address, or the
 * engineer raised the order themselves (assigning yourself isn't news).
 */
export function buildOrderTasksAssignedEmails(args: {
  order: Pick<PanelOrder, "id" | "title">;
  tasks: readonly Pick<PanelTask, "id" | "title" | "estimatedHours">[];
  engineer: Person | null;
  actor: Person;
  /** "created" = with the order (the default); "added" = later, from the order's page. */
  when?: "created" | "added";
}): ChangeEmail[] {
  const email = args.engineer?.email?.trim();
  if (!args.engineer || !email) return [];
  if (email.toLowerCase() === (args.actor.email ?? "").trim().toLowerCase()) return [];
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const n = args.tasks.length;
  const rows = args.tasks
    .map(
      (t) =>
        `<li style="margin:2px 0;"><a href="${appItemUrl("panelTask", t.id)}">${escapeHtml(t.title)}</a>` +
        (t.estimatedHours !== null ? ` — ${escapeHtml(formatHours(t.estimatedHours))}` : "") +
        `</li>`,
    )
    .join("");
  return [
    {
      email,
      displayName: args.engineer.displayName,
      subject:
        args.when === "added"
          ? `You've been assigned ${n} task${n === 1 ? "" : "s"} on ${args.order.title}`
          : `You've been assigned to ${args.order.title}${n ? ` and its ${n} task${n === 1 ? "" : "s"}` : ""}`,
      headlineHtml:
        args.when === "added"
          ? `<strong>${actorName}</strong> added ${n} standard task${n === 1 ? "" : "s"} to this panel order and assigned ${n === 1 ? "it" : "them"} to you.`
          : `<strong>${actorName}</strong> created this panel order and assigned you to it` +
            (n ? ` and its ${n} task${n === 1 ? "" : "s"}.` : "."),
      detailHtml: n
        ? `<div style="font-size:14px;"><ul style="margin:0;padding-left:18px;">${rows}</ul>` +
          `<p style="margin:8px 0 0;">They have no dates yet — they're in the Panel Engineering Capacity backlog to be scheduled.</p></div>`
        : undefined,
    },
  ];
}
