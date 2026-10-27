import { parseCommunication, serializeComment } from "./communicationParser";
import { buildMirroredBody, isMirroredComment, type CommentOrigin } from "./commentMirror";
import { htmlToPlainText } from "./htmlText";
import {
  eirForTask,
  eirNumbersIn,
  matchEirTaskReference,
  resolveEirTaskReference,
} from "./eirTaskReference";
import type { Comment, TaskEirReference } from "@/types/task";

// =============================================================================
// The one-time backfill of promoted EIRs ⇄ their tasks (Ray, 2026-10-27).
//
// EIRs promoted before ARC (by the old Power App) — and a few promoted by ARC
// before the link was written both ways — don't read as linked: the task
// carries a SharePoint form link ARC didn't understand, or one naming an EIR
// id that no longer exists, and the EIR's Task Reference is a Power Apps link,
// a numbered title or blank. Their comments were never shared either.
//
// This module is PURE and decides everything; `scripts/eir-task-backfill.ps1`
// only reads the two lists and performs what the plan says. Four rules:
//
//   1. **Pair only when the evidence agrees.** A task and an EIR that each
//      name a different partner are REPORTED, never linked. Ray's own list of
//      pairs (`overrides`) wins over everything else.
//   2. **Write only what's missing — on the EIR.** A Task Reference that
//      already resolves (a Power Apps `ItemID=` link, say) is left exactly as
//      it is. The TASK's EIR link is never written: it is a Hyperlink column,
//      which Graph cannot write at all (proven live 2026-10-27), and ARC reads
//      the old SharePoint form links and derives the rest from the EIR's side.
//   3. **Comments are copied, never moved or rewritten.** Each side gets the
//      other side's OWN comments — not its copies of somebody else's — under
//      the same "Posted on …" banner the live mirror writes, with the original
//      author and time. A comment already on the other side (ARC's promotion
//      carried the EIR's discussion over, tagged) is recognised and skipped.
//   4. **Re-running is safe.** Everything is decided from the current data, so
//      a second run finds the links in place and the comments present, and
//      plans nothing.
// =============================================================================

/** An EIR as the backfill reads it — the raw columns, nothing mapped. */
export interface BackfillEir {
  id: number;
  eirNo: string;
  title: string;
  resolution: string;
  taskPromotedFlag: boolean;
  taskReference: string;
  /** The raw Communication value. */
  communication: string;
}

/** A task as the backfill reads it. */
export interface BackfillTask {
  id: number;
  title: string;
  numberedTitle: string;
  eirReference: TaskEirReference | null;
  communication: string;
}

/** A pair Ray supplies by hand, for an EIR the backfill couldn't link. */
export interface BackfillOverride {
  eirId: number;
  taskId: number;
}

/** How a pair was found — said in the report, so a wrong one can be traced. */
export type PairEvidence =
  | "your list"
  | "both records"
  | "EIR's Task Reference"
  | "task's EIR link";

export interface PlannedPair {
  eirId: number;
  eirNo: string;
  eirTitle: string;
  taskId: number;
  taskLabel: string;
  foundBy: PairEvidence;
  /** The task's EIR link as it stands — reported, never written (see rule 2). */
  taskLinkBefore: TaskEirReference | null;
  /** The EIR's Task Reference to write, or null when it already names this task. */
  eirTaskReference: string | null;
  eirTaskReferenceBefore: string;
  /** Set the EIR's "promoted to task" flag (it was off). */
  setPromotedFlag: boolean;
  /** Comment records to APPEND to each side's Communication (already serialised). */
  toTask: string[];
  toEir: string[];
}

export interface UnlinkedEir {
  eirId: number;
  eirNo: string;
  title: string;
  resolution: string;
  taskReference: string;
  reason: string;
  /** Tasks it might be — never linked automatically. */
  candidates: { taskId: number; label: string }[];
}

/** A task whose EIR link contradicts the pairing — reported, not linked. */
export interface ConflictingTask {
  taskId: number;
  taskLabel: string;
  eirId: number;
  eirNo: string;
  reason: string;
}

/** A task that names an EIR in its title but isn't linked to it. */
export interface SuggestedPair {
  taskId: number;
  taskLabel: string;
  eirId: number;
  eirNo: string;
}

export interface BackfillPlan {
  pairs: PlannedPair[];
  unlinked: UnlinkedEir[];
  conflicts: ConflictingTask[];
  suggestions: SuggestedPair[];
}

function label(task: Pick<BackfillTask, "id" | "numberedTitle" | "title">): string {
  return task.numberedTitle || task.title || `Task #${task.id}`;
}

function eirName(eir: Pick<BackfillEir, "id" | "eirNo">): string {
  return eir.eirNo || `EIR #${eir.id}`;
}

/** Did the old record count as promoted? Any one of the three marks will do. */
export function looksPromoted(eir: BackfillEir): boolean {
  return (
    eir.resolution === "Promoted to Task" ||
    eir.taskPromotedFlag ||
    eir.taskReference.trim() !== ""
  );
}

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------

