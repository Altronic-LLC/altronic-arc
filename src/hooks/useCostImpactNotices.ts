import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addCostImpactNoticeComment,
  createCostImpactNotice,
  editCostImpactNoticeComment,
  listCostImpactNotices,
  updateCostImpactNoticeFields,
} from "@/api/costImpactNotices";
import type { CostImpactNotice, CostImpactNoticeInput, Person } from "@/types/task";
import { costImpactNoticeLabel } from "@/lib/costImpactNoticeMapper";
import { costImpactNoticeCommentRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { fireNewCostImpactNoticeAlert, notifyMentions } from "@/api/email";
import { mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Cost Impact Notice hooks.
//
// Same shape as ECN's comment thread and for the same reason — no Watchers
// column on this list, so `costImpactNoticeCommentRecipients` notifies the
// submitter plus whoever is @-mentioned, and nobody else. No auto-watch on a
// mention either: mentioning someone emails them once about that comment,
// it doesn't subscribe them to the thread.
//
// What IS on this list that ECNs don't have: a fixed intake alert on every
// CREATE (see `fireNewCostImpactNoticeAlert`) — Supply Chain named six
// people who need to know a cost changed the moment it's raised, not just
// whenever someone next comments on it.
//
// Field edits are optimistic and single-column, so a choice pill on the
// detail page doesn't sit there for a round-trip.
// =============================================================================

export const COST_IMPACT_NOTICES_KEY = ["costImpactNotices"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useCostImpactNotices() {
  return useQuery({
    queryKey: COST_IMPACT_NOTICES_KEY,
    queryFn: listCostImpactNotices,
    staleTime: 60_000,
  });
}

/** One notice out of the cached list. */
export function useCostImpactNotice(id: number | null) {
  const { data: notices = [], ...rest } = useCostImpactNotices();
  return {
    ...rest,
    data: id === null ? undefined : notices.find((n) => n.id === id),
  };
}

/** Everyone already on a notice — the @-mention picker's starting point. Submitters only, same as ECNs. */
export function collectCostImpactNoticePeople(notices: CostImpactNotice[]): Person[] {
  return mergePeople(notices.map((n) => (n.submittedBy ? [n.submittedBy] : [])).flat());
}

function patchNotice(
  qc: QueryClient,
  id: number,
  update: (n: CostImpactNotice) => CostImpactNotice,
) {
  qc.setQueryData<CostImpactNotice[]>(COST_IMPACT_NOTICES_KEY, (old) =>
    old?.map((n) => (n.id === id ? update(n) : n)),
  );
}

export function useCreateCostImpactNotice() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: (input: CostImpactNoticeInput) => createCostImpactNotice(input, actor),
    onSuccess: (created) => {
      qc.setQueryData<CostImpactNotice[]>(COST_IMPACT_NOTICES_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: COST_IMPACT_NOTICES_KEY });
      pushToast({ message: `Raised a cost impact notice for ${costImpactNoticeLabel(created)}.` });

      // Nothing watches the list itself, so a new notice used to sit until
      // someone opened ARC and noticed it. The configured intake list is
      // told on every create (Ray, 2026-08-27) — see COST_IMPACT_NOTICE_ALERTS.
      fireNewCostImpactNoticeAlert({
        target: { kind: "costImpactNotice", id: created.id, title: costImpactNoticeLabel(created) },
        actor,
        details: newNoticeDetails(created),
      });
    },
    onError: (err: Error) => errorToast(`Couldn't raise the notice: ${err.message}`),
  });
}

/** What the intake email says about a new notice — the cost figures the alert exists for. */
function newNoticeDetails(n: CostImpactNotice) {
  return [
    { label: "Supplier", value: n.supplier },
    { label: "SAP Number", value: n.sapNumber },
    { label: "Original Cost", value: n.originalCost },
    { label: "New Cost", value: n.newCost },
    { label: "Delta", value: n.deltaCost !== null ? n.deltaCost.toFixed(2) : "" },
    { label: "Time of Impact", value: n.timeOfImpact ?? "" },
  ];
}

/** Patch one or more columns, optimistically. */
export function useUpdateCostImpactNoticeFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: number;
      fields: Record<string, unknown>;
      patch: (n: CostImpactNotice) => CostImpactNotice;
    }) => updateCostImpactNoticeFields(id, fields),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: COST_IMPACT_NOTICES_KEY });
      const previous = qc.getQueryData<CostImpactNotice[]>(COST_IMPACT_NOTICES_KEY);
      patchNotice(qc, id, patch);
      return { previous };
    },
    onSuccess: (updated) => {
      patchNotice(qc, updated.id, () => updated);
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(COST_IMPACT_NOTICES_KEY, ctx.previous);
      errorToast(`Couldn't save that change — reverted. ${err.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: COST_IMPACT_NOTICES_KEY }),
  });
}

export function useAddCostImpactNoticeComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addCostImpactNoticeComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: COST_IMPACT_NOTICES_KEY });
      const previous = qc.getQueryData<CostImpactNotice[]>(COST_IMPACT_NOTICES_KEY);
      patchNotice(qc, id, (n) => ({
        ...n,
        comments: [
          { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
          ...n.comments,
        ],
        modifiedAt: new Date(),
      }));
      return { previous };
    },
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const notice = qc.getQueryData<CostImpactNotice[]>(COST_IMPACT_NOTICES_KEY)?.find((n) => n.id === id);
      if (!notice) return;

      // The submitter and the mentioned — no watchers on this list. See the note at the top of the file.
      const recipients = costImpactNoticeCommentRecipients({
        bodyHtml: comment.bodyHtml,
        submittedBy: notice.submittedBy,
        authorEmail: comment.authorEmail,
      });
      if (recipients.length === 0) return;

      void notifyMentions({
        recipients,
        sender: { displayName: comment.authorName, email: comment.authorEmail },
        target: { kind: "costImpactNotice", id: notice.id, title: costImpactNoticeLabel(notice) },
        commentExcerpt: htmlToPlainText(comment.bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(COST_IMPACT_NOTICES_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: COST_IMPACT_NOTICES_KEY }),
  });
}

export function useEditCostImpactNoticeComment() {
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
      previousBodyHtml: string;
    }) => editCostImpactNoticeComment(id, target, bodyHtml),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }) => {
      pushToast({ message: "Comment updated." });

      const notice = qc.getQueryData<CostImpactNotice[]>(COST_IMPACT_NOTICES_KEY)?.find((n) => n.id === id);
      if (!notice) return;

      const before = new Set(
        extractMentionedRecipients(previousBodyHtml).map((r) => r.email.toLowerCase()),
      );
      const added = extractMentionedRecipients(bodyHtml).filter(
        (r) => !before.has(r.email.toLowerCase()),
      );
      if (added.length === 0) return;

      void notifyMentions({
        recipients: added.map((r) => ({ displayName: r.displayName, email: r.email, reason: "mentioned" as const })),
        sender: { displayName: "", email: target.authorEmail },
        target: { kind: "costImpactNotice", id: notice.id, title: costImpactNoticeLabel(notice) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: () => errorToast("Couldn't update the comment — please retry."),
    onSettled: () => qc.invalidateQueries({ queryKey: COST_IMPACT_NOTICES_KEY }),
  });
}
