import { addComment as addTaskComment } from "./tasks";
import { addBuildRequestComment } from "./buildRequests";
import { addBuildRequestItemComment } from "./buildRequestItems";
import {
  buildMirroredBody,
  type CommentOrigin,
  type MirrorTarget,
} from "@/lib/commentMirror";

// =============================================================================
// WRITING the mirrors — the one place that fans a comment out.
//
// Shared by all three comment hooks (task, build request header, part) for the
// reason `api/autoWatch.ts` is shared: three copies of a fan-out is how one
// direction quietly stops working. `lib/commentMirror.ts` holds the pure
// wording and routing; this file only performs the writes.
//
// **BEST-EFFORT, PER TARGET, and it NEVER throws.** The original comment has
// already been written and is on screen by the time this runs — the same rule
// as the EIR→Task promotion's follow-up writes and Panel QC's staged
// attachments. A failed mirror must not make a successful comment look
// failed, and one failed target must not lose the other.
//
// It reports what happened rather than swallowing it, so the caller can toast
// a partial failure. A mirror that silently didn't land is the outcome worth
// avoiding: the person reading the task would have no idea a reply exists.
// =============================================================================

export interface MirrorCommentResult {
  /** Targets the copy reached. */
  written: MirrorTarget[];
  /** Targets that refused, with the reason. */
  failed: { target: MirrorTarget; error: unknown }[];
}

function writeTo(
  target: MirrorTarget,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<unknown> {
  switch (target.kind) {
    case "task":
      return addTaskComment(target.id, comment);
    case "buildRequest":
      return addBuildRequestComment(target.id, comment);
    case "buildRequestItem":
      return addBuildRequestItemComment(target.id, comment);
  }
}

/**
 * Copy one comment onto every mirror target.
 *
 * The body is wrapped with the ORIGIN of where it was actually posted — not
 * of the target — so every copy's banner points a reader back to the one
 * thread where a reply belongs.
 *
 * Author and timestamp are the original's: `addComment` stamps "now", which
 * is within a second of the real post, and the AUTHOR is passed through
 * unchanged so a mirrored comment is never credited to whoever happened to
 * trigger the fan-out.
 *
 * Targets are written in PARALLEL — they are different lists, nothing orders
 * them, and a slow task list shouldn't delay the build request's copy.
 */
export async function mirrorComment(args: {
  targets: MirrorTarget[];
  comment: { authorName: string; authorEmail: string; bodyHtml: string };
  origin: CommentOrigin;
}): Promise<MirrorCommentResult> {
  const { targets, comment, origin } = args;
  if (targets.length === 0) return { written: [], failed: [] };

  const body = buildMirroredBody(comment.bodyHtml, origin);

  const settled = await Promise.allSettled(
    targets.map((target) => writeTo(target, { ...comment, bodyHtml: body })),
  );

  const written: MirrorTarget[] = [];
  const failed: { target: MirrorTarget; error: unknown }[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") written.push(targets[i]);
    else failed.push({ target: targets[i], error: outcome.reason });
  });

  return { written, failed };
}

/** "the task" / "the build request" / "the part" — for a failure toast. */
export function describeMirrorTarget(target: MirrorTarget): string {
  switch (target.kind) {
    case "task":
      return "the linked task";
    case "buildRequest":
      return "the linked build request";
    case "buildRequestItem":
      return "the build request part";
  }
}
