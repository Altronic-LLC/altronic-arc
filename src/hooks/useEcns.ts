import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addEcnComment,
  createEcn,
  deleteEcn,
  ecnDistributionAvailable,
  editEcnComment,
  getEcn,
  listEcns,
  updateEcnFields,
} from "@/api/ecns";
import type { Ecn, EcnInput, Person, ProjectReference } from "@/types/task";
import { ecnDistributedPatch, ecnLabel } from "@/lib/ecnMapper";
import { ecnCommentRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { notifyChangeEmails, notifyMentions } from "@/api/email";
import { mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";
import { createEcnChecklist } from "@/api/ecnChecklists";
import { ECN_CHECKLISTS_KEY } from "./useEcnChecklists";
import { useIsAdmin } from "./useIsAdmin";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { ecnDistributionGroupsConfigured } from "@/api/ecnDistributionGroups";
import {
  buildEcnDistributionEmails,
  canSendDistributionNow,
  ecnDistributionRecipients,
  shouldDistributeEcn,
} from "@/lib/ecnDistribution";
import { readEcnDistributionGroups } from "./useEcnDistributionGroups";
import { PROJECTS_KEY } from "./useTasks";

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

      // Every new ECN gets its Cross-Functional Checklist automatically (Ray,
      // 2026-09-15). BEST-EFFORT and deliberately after the ECN is already in
      // the cache: the ECN is real at this point, so a failed checklist write
      // must warn rather than make a successful create look like it failed —
      // the same rule as the EIR→Task promotion's follow-up writes. The
      // "Create checklist" button on the ECN's own page is the recovery, and
      // is also how the 1,800+ ECNs that predate this feature get one.
      void createEcnChecklist(created.id, created.logNo, actor)
        .then(() => {
          void qc.invalidateQueries({ queryKey: ECN_CHECKLISTS_KEY });
        })
        .catch((err: Error) => {
          pushToast({
            message:
              `${ecnLabel(created)} was raised, but its checklist couldn't be created ` +
              `(${err.message}). Open the ECN and press "Create checklist".`,
            variant: "error",
          });
        });
    },
    onError: (err: Error) => errorToast(`Couldn't raise the ECN: ${err.message}`),
  });
}

/** Patch one or more columns, optimistically. */
export function useUpdateEcnFields() {
  const qc = useQueryClient();
  const actor = useActorRef();
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
      // The row as it stood BEFORE the optimistic patch — after it, a sign-off
      // being filled in already reads as filled in, and nothing would send.
      const before = previous?.find((e) => e.id === id);
      patchEcn(qc, id, patch);
      return { previous, before };
    },
    onSuccess: (updated, _vars, ctx) => {
      patchEcn(qc, updated.id, () => updated);
      // BusinessIT#57: the FIRST time Sign-off status is filled in, the ECN
      // goes to its distribution. `updated` is SharePoint's row after the
      // PATCH, so an ECN somebody else already sent isn't sent twice.
      if (shouldDistributeEcn(ctx?.before, updated)) {
        void distributeEcn(qc, updated, actor.current);
      }
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
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
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

/**
 * Delete an ECN — ADMIN-ONLY (Ray, 2026-09-28).
 *
 * The check is HERE, in the mutationFn, as well as on the button, so no future
 * screen or bulk action can delete without it — the Teradyne Log / QC Time
 * arrangement. SharePoint's own permissions remain the real boundary, and
 * deleting an item needs more than editing one, so a refusal is worded by
 * `describeListWriteFailure` rather than shown raw.
 */
export function useDeleteEcn() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (id: number) => {
      if (!isAdmin) throw new Error("Only admins can delete ECNs.");
      return deleteEcn(id);
    },
    onSuccess: (_void, id) => {
      qc.setQueryData<Ecn[]>(ECN_KEY, (old) => old?.filter((e) => e.id !== id));
      qc.invalidateQueries({ queryKey: ECN_KEY });
      pushToast({ message: "ECN deleted." });
    },
    onError: (err: Error) => {
      // Nothing was removed — refetch so the screen matches SharePoint.
      qc.invalidateQueries({ queryKey: ECN_KEY });
      errorToast(
        describeListWriteFailure(err, { action: "delete that ECN", site: "Altronic_Engineering" }),
      );
    },
  });
}

// =============================================================================
// Distribution (BusinessIT#57) — the first time Sign-off status is filled in,
// the ECN is emailed to everyone in its ticked roles (lib/ecnDistribution.ts
// for the rules), and who it went to is recorded on the ECN.
// =============================================================================

