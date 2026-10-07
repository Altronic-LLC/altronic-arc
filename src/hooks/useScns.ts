import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addScnComment,
  createScn,
  editScnComment,
  getScn,
  listScns,
  resolveScnSiteUserLookupId,
  setScnAssigned,
  setScnOwner,
  setScnTask,
  setScnWatchers,
  updateScnFields,
} from "@/api/scns";
import type { Person, Scn, ScnInput, ScnLink, ScnPatch } from "@/types/task";
import { applyScnPatch, scnLabel } from "@/lib/scnMapper";
import { scnFieldLabel } from "@/lib/scnFields";
import { autoWatchers, mergePeople } from "@/lib/people";
import { commentNotifyRecipients, extractMentionedRecipients, newlyMentionedHtml } from "@/lib/mentions";
import { fireFieldChangeAlert, notifyMentions } from "@/api/email";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { htmlToPlainText } from "@/lib/htmlText";
import {
  afterMentionAutoWatch,
  beginMentionAutoWatch,
  type MentionAutoWatch,
} from "./mentionAutoWatch";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// SCN hooks — Supply Chain Notices.
//
// The comment thread is the standard one: post → optimistic insert → email
// every watcher, assignee and @-mentioned person → add the mentioned as
// watchers. That path is identical across the other comment threads, so the
// pieces are shared (commentNotifyRecipients, notifyMentions,
// beginMentionAutoWatch) and only the target kind, the cache key and the
// site the lookupIds resolve against differ here.
//
// Field edits are optimistic and DIFFED: the hook hands the API the row as it
// stood before the patch, and only the columns that changed travel.
// =============================================================================

export const SCNS_KEY = ["scns"] as const;

/** For the "ask an admin about X" sentence on a refused write. */
const SITE_LABEL = "ALTRONICSALESTEAM / SCN";

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useScns() {
  return useQuery({
    queryKey: SCNS_KEY,
    queryFn: listScns,
    staleTime: 60_000,
  });
}

/** One SCN out of the cached list. */
export function useScn(id: number | null) {
  const { data: scns = [], ...rest } = useScns();
  return {
    ...rest,
    data: id === null ? undefined : scns.find((s) => s.id === id),
  };
}

/** Everyone already on an SCN — the @-mention picker's starting point. */
export function collectScnPeople(scns: Scn[]): Person[] {
  const lists = scns.map((s) =>
    [...s.assignedTo, ...s.owner, ...s.watchers, s.createdBy].filter((p): p is Person => !!p),
  );
  return mergePeople(...lists);
}

/** The people a comment or a status change reaches besides the watchers. */
function scnAssignees(scn: Scn): Person[] {
  return mergePeople(scn.assignedTo, scn.owner);
}

function patchScn(qc: QueryClient, id: number, update: (s: Scn) => Scn) {
  qc.setQueryData<Scn[]>(SCNS_KEY, (old) => old?.map((s) => (s.id === id ? update(s) : s)));
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export function useCreateScn() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    // Whoever raises an SCN watches it, and so do the people it is assigned
    // to and owned by — see autoWatchers() in lib/people.ts.
    mutationFn: (input: ScnInput) =>
      createScn({
        ...input,
        watchers: autoWatchers(input.watchers, input.assignedTo, input.owner, actor),
      }),
    onSuccess: (created) => {
      // Seed the new SCN into the cache immediately — the form navigates to
      // its page the moment this resolves, and useScn() derives from this
      // same cache. Invalidating alone would land that navigation on a stale
      // list without the new row (the useCreateTask lesson).
      qc.setQueryData<Scn[]>(SCNS_KEY, (old) => (old ? [created, ...old] : [created]));
      void qc.invalidateQueries({ queryKey: SCNS_KEY });
      pushToast({ message: `Raised ${scnLabel(created)}.` });
    },
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, { action: "raise the SCN", site: SITE_LABEL, permission: "creating items" }),
      ),
  });
}

// -----------------------------------------------------------------------------
// Field edits
// -----------------------------------------------------------------------------

/**
 * The row as it stood BEFORE the optimistic patch, keyed on the variables
 * object React Query hands to every lifecycle callback. `onMutate` has
 * already patched the cache by the time `mutationFn` runs, so the diff the
 * API needs can't be read out of the cache there — same arrangement as FAIT's
 * `pendingSignOff`.
 */
