import { type QueryClient } from "@tanstack/react-query";
import { mirrorComment, describeMirrorTarget } from "@/api/commentMirror";
import {
  mirrorTargetsFor,
  withoutAlreadyNotified,
  type CommentOrigin,
  type CommentOriginKind,
} from "@/lib/commentMirror";
import { buildRequestForTask, taskLabel } from "@/lib/buildRequestFromTask";
import { commentNotifyRecipients } from "@/lib/mentions";
import { htmlToPlainText } from "@/lib/htmlText";
import { notifyMentions } from "@/api/email";
import { pushToast } from "@/components/Toast";
import { BUILD_REQUESTS_KEY, BUILD_REQUEST_ITEMS_KEY } from "@/hooks/useBuildRequests";
import { TASK_LIST_KEY } from "@/hooks/useTasks";
import type {
  BuildRequest,
  BuildRequestItem,
  Person,
  Task,
} from "@/types/task";

// =============================================================================
// Fanning a comment across a task ⇄ its build request ⇄ that request's parts.
//
// Ray, 2026-09-21. ONE function the three comment hooks call, for the reason
// `api/autoWatch.ts` is shared: three copies of a fan-out is how one
// direction quietly stops working.
//
// It runs from each hook's `onSuccess`, so by the time it fires the ORIGINAL
// comment is written and on screen. Everything here is therefore
// best-effort — a mirror that fails toasts and leaves the real comment
// alone.
//
// **The links are all DERIVED from `BuildRequest.taskReferenceLookupId`** —
// the one stored half of the task↔BR link (see `lib/buildRequestFromTask.ts`).
// A part reaches its task through its own header, so a part comment needs two
// hops and both come out of the same already-loaded caches.
// =============================================================================

/** What the caches can tell us about one comment's surroundings. */
interface Linkage {
  taskId: number | null;
  buildRequestId: number | null;
  origin: CommentOrigin;
}

/** How a build request is named in a banner on another record. */
function brLabel(br: BuildRequest): string {
  return br.brNo || br.title || `Build request #${br.id}`;
}

/** How a part is named in a banner. */
function itemLabel(item: BuildRequestItem): string {
  return item.partNumber || `Part #${item.id}`;
}

/**
 * Resolve the other end(s) of the link from the caches, plus how the SOURCE
 * should be named on the far side.
 *
 * Returns `null` when the source record itself isn't in cache — there is
 * nothing to name the banner after, and guessing would produce a comment
 * whose origin line reads "#0".
 */
function resolveLinkage(
  qc: QueryClient,
  kind: CommentOriginKind,
  id: number,
): Linkage | null {
  const brs = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY) ?? [];

  if (kind === "task") {
    const task = qc.getQueryData<Task[]>(TASK_LIST_KEY)?.find((t) => t.id === id);
    if (!task) return null;
    const br = buildRequestForTask(brs, id);
    return {
      taskId: id,
      buildRequestId: br?.id ?? null,
      origin: { kind: "task", id, label: taskLabel(task) },
    };
  }

  if (kind === "buildRequest") {
    const br = brs.find((b) => b.id === id);
    if (!br) return null;
    return {
      taskId: br.taskReferenceLookupId,
      buildRequestId: id,
      origin: { kind: "buildRequest", id, label: brLabel(br) },
    };
  }

  // A PART: two hops — the part names its header, and the header names the
  // task. Either can be missing, and each missing one just drops its own
  // mirror (see mirrorTargetsFor).
  const item = qc
    .getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY)
    ?.find((i) => i.id === id);
  if (!item) return null;
  const br = brs.find((b) => b.id === item.buildRequestLookupId);
  return {
    taskId: br?.taskReferenceLookupId ?? null,
    buildRequestId: item.buildRequestLookupId,
    origin: {
      kind: "buildRequestItem",
      id,
      label: itemLabel(item),
      // A part number says nothing about which request it is on, and the task
      // page is exactly where that context is missing.
      parentLabel: br ? brLabel(br) : undefined,
    },
  };
}