/** The tag ARC's promotion adds to every carried-over EIR comment. */
const CARRIED_TAG = /<p><em>— carried over from EIR [^<]*<\/em><\/p>/gi;
/** The note ARC's promotion writes at the top of the task's thread. */
const PROMOTION_NOTE = /Promoted from EIR <strong>/i;
/** A live-mirror banner paragraph. */
const ORIGIN_BANNER = /<p><span class="comment-origin"[\s\S]*?<\/span><\/p>/gi;

/**
 * What makes two comments "the same comment": the same author saying the
 * same words. The time is deliberately NOT part of it — a copy made by the
 * old app or by a mirror is stamped when it was copied — and neither are the
 * markers a copy adds (the banner, the carried-over tag).
 */
export function commentKey(c: Pick<Comment, "authorEmail" | "authorName" | "bodyHtml">): string {
  const who = (c.authorEmail || c.authorName || "").trim().toLowerCase();
  const words = htmlToPlainText(c.bodyHtml.replace(ORIGIN_BANNER, "").replace(CARRIED_TAG, ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return `${who}|${words}`;
}

/** A comment written on THIS record — not a copy of one from somewhere else. */
function isOwnComment(c: Comment): boolean {
  if (isMirroredComment(c.bodyHtml)) return false;
  if (PROMOTION_NOTE.test(c.bodyHtml)) return false;
  CARRIED_TAG.lastIndex = 0;
  const carried = CARRIED_TAG.test(c.bodyHtml);
  CARRIED_TAG.lastIndex = 0;
  return !carried;
}

/**
 * The records to append to `to` so it holds every comment written on `from`.
 * Oldest first, each under `from`'s banner, original author and time kept.
 */
export function commentsToCopy(
  fromRaw: string,
  toRaw: string,
  origin: CommentOrigin,
): string[] {
  const present = new Set(parseCommunication(toRaw).map(commentKey));
  return parseCommunication(fromRaw)
    .filter(isOwnComment)
    .filter((c) => {
      const key = commentKey(c);
      if (present.has(key)) return false;
      present.add(key); // the same words twice on `from` are copied once
      return true;
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((c) =>
      serializeComment({
        timestamp: c.timestamp,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        bodyHtml: buildMirroredBody(c.bodyHtml, origin),
      }),
    );
}

// -----------------------------------------------------------------------------
// Pairing
// -----------------------------------------------------------------------------

export function planEirTaskBackfill(args: {
  eirs: readonly BackfillEir[];
  tasks: readonly BackfillTask[];
  overrides?: readonly BackfillOverride[];
  /** ARC's production address — for an EIR Task Reference written as a link. */
  arcUrl: string;
}): BackfillPlan {
  const { eirs, tasks, overrides = [], arcUrl } = args;
  const eirById = new Map(eirs.map((e) => [e.id, e]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const pairs = new Map<number, { taskId: number; foundBy: PairEvidence }>();
  const taskTaken = new Map<number, number>(); // taskId → eirId
  const unlinked: UnlinkedEir[] = [];
  const conflicts: ConflictingTask[] = [];
  const reasons = new Map<number, string>();

  const pair = (eirId: number, taskId: number, foundBy: PairEvidence) => {
    pairs.set(eirId, { taskId, foundBy });
    taskTaken.set(taskId, eirId);
  };

  // 1. Ray's list wins — but only for records that exist.
  for (const o of overrides) {
    if (!eirById.has(o.eirId)) continue;
    if (!taskById.has(o.taskId)) {
      reasons.set(o.eirId, `your list names task ${o.taskId}, which doesn't exist`);
      continue;
    }
    pair(o.eirId, o.taskId, "your list");
  }

  // 2. The EIR's own Task Reference.
  for (const eir of eirs) {
    if (pairs.has(eir.id) || !eir.taskReference.trim()) continue;
    const task = resolveEirTaskReference(eir.taskReference, tasks);
    if (!task) continue;
    const claimed = eirForTask(task, eirs);
    if (claimed && claimed.id !== eir.id) {
      reasons.set(eir.id, `its task ${label(task)} links to ${eirName(claimed)} instead`);
      continue;
    }
    if (taskTaken.has(task.id)) {
      reasons.set(eir.id, `its task ${label(task)} is already linked to ${eirName(eirById.get(taskTaken.get(task.id)!)!)}`);
      continue;
    }
    pair(eir.id, task.id, claimed ? "both records" : "EIR's Task Reference");
  }

  // 3. The task's EIR link, for an EIR that didn't name its task.
  for (const task of tasks) {
    if (!task.eirReference) continue;
    const eir = eirForTask(task, eirs);
    if (!eir) continue;
    const existing = pairs.get(eir.id);
    if (existing?.taskId === task.id) continue;
    if (existing || taskTaken.has(task.id)) {
      const other = existing ? taskById.get(existing.taskId) : null;
      conflicts.push({
        taskId: task.id,
        taskLabel: label(task),
        eirId: eir.id,
        eirNo: eirName(eir),
        reason: other
          ? `the EIR is linked to ${label(other)}`
          : `the task is already linked to another EIR`,
      });
      continue;
    }
    if (eir.taskReference.trim()) {
      // The EIR names a task of its own — not this one, or step 2 would have
      // paired them. Don't overrule it. (A reference naming NO task, like the
      // sentence typed into one, doesn't count against the task's link.)
      const m = matchEirTaskReference(eir.taskReference, tasks);
      if (m.ambiguous.length > 0 || m.task) {
        conflicts.push({
          taskId: task.id,
          taskLabel: label(task),
          eirId: eir.id,
          eirNo: eirName(eir),
          reason: `the EIR's Task Reference names a different task`,
        });
        continue;
      }
    }
    pair(eir.id, task.id, "task's EIR link");
  }

  // 4. Promoted EIRs left without a task.
  for (const eir of eirs) {
    if (pairs.has(eir.id) || !looksPromoted(eir)) continue;
    const m = matchEirTaskReference(eir.taskReference, tasks);
    const byTitle = eir.eirNo
      ? tasks.filter(
          (t) =>
            !taskTaken.has(t.id) &&
            eirNumbersIn(`${t.numberedTitle} ${t.title}`).includes(eirNumbersIn(eir.eirNo)[0] ?? ""),
        )
      : [];
    const candidates = [...m.ambiguous, ...byTitle]
      .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
      .map((t) => ({ taskId: t.id, label: label(t) }));

    let reason = reasons.get(eir.id);
    if (!reason) {
      const ref = eir.taskReference.trim();
      if (!ref) reason = "no Task Reference, and no task links to it";
      else if (m.ambiguous.length > 0) reason = "its Task Reference fits several tasks";
      else reason = "its Task Reference doesn't name a task that exists";
    }
    unlinked.push({
      eirId: eir.id,
      eirNo: eir.eirNo,
      title: eir.title,
      resolution: eir.resolution,
      taskReference: eir.taskReference,
      reason,
      candidates,
    });
  }

  // 5. Tasks that name an EIR in their title, linked to nothing — related
  //    work ("ECN for EIR_2025-0286") as often as a promotion, so listed only.
  const suggestions: SuggestedPair[] = [];
  for (const task of tasks) {
    if (taskTaken.has(task.id) || task.eirReference) continue;
    for (const no of eirNumbersIn(`${task.numberedTitle} ${task.title}`)) {
      const eir = eirs.find((e) => e.eirNo.trim().toUpperCase() === no);
      if (!eir || pairs.has(eir.id) || unlinked.some((u) => u.eirId === eir.id)) continue;
      suggestions.push({ taskId: task.id, taskLabel: label(task), eirId: eir.id, eirNo: eir.eirNo });
    }
  }

  // The writes each pair needs.
  const planned: PlannedPair[] = [];
  for (const [eirId, { taskId, foundBy }] of pairs) {
    const eir = eirById.get(eirId)!;
    const task = taskById.get(taskId)!;

    const alreadyNamed = resolveEirTaskReference(eir.taskReference, tasks)?.id === taskId;
    // The numbered title is what ARC's promotion writes — unless it's shared
    // with another task, when only a link names this one.
    const titleIsUnique =
      !!task.numberedTitle && resolveEirTaskReference(task.numberedTitle, tasks)?.id === taskId;
    const eirTaskReference = alreadyNamed
      ? null
      : titleIsUnique
        ? task.numberedTitle
        : `${arcUrl.replace(/\/+$/, "")}/task/${taskId}`;

    planned.push({
      eirId,
      eirNo: eir.eirNo,
      eirTitle: eir.title,
      taskId,
      taskLabel: label(task),
      foundBy,
      taskLinkBefore: task.eirReference,
      eirTaskReference,
      eirTaskReferenceBefore: eir.taskReference,
      setPromotedFlag: !eir.taskPromotedFlag,
      toTask: commentsToCopy(eir.communication, task.communication, {
        kind: "eir",
        id: eirId,
        label: eirName(eir),
      }),
      toEir: commentsToCopy(task.communication, eir.communication, {
        kind: "task",
        id: taskId,
        label: label(task),
      }),
    });
  }
  planned.sort((a, b) => a.eirId - b.eirId);
  unlinked.sort((a, b) => a.eirId - b.eirId);

  return { pairs: planned, unlinked, conflicts, suggestions };
}

/** Append serialised records to a Communication value — the shape `appendComment` writes. */
export function appendRecords(existing: string, records: readonly string[]): string {
  if (records.length === 0) return existing;
  const head = existing.replace(/\s+$/, "");
  return head ? `${head}\n${records.join("\n")}` : records.join("\n");
}
