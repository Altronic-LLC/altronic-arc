import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addEcnComment,
  createEcn,
  editEcnComment,
  listEcns,
  updateEcnFields,
} from "@/api/ecns";
import type { Ecn, EcnInput, Person } from "@/types/task";
import { ecnLabel } from "@/lib/ecnMapper";
import { ecnCommentRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { notifyMentions } from "@/api/email";
import { mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// ECN hooks.
//
// The comment thread here is the ONE that doesn't follow the house rules, and
// it's deliberate (Ray, 2026-08-19):
//
//   **No watchers.** Six other entities notify every watcher and work hard to
//   keep that list filled — creators, assignees and anyone mentioned all get
//   added automatically. An ECN notifies the person who submitted it plus
//   anyone @-mentioned in the comment, and nobody else. There is no Watchers
//   column on the list to store one, and no watch button on the page, so
//   there is no half-state where the UI implies a subscription that isn't
//   stored. `ecnCommentRecipients` in lib/mentions.ts is the whole rule.
//
//   **No auto-watch on a mention.** Following from the above: mentioning
//   someone emails them, once, about that comment. It does not subscribe them
//   to the thread. If they should hear about the next one, mention them again.
//
// Field edits are optimistic and single-column, so a checkbox on the detail
// page doesn't sit there for a round-trip.
// =============================================================================

export const ECN_KEY = ["ecns"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useEcns() {
  return useQuery({
    queryKey: ECN_KEY,
    queryFn: listEcns,
    staleTime: 60_000,
  });
}

/** One ECN out of the cached list. */
export function useEcn(id: number | null) {
  const { data: ecns = [], ...rest } = useEcns();
  return {
    ...rest,
    data: id === null ? undefined : ecns.find((e) => e.id === id),
  };
}

/**
 * Everyone already on an ECN — the @-mention picker's starting point.
 *
 * Submitters only, since that's the only person the list records. The picker
 * merges this with the tenant directory, so anyone at Altronic is still
 * mentionable; this just puts the people already involved at the top.
 */
export function collectEcnPeople(ecns: Ecn[]): Person[] {
  return mergePeople(ecns.map((e) => (e.submittedBy ? [e.submittedBy] : [])).flat());
}

function patchEcn(qc: QueryClient, id: number, update: (e: Ecn) => Ecn) {
  qc.setQueryData<Ecn[]>(ECN_KEY, (old) => old?.map((e) => (e.id === id ? update(e) : e)));
}

export function useCreateEcn() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: (input: EcnInput) => createEcn(input, actor),
    onSuccess: (created) => {
      qc.setQueryData<Ecn[]>(ECN_KEY, (old) => (old ? [created, ...old] : [created]));
      qc.invalidateQueries({ queryKey: ECN_KEY });
      pushToast({ message: `Raised ${ecnLabel(created)}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't raise the ECN: ${err.message}`),
  });
}

/** Patch one or more columns, optimistically. */
export function useUpdateEcnFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: number;
      fields: Record<string, unknown>;
      patch: (e: Ecn) => Ecn;
    }) => updateEcnFields(id, fields),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ECN_KEY });
      const previous = qc.getQueryData<Ecn[]>(ECN_KEY);
      patchEcn(qc, id, patch);
      return { previous };
    },
    onSuccess: (updated) => {
      patchEcn(qc, updated.id, () => updated);
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ECN_KEY, ctx.previous);
      errorToast(`Couldn't save that change — reverted. ${err.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ECN_KEY }),
  });
}

export function useAddEcnComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addEcnComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: ECN_KEY });
      const previous = qc.getQueryData<Ecn[]>(ECN_KEY);
      patchEcn(qc, id, (e) => ({
        ...e,
        comments: [
          {
            timestamp: new Date(),
            authorName: comment.authorName,
            authorEmail: comment.authorEmail,
            bodyHtml: comment.bodyHtml,
            attachments: [],
          },
          ...e.comments,
        ],
        modifiedAt: new Date(),
      }));
      return { previous };
    },
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const ecn = qc.getQueryData<Ecn[]>(ECN_KEY)?.find((e) => e.id === id);
      if (!ecn) return;

      // The submitter and the mentioned — no watchers on this one. See the
      // note at the top of the file.
      const recipients = ecnCommentRecipients({
        bodyHtml: comment.bodyHtml,
        submittedBy: ecn.submittedBy,
        authorEmail: comment.authorEmail,
      });
      if (recipients.length === 0) return;

      void notifyMentions({
        recipients,
        sender: { displayName: comment.authorName, email: comment.authorEmail },
        target: { kind: "ecn", id: ecn.id, title: ecnLabel(ecn) },
        commentExcerpt: htmlToPlainText(comment.bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ECN_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ECN_KEY }),
  });
}

export function useEditEcnComment() {
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
    }) => editEcnComment(id, target, bodyHtml),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }) => {
      pushToast({ message: "Comment updated." });

      const ecn = qc.getQueryData<Ecn[]>(ECN_KEY)?.find((e) => e.id === id);
      if (!ecn) return;

      // Only the NEWLY mentioned are emailed — editing a comment shouldn't
      // re-ping everyone who was already in it, and the submitter hears about
      // new comments rather than every wording change.
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
        target: { kind: "ecn", id: ecn.id, title: ecnLabel(ecn) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: () => errorToast("Couldn't update the comment — please retry."),
    onSettled: () => qc.invalidateQueries({ queryKey: ECN_KEY }),
  });
}