const pendingBefore = new WeakMap<object, Scn>();

/**
 * Patch descriptor fields, optimistically. `patch` is keyed by descriptor key
 * (see lib/scnFields.ts) — a string, a string[] for a checklist, a Date |
 * null for a date. Only the columns that actually changed are sent.
 *
 * A change to SCN Status emails the watchers, assignees and owners — the
 * generic field-change alert — with `to !== from` as the guard, read off the
 * row before the patch against the row SharePoint handed back. Re-saving the
 * same status sends nothing.
 */
export function useUpdateScnFields() {
  const qc = useQueryClient();
  // A ref, not a closure over the first render: useCurrentUser re-resolves
  // when its lookupId arrives, and the alert should name whoever is signed in.
  const actor = useCurrentUser();
  const actorRef = useRef(actor);
  actorRef.current = actor;
  return useMutation({
    mutationFn: async (vars: { id: number; patch: ScnPatch }) => {
      // The pre-patch row, or a fresh read when nothing was cached.
      const before = pendingBefore.get(vars) ?? (await getScn(vars.id));
      if (!before) throw new Error(`SCN ${vars.id} not found`);
      return updateScnFields(vars.id, vars.patch, before);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: SCNS_KEY });
      const previous = qc.getQueryData<Scn[]>(SCNS_KEY);
      const before = previous?.find((s) => s.id === vars.id);
      if (before) pendingBefore.set(vars, before);
      patchScn(qc, vars.id, (s) => applyScnPatch(s, vars.patch));
      return { previous, before };
    },
    onSuccess: (updated, _vars, ctx) => {
      patchScn(qc, updated.id, () => updated);
      const before = ctx?.before;
      if (!before) return;
      // Presence in the patch is NOT change: a card re-saved with the same
      // status must stay quiet.
      if (updated.status !== before.status) {
        fireFieldChangeAlert({
          target: { kind: "scn", id: updated.id, title: scnLabel(updated) },
          fieldLabel: scnFieldLabel("status"),
          from: before.status,
          to: updated.status,
          actor: actorRef.current,
          watchers: updated.watchers,
          assignees: scnAssignees(updated),
        });
      }
    },
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SCNS_KEY, ctx.previous);
      errorToast(
        describeListWriteFailure(err, { action: "save that change", site: SITE_LABEL, permission: "editing" }),
      );
    },
    onSettled: (_data, _err, vars) => {
      pendingBefore.delete(vars);
      void qc.invalidateQueries({ queryKey: SCNS_KEY });
    },
  });
}

// -----------------------------------------------------------------------------
// People
// -----------------------------------------------------------------------------

export function useSetScnWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setScnWatchers(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: SCNS_KEY });
      const previous = qc.getQueryData<Scn[]>(SCNS_KEY);
      patchScn(qc, id, (s) => ({ ...s, watchers: people }));
      return { previous };
    },
    onSuccess: (updated) => patchScn(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SCNS_KEY, ctx.previous);
      errorToast(
        describeListWriteFailure(err, { action: "update the watchers", site: SITE_LABEL, permission: "editing" }),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SCNS_KEY }),
  });
}

/**
 * Set (or clear) the SCN's Engineering task — the Task List hyperlink. Its own
 * write; see `setScnTask`.
 */
export function useSetScnTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, link }: { id: number; link: ScnLink | null }) => setScnTask(id, link),
    onMutate: async ({ id, link }) => {
      await qc.cancelQueries({ queryKey: SCNS_KEY });
      const previous = qc.getQueryData<Scn[]>(SCNS_KEY);
      patchScn(qc, id, (s) => ({ ...s, taskList: link }));
      return { previous };
    },
    onSuccess: (updated) => patchScn(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SCNS_KEY, ctx.previous);
      errorToast(
        describeListWriteFailure(err, { action: "set the task", site: SITE_LABEL, permission: "editing" }),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SCNS_KEY }),
  });
}

