// =============================================================================
// What a task, EIR or build request email says ABOUT the item, beyond what
// happened (BusinessIT#67, Valerie Sweeney via Feature Request #41).
//
// An email that carries a context is laid out in three blocks under the
// greeting — renderEmailShell in api/email.ts draws them:
//
//   1. Number / title — the item's card, with its parent task (a task) or its
//      linked task (a build request) on a line above, as a link.
//   2. What's new — who did what, then the comment / change / request.
//   3. Description — the item's description, cut at 600 characters on a word,
//      or, for a build request (no description column), its details.
//
// The SUBJECT never changes: it stays the item's own title, so Outlook keeps
// every email about the item in one conversation (lib/emailThread.ts). The
// parent is deliberately NOT in the subject (Tim, 2026-11-06) — a moved task
// would start a new conversation, and the subject would run long.
//
// Pure: callers pass the records; nothing here reads a cache or the network.
// =============================================================================

import { appItemUrl } from "./appUrl";
import type { AlertDetail } from "./changeAlerts";
import type { BuildRequest, Eir, Task } from "@/types/task";

/** The extra blocks an item's email carries. Every field is optional. */
export interface EmailContext {
  /** A line above the item's title in its card — "Parent task: T12-… →". */
  above?: { label: string; title: string; url: string };
  /** The item's raw description (HTML or plain); cut when rendered. */
  description?: string;
  /** Label/value rows for an item with no description column (build requests). */
  details?: AlertDetail[];
}

/** A task's context: its parent task (if any) and its description. */
export function taskEmailContext(task: Pick<Task, "parentTask" | "description">): EmailContext {
  const parent = task.parentTask;
  return {
    above: parent
      ? { label: "Parent task", title: parent.numberedTitle, url: appItemUrl("task", parent.id) }
      : undefined,
    description: task.description ?? "",
  };
}

/** An EIR's context: its description. EIRs have no parent. */
export function eirEmailContext(eir: Pick<Eir, "description">): EmailContext {
  return { description: eir.description ?? "" };
}

/** The task a build request was raised from, as its card shows it. */
export interface LinkedTaskRef {
  id: number;
  title: string;
}

function formatShipDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/**
 * A build request's context: the task it's linked to (BusinessIT#58 — every
 * request names one) and its details, since the list has no description.
 * Blank details are dropped; a request with none shows no third block.
 */
export function buildRequestEmailContext(
  br: Pick<BuildRequest, "product" | "brType" | "samplePhase" | "quotedShipDate" | "customerName">,
  linkedTask: LinkedTaskRef | null,
): EmailContext {
  const details: AlertDetail[] = [
    { label: "Product", value: br.product ?? "" },
    { label: "Type", value: br.brType ?? "" },
    { label: "Sample phase", value: br.samplePhase ?? "" },
    { label: "Quoted ship date", value: formatShipDate(br.quotedShipDate) },
    { label: "Customer", value: br.customerName ?? "" },
  ].filter((d) => d.value.trim() !== "");
  return {
    above: linkedTask
      ? { label: "Task", title: linkedTask.title, url: appItemUrl("task", linkedTask.id) }
      : undefined,
    details,
  };
}

/** An email target for a task: its numbered title, and its parent + description. */
export function taskEmailTarget(
  task: Pick<Task, "id" | "numberedTitle" | "title" | "parentTask" | "description">,
): { kind: "task"; id: number; title: string; context: EmailContext } {
  return {
    kind: "task",
    id: task.id,
    title: task.numberedTitle || task.title,
    context: taskEmailContext(task),
  };
}
