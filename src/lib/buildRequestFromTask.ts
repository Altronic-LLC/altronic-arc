import type { BuildRequest, Task } from "@/types/task";
import { escapeHtml } from "./mentions";
import { serializeComments } from "./communicationParser";

// =============================================================================
// Raising a Build Request FROM a task.
//
// Pure — the wording and the prefill, with no Graph and no React, so both can
// be tested without touching the network. Mirrors `lib/eirPromotion.ts`,
// which does the same job for EIR→Task; that one is the precedent for
// carrying a discussion across, and this follows its shape deliberately
// rather than inventing a second one.
//
// **The link is stored ONCE, on the Build Request** (`TaskReference`, a real
// SharePoint column that already existed). The task side is DERIVED from it
// rather than duplicated — see `useBuildRequestForTask`. Storing it twice
// would mean two columns that can disagree, and the Task list would have
// needed a schema change it doesn't currently need.
// =============================================================================

/** How a task is named in the BR's header comment and its locked reference. */
export function taskLabel(task: Task): string {
  return task.numberedTitle || task.title || `Task #${task.id}`;
}

/**
 * The `Communication` value for a Build Request raised from a task.
 *
 * A header line saying where it came from, then the task's discussion,
 * OLDEST-FIRST — the parser hands comments back newest-first, but the stored
 * format is chronological, and writing them in display order would invert
 * the whole thread.
 *
 * Each carried comment keeps its ORIGINAL author and timestamp. It is a
 * record of what was said, not a re-post by whoever pressed the button —
 * re-stamping them would credit the wrong person and collapse the timeline.
 */
export function buildCarriedCommunication(args: {
  task: Task;
  raisedBy: { displayName: string; email?: string };
  now: Date;
}): string {
  const { task, raisedBy, now } = args;
  const safeLabel = escapeHtml(taskLabel(task));

  const header = {
    timestamp: now,
    authorName: raisedBy.displayName || "ARC",
    authorEmail: raisedBy.email ?? "",
    bodyHtml: `<p><em>Raised from task <strong>${safeLabel}</strong>.${
      task.comments.length > 0 ? " Original discussion carried over below." : ""
    }</em></p>`,
  };

  const carried = [...task.comments]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((c) => ({
      timestamp: c.timestamp,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      bodyHtml: c.bodyHtml,
    }));

  return serializeComments([header, ...carried]);
}

/**
 * What the Build Request form should open with, given the task.
 *
 * Only fields that genuinely correspond. Deliberately NOT carried:
 *
 *  - **Status** — a new BR starts at its own default, not the task's. The two
 *    workflows are unrelated ("In Progress" on a task says nothing about a
 *    build).
 *  - **Assignee** — the task's engineer is not automatically the BR's
 *    engineer, and guessing puts somebody's name on work they haven't agreed
 *    to. The requestor IS prefilled, because that is whoever is pressing the
 *    button.
 *  - **Dates** — a task's due date is not a quoted ship date.
 */
export function buildRequestPrefillFromTask(task: Task): {
  title: string;
  parentProjectLookupIds: number[];
  taskReferenceLookupId: number;
} {
  return {
    // The task's own title, not its numbered title: the BR's Title column is
    // "Product or Project Name", and "T3-0017-…" is a task identifier that
    // means nothing on a build request.
    title: task.title,
    parentProjectLookupIds: task.parentProject ? [task.parentProject.lookupId] : [],
    taskReferenceLookupId: task.id,
  };
}

/** The Build Request raised from this task, if there is one. */
export function buildRequestForTask(
  buildRequests: BuildRequest[],
  taskId: number | null,
): BuildRequest | null {
  if (taskId == null) return null;
  // Newest first, so a task re-raised after a cancelled BR shows the current
  // one rather than the abandoned one.
  const matches = buildRequests
    .filter((br) => br.taskReferenceLookupId === taskId)
    .sort((a, b) => b.id - a.id);
  return matches[0] ?? null;
}

/** Every Build Request raised from this task — for the rare re-raise case. */
export function buildRequestsForTask(
  buildRequests: BuildRequest[],
  taskId: number | null,
): BuildRequest[] {
  if (taskId == null) return [];
  return buildRequests
    .filter((br) => br.taskReferenceLookupId === taskId)
    .sort((a, b) => b.id - a.id);
}