/** Assigned to and Owner share one shape: the people named also start watching. */
function usePeopleMutation(
  column: "assignedTo" | "owner",
  write: (id: number, people: Person[]) => Promise<Scn>,
  action: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => write(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: SCNS_KEY });
      const previous = qc.getQueryData<Scn[]>(SCNS_KEY);
      patchScn(qc, id, (s) => ({
        ...s,
        [column]: people,
        // The API folds them into Watchers in the same PATCH; show it now.
        watchers: autoWatchers(s.watchers, people),
      }));
      return { previous };
    },
    onSuccess: (updated) => patchScn(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SCNS_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action, site: SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SCNS_KEY }),
  });
}

export function useSetScnAssigned() {
  return usePeopleMutation("assignedTo", setScnAssigned, "update who it's assigned to");
}

export function useSetScnOwner() {
  return usePeopleMutation("owner", setScnOwner, "update the owner");
}

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------

export function useAddScnComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addScnComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: SCNS_KEY });
      const previous = qc.getQueryData<Scn[]>(SCNS_KEY);
      patchScn(qc, id, (s) => ({
        ...s,
        comments: [
          {
            timestamp: new Date(),
            authorName: comment.authorName,
            authorEmail: comment.authorEmail,
            bodyHtml: comment.bodyHtml,
            attachments: [],
          },
          ...s.comments,
        ],
        modifiedAt: new Date(),
      }));
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      return { previous, autoWatch: beginScnMentionAutoWatch(qc, id, comment.bodyHtml) };
    },
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });

      const scn = qc.getQueryData<Scn[]>(SCNS_KEY)?.find((s) => s.id === id);
      if (!scn) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      // Watchers + the assignees and owners, minus the author — the standard
      // rule. Both person columns count as "assigned": each is actively
      // responsible for the notice.
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: scn.watchers,
        assignees: scnAssignees(scn),
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "scn", id: scn.id, title: scnLabel(scn) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(SCNS_KEY, ctx.previous);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: SCNS_KEY });
      }),
  });
}

export function useEditScnComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      bodyHtml,
    }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      bodyHtml: string;
      /** Mentions already in the comment before the edit — not re-notified. */
      previousBodyHtml: string;
    }) => editScnComment(id, target, bodyHtml),
    onMutate: async ({ id, bodyHtml, previousBodyHtml }) => {
      // Only the NEWLY mentioned become watchers — same rule as the email below.
      const newMentions = newlyMentionedHtml(previousBodyHtml, bodyHtml);
      if (newMentions) await qc.cancelQueries({ queryKey: SCNS_KEY });
      return { autoWatch: beginScnMentionAutoWatch(qc, id, newMentions) };
    },
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });

      const scn = qc.getQueryData<Scn[]>(SCNS_KEY)?.find((s) => s.id === id);
      if (!scn) return;

      // Only the NEWLY mentioned are emailed — editing a comment shouldn't
      // re-ping everyone who was already in it.
      const before = new Set(
        extractMentionedRecipients(previousBodyHtml).map((r) => r.email.toLowerCase()),
      );
      const added = extractMentionedRecipients(bodyHtml).filter(
        (r) => !before.has(r.email.toLowerCase()),
      );
      if (added.length === 0) return;

      void notifyMentions({
        recipients: added.map((r) => ({
          displayName: r.displayName,
          email: r.email,
          reason: "mentioned" as const,
        })),
        sender: { displayName: "", email: target.authorEmail },
        target: { kind: "scn", id: scn.id, title: scnLabel(scn) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      errorToast("Couldn't update the comment — please retry.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: SCNS_KEY });
      }),
  });
}

/**
 * Start auto-watch for an SCN comment: the mentioned people appear as
 * watchers immediately and are written once the comment lands. LookupIds
 * resolve against the SCN's own site collection — a lookupId is per
 * collection (see api/autoWatch.ts).
 */
function beginScnMentionAutoWatch(
  qc: QueryClient,
  id: number,
  bodyHtml: string,
): MentionAutoWatch | null {
  const scn = qc.getQueryData<Scn[]>(SCNS_KEY)?.find((s) => s.id === id);
  if (!scn || !bodyHtml) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: scn.watchers,
    directory: () => collectScnPeople(qc.getQueryData<Scn[]>(SCNS_KEY) ?? []),
    resolveLookupId: resolveScnSiteUserLookupId,
    patch: (watchers) => patchScn(qc, id, (s) => ({ ...s, watchers })),
    write: (watchers) => setScnWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: SCNS_KEY }),
    noun: "SCN",
  });
}