/** Watchers + assignees of a mirror target, for its own notification. */
function audienceFor(
  qc: QueryClient,
  kind: "task" | "buildRequest" | "buildRequestItem",
  id: number,
): { watchers: Person[]; assignees: Person[]; title: string } | null {
  if (kind === "task") {
    const task = qc.getQueryData<Task[]>(TASK_LIST_KEY)?.find((t) => t.id === id);
    if (!task) return null;
    return {
      watchers: task.watchers,
      assignees: task.assigned,
      title: taskLabel(task),
    };
  }
  if (kind === "buildRequest") {
    const br = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY)?.find((b) => b.id === id);
    if (!br) return null;
    return {
      watchers: br.watchers,
      assignees: br.engineerAssigned ? [br.engineerAssigned] : [],
      title: brLabel(br),
    };
  }
  const item = qc
    .getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY)
    ?.find((i) => i.id === id);
  if (!item) return null;
  return { watchers: item.watchers, assignees: [], title: itemLabel(item) };
}

/**
 * Copy a just-posted comment onto the linked records, and notify each side's
 * OWN watchers.
 *
 * `alreadyNotified` is whoever the original post emailed. Ray's call was that
 * each side notifies its own watchers, so without this de-dupe somebody
 * watching both the task and the build request gets the same comment twice.
 *
 * Fire-and-forget from a hook's `onSuccess`: `void fanOutComment(...)`.
 */
export async function fanOutComment(args: {
  qc: QueryClient;
  /** Where it was actually posted. */
  source: { kind: CommentOriginKind; id: number };
  comment: { authorName: string; authorEmail: string; bodyHtml: string };
  /** Recipients the ORIGINAL post already emailed. */
  alreadyNotified: { email?: string }[];
}): Promise<void> {
  const { qc, source, comment, alreadyNotified } = args;

  const linkage = resolveLinkage(qc, source.kind, source.id);
  if (!linkage) return;

  const targets = mirrorTargetsFor({
    kind: source.kind,
    origin: linkage.origin,
    taskId: linkage.taskId,
    buildRequestId: linkage.buildRequestId,
  });
  if (targets.length === 0) return;

  const { written, failed } = await mirrorComment({
    targets,
    comment,
    origin: linkage.origin,
  });

  if (failed.length > 0) {
    // The real comment posted fine, so this is a warning, not an error —
    // but it is NOT silent: whoever is reading the other record would
    // otherwise never know a reply exists.
    pushToast({
      message: `Comment posted, but it couldn't be copied to ${failed
        .map((f) => describeMirrorTarget(f.target))
        .join(" or ")}.`,
      variant: "error",
    });
    for (const f of failed) {
      console.error(`Comment mirror to ${f.target.kind} ${f.target.id} failed:`, f.error);
    }
  }

  // Refetch the lists the copies landed in, so a page already open on the
  // other record shows the mirrored comment without a manual refresh.
  if (written.some((t) => t.kind === "task")) {
    void qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
  }
  if (written.some((t) => t.kind === "buildRequest")) {
    void qc.invalidateQueries({ queryKey: BUILD_REQUESTS_KEY });
  }
  if (written.some((t) => t.kind === "buildRequestItem")) {
    void qc.invalidateQueries({ queryKey: BUILD_REQUEST_ITEMS_KEY });
  }

  // Notify each side's own audience, minus anyone the original already told.
  const sender: Person = {
    displayName: comment.authorName,
    email: comment.authorEmail,
  };
  const told = [...alreadyNotified];

  for (const target of written) {
    const audience = audienceFor(qc, target.kind, target.id);
    if (!audience) continue;

    const recipients = withoutAlreadyNotified(
      commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: audience.watchers,
        assignees: audience.assignees,
        authorEmail: comment.authorEmail,
      }),
      told,
    );
    if (recipients.length === 0) continue;

    // Accumulate as we go, so two mirror targets sharing a watcher don't each
    // email them.
    told.push(...recipients);

    void notifyMentions({
      recipients,
      sender,
      target: {
        kind: target.kind,
        id: target.id,
        title: audience.title,
      },
      // The email describes the comment itself, so it carries the plain body
      // rather than the banner markup — the banner is a UI affordance for
      // somebody reading the thread, and the email's own link already points
      // at the record it is about.
      commentExcerpt: htmlToPlainText(comment.bodyHtml),
      attachments: [],
    });
  }
}
