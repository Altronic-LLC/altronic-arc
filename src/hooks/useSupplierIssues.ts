import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addSupplierIssueComment,
  createSupplierIssue,
  editSupplierIssueComment,
  listSupplierIssues,
  setSupplierIssueWatchers,
  updateSupplierIssueFields,
} from "@/api/supplierIssues";
import type { Person, SupplierIssue, SupplierIssueInput } from "@/types/task";
import { supplierIssueLabel } from "@/lib/supplierIssueMapper";
import { commentNotifyRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { notifyMentions } from "@/api/email";
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import { autoWatchers, mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";
import {
  afterMentionAutoWatch,
  beginMentionAutoWatch,
  type MentionAutoWatch,
} from "./mentionAutoWatch";
import { newlyMentionedHtml } from "@/lib/mentions";

// =============================================================================
// Supplier Issue Tracker hooks. Same comment/watcher/auto-watch shape as
// useSuppliers.ts and useSupplierContacts.ts — see those for the reasoning.
// No delete hook: an issue is a record that something happened, closed by
// resolving it, not removing it.
// =============================================================================

export const SUPPLIER_ISSUES_KEY = ["supplierIssues"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useSupplierIssues() {
  return useQuery({
    queryKey: SUPPLIER_ISSUES_KEY,
    queryFn: listSupplierIssues,
    staleTime: 60_000,
  });
}

/** Every issue for one supplier, already sorted newest-first by the API. */
export function useSupplierIssuesFor(supplierId: number | null) {
  const { data: issues = [], ...rest } = useSupplierIssues();
  return {
    ...rest,
    data: supplierId === null ? [] : issues.filter((i) => i.supplierId === supplierId),
  };
}

export function collectSupplierIssuePeople(issues: SupplierIssue[]): Person[] {
  return mergePeople(issues.flatMap((i) => i.watchers));
}

function patchIssue(qc: QueryClient, id: number, update: (i: SupplierIssue) => SupplierIssue) {
  qc.setQueryData<SupplierIssue[]>(SUPPLIER_ISSUES_KEY, (old) =>
    old?.map((i) => (i.id === id ? update(i) : i)),
  );
}

export function useCreateSupplierIssue() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: (input: SupplierIssueInput) =>
      createSupplierIssue({ ...input, watchers: autoWatchers(input.watchers, actor) }),
    onSuccess: (created) => {
      qc.setQueryData<SupplierIssue[]>(SUPPLIER_ISSUES_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      pushToast({ message: `Logged ${supplierIssueLabel(created)}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't log the issue: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY }),
  });
}

export function useUpdateSupplierIssueFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      changed,
    }: {
      id: number;
      changed: Parameters<typeof updateSupplierIssueFields>[1];
    }) => updateSupplierIssueFields(id, changed),
    onSuccess: (updated) => patchIssue(qc, updated.id, () => updated),
    onError: (err: Error) => errorToast(`Couldn't save that change: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY }),
  });
}

export function useSetSupplierIssueWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setSupplierIssueWatchers(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: SUPPLIER_ISSUES_KEY });
      const previous = qc.getQueryData<SupplierIssue[]>(SUPPLIER_ISSUES_KEY);
      patchIssue(qc, id, (i) => ({ ...i, watchers: people }));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SUPPLIER_ISSUES_KEY, ctx.previous);
      errorToast("Couldn't update the watchers — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY }),
  });
}

export function useAddSupplierIssueComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addSupplierIssueComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: SUPPLIER_ISSUES_KEY });
      const previous = qc.getQueryData<SupplierIssue[]>(SUPPLIER_ISSUES_KEY);
      patchIssue(qc, id, (i) => ({
        ...i,
        comments: [
          { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
          ...i.comments,
        ],
        modifiedAt: new Date(),
      }));
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      const autoWatch = beginIssueMentionAutoWatch(qc, id, comment.bodyHtml);
      return { previous, autoWatch };
    },
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });

      const issues = qc.getQueryData<SupplierIssue[]>(SUPPLIER_ISSUES_KEY);
      const issue = issues?.find((i) => i.id === id);
      if (!issue) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: issue.watchers,
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "supplierIssue", id: issue.id, title: supplierIssueLabel(issue) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(SUPPLIER_ISSUES_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => void qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY })),
  });
}

export function useEditSupplierIssueComment() {
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
    }) => editSupplierIssueComment(id, target, bodyHtml),
    // Only mentions the edit ADDED subscribe anyone — same rule as before,
    // now started the moment Save is pressed.
    onMutate: ({ id, bodyHtml, previousBodyHtml }) => ({
      autoWatch: beginIssueMentionAutoWatch(qc, id, newlyMentionedHtml(previousBodyHtml, bodyHtml)),
    }),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });

      const issues = qc.getQueryData<SupplierIssue[]>(SUPPLIER_ISSUES_KEY);
      const issue = issues?.find((i) => i.id === id);
      if (!issue) return;

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
        target: { kind: "supplierIssue", id: issue.id, title: supplierIssueLabel(issue) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      errorToast("Couldn't update the comment — please retry.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => void qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY })),
  });
}

/**
 * Start auto-watch for a supplier issue comment: the mentioned people appear as
 * watchers immediately and are written once the comment lands.
 */
function beginIssueMentionAutoWatch(
  qc: QueryClient,
  id: number,
  bodyHtml: string,
): MentionAutoWatch | null {
  const issue = qc.getQueryData<SupplierIssue[]>(SUPPLIER_ISSUES_KEY)?.find((i) => i.id === id);
  if (!issue) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: issue.watchers,
    directory: () => collectSupplierIssuePeople(qc.getQueryData<SupplierIssue[]>(SUPPLIER_ISSUES_KEY) ?? []),
    resolveLookupId: resolvePmoSiteUserLookupId,
    patch: (watchers) => patchIssue(qc, id, (i) => ({ ...i, watchers })),
    write: (watchers) => setSupplierIssueWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY }),
    noun: "issue",
  });
}