/** The signed-in user, read when a callback fires rather than on first render. */
function useActorRef() {
  const user = useCurrentUser();
  const ref = useRef<Person>(user);
  ref.current = user;
  return ref;
}

function projectTitleFor(qc: QueryClient, ecn: Ecn): string | null {
  const id = ecn.parentProject?.lookupId;
  if (!id) return null;
  return qc.getQueryData<ProjectReference[]>(PROJECTS_KEY)?.find((p) => p.lookupId === id)?.title ?? null;
}

/**
 * Email an ECN to its distribution and record who it went to. Never throws —
 * it runs after a save that has already landed, so every outcome is a toast.
 * Returns whether anybody was emailed.
 *
 * Groups are read FRESH, so an admin's change reaches the next ECN at once.
 */
export async function distributeEcn(qc: QueryClient, ecn: Ecn, actor: Person): Promise<boolean> {
  const label = ecnLabel(ecn);
  try {
    if (!ecnDistributionAvailable()) return false;
    if (!ecnDistributionGroupsConfigured()) {
      pushToast({
        message:
          `${label} is signed off, but ECN distribution groups aren't set up yet, so nobody was emailed. ` +
          "Once they are, press Send now on the ECN's Distribution card.",
        variant: "error",
      });
      return false;
    }
    if (ecn.distribution.length === 0) {
      pushToast({
        message: `${label} is signed off. No distribution roles are ticked, so nobody was emailed.`,
      });
      return false;
    }
    const groups = await readEcnDistributionGroups(qc);
    const recipients = ecnDistributionRecipients(groups, ecn.distribution);
    const emails = buildEcnDistributionEmails({
      ecn,
      label,
      recipients,
      actor,
      projectTitle: projectTitleFor(qc, ecn),
    });
    if (emails.length === 0) {
      pushToast({
        message:
          `${label} is signed off, but nobody${recipients.length > 0 ? " else" : ""} is set up for its ` +
          "ticked distribution roles, so nobody was emailed.",
        variant: "error",
      });
      return false;
    }
    const result = await notifyChangeEmails({
      target: { kind: "ecn", id: ecn.id, title: label },
      emails,
    });
    // A failed send toasts itself (api/email.ts). Nothing is recorded, so the
    // Distribution card keeps offering Send now.
    if (result.sent.length === 0) return false;

    const sent = new Set(result.sent.map((e) => e.toLowerCase()));
    const people = recipients
      .filter((r) => sent.has(r.email.toLowerCase()))
      .map((r) => ({ displayName: r.displayName, email: r.email }));
    const n = people.length;
    try {
      const recorded = await updateEcnFields(ecn.id, ecnDistributedPatch(people, new Date()));
      patchEcn(qc, recorded.id, () => recorded);
      pushToast({ message: `Emailed ${label} to ${n} ${n === 1 ? "person" : "people"} on its distribution.` });
    } catch (err) {
      pushToast({
        message:
          `Emailed ${label} to ${n} ${n === 1 ? "person" : "people"}, but couldn't record that on the ECN ` +
          `(${err instanceof Error ? err.message : "unknown error"}). Don't press Send now — they have it.`,
        variant: "error",
      });
    }
    void qc.invalidateQueries({ queryKey: ECN_KEY });
    return true;
  } catch (err) {
    pushToast({
      message: `${label} is signed off, but its distribution couldn't be emailed (${
        err instanceof Error ? err.message : "unknown error"
      }). Press Send now on the ECN to try again.`,
      variant: "error",
    });
    return false;
  }
}

/**
 * Send now — the recovery for an ECN whose Sign-off status is filled in but
 * which was never sent (nobody set up at the time, a failed send, or an ECN
 * signed off before this existed). Re-reads the ECN first, so two people
 * pressing it a minute apart don't both send.
 */
export function useSendEcnDistribution() {
  const qc = useQueryClient();
  const actor = useActorRef();
  return useMutation({
    mutationFn: async (id: number) => {
      const fresh = await getEcn(id);
      if (!fresh) throw new Error("That ECN couldn't be read — refresh and try again.");
      if (fresh.distributedAt) {
        patchEcn(qc, id, () => fresh);
        throw new Error(`${ecnLabel(fresh)} was already sent to its distribution.`);
      }
      if (!canSendDistributionNow(fresh)) {
        throw new Error("Fill in Sign-off status first — that is what sends the ECN.");
      }
      return distributeEcn(qc, fresh, actor.current);
    },
    onError: (err: Error) => errorToast(err.message),
  });
}
