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
import { autoWatchFromMentions } from "@/api/autoWatch";
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import { autoWatchers, mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

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
      return { previous };
    },
    onSuccess: (_data, { id, comment }) => {
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

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: issue.watchers,
        directory: issues ? collectSupplierIssuePeople(issues) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, issue.watchers, additions))
        .catch((err: unknown) => console.error("Auto-watch failed for a supplier issue comment:", err));
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SUPPLIER_ISSUES_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY }),
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
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }) => {
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
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: added,
        currentWatchers: issue.watchers,
        directory: issues ? collectSupplierIssuePeople(issues) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, issue.watchers, additions))
        .catch((err: unknown) => console.error("Auto-watch failed for a supplier issue comment edit:", err));
    },
    onError: () => errorToast("Couldn't update the comment — please retry."),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY }),
  });
}

async function applyWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = autoWatchers(currentWatchers, additions);
  const patch = () => patchIssue(qc, id, (i) => ({ ...i, watchers: next }));
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this issue.`
        : `${additions.length} people are now watching this issue.`,
  });
  try {
    await setSupplierIssueWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    qc.invalidateQueries({ queryKey: SUPPLIER_ISSUES_KEY });
  }
}
