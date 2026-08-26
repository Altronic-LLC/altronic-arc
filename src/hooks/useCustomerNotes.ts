import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addCustomerNoteComment,
  createCustomerNote,
  deleteCustomerNote,
  editCustomerNoteComment,
  listCustomerNotes,
  updateCustomerNoteDetails,
  updateCustomerNotePeople,
  updateCustomerNoteText,
} from "@/api/customerNotes";
import type { CustomerNote, CustomerNoteInput, Person } from "@/types/task";
import { customerNoteLabel } from "@/lib/customerNoteMapper";
import { customerNoteCommentRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { notifyMentions } from "@/api/email";
import { mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Customer Notes hooks — the CRM tool's anchor list.
//
// The comment thread here follows the ECN rule, not the house rule: there are
// no watchers, and — unlike an ECN — no submitter either, so a comment
// notifies @-mentioned people ONLY. See `customerNoteCommentRecipients` in
// lib/mentions.ts.
// =============================================================================

export const CUSTOMER_NOTES_KEY = ["customerNotes"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useCustomerNotes() {
  return useQuery({
    queryKey: CUSTOMER_NOTES_KEY,
    queryFn: listCustomerNotes,
    staleTime: 60_000,
  });
}

/** One customer out of the cached list. */
export function useCustomerNote(id: number | null) {
  const { data: notes = [], ...rest } = useCustomerNotes();
  return {
    ...rest,
    data: id === null ? undefined : notes.find((c) => c.id === id),
  };
}

/** Everyone already recorded against a customer — the @-mention picker's starting point. */
export function collectCustomerNotePeople(notes: CustomerNote[]): Person[] {
  return mergePeople(notes.flatMap((n) => [...n.csr, ...(n.kam ? [n.kam] : [])]));
}

function patchCustomerNote(qc: QueryClient, id: number, update: (c: CustomerNote) => CustomerNote) {
  qc.setQueryData<CustomerNote[]>(CUSTOMER_NOTES_KEY, (old) =>
    old?.map((c) => (c.id === id ? update(c) : c)),
  );
}

export function useCreateCustomerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerNoteInput) => createCustomerNote(input),
    onSuccess: (created) => {
      qc.setQueryData<CustomerNote[]>(CUSTOMER_NOTES_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: CUSTOMER_NOTES_KEY });
      pushToast({ message: `Added ${customerNoteLabel(created)}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't add the customer: ${err.message}`),
  });
}

export function useUpdateCustomerNoteDetails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      changed,
    }: {
      id: number;
      changed: Parameters<typeof updateCustomerNoteDetails>[1];
    }) => updateCustomerNoteDetails(id, changed),
    onSuccess: (updated) => patchCustomerNote(qc, updated.id, () => updated),
    onError: (err: Error) => errorToast(`Couldn't save that change. ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_NOTES_KEY }),
  });
}

export function useUpdateCustomerNotePeople() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      people,
    }: {
      id: number;
      people: { csr?: Person[]; kam?: Person | null };
    }) => updateCustomerNotePeople(id, people),
    onSuccess: (updated) => patchCustomerNote(qc, updated.id, () => updated),
    onError: (err: Error) => errorToast(`Couldn't save that change. ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_NOTES_KEY }),
  });
}

export function useUpdateCustomerNoteText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      changed,
    }: {
      id: number;
      changed: { generalNotes?: string; complianceNotes?: string };
    }) => updateCustomerNoteText(id, changed),
    onSuccess: (updated) => patchCustomerNote(qc, updated.id, () => updated),
    onError: (err: Error) => errorToast(`Couldn't save that change. ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_NOTES_KEY }),
  });
}

export function useDeleteCustomerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCustomerNote(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<CustomerNote[]>(CUSTOMER_NOTES_KEY, (old) =>
        old?.filter((c) => c.id !== id),
      );
      pushToast({ message: "Customer removed." });
    },
    onError: (err: Error) => errorToast(`Couldn't remove the customer: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_NOTES_KEY }),
  });
}

export function useAddCustomerNoteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addCustomerNoteComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: CUSTOMER_NOTES_KEY });
      const previous = qc.getQueryData<CustomerNote[]>(CUSTOMER_NOTES_KEY);
      patchCustomerNote(qc, id, (c) => ({
        ...c,
        comments: [
          {
            timestamp: new Date(),
            authorName: comment.authorName,
            authorEmail: comment.authorEmail,
            bodyHtml: comment.bodyHtml,
            attachments: [],
          },
          ...c.comments,
        ],
        modifiedAt: new Date(),
      }));
      return { previous };
    },
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const note = qc.getQueryData<CustomerNote[]>(CUSTOMER_NOTES_KEY)?.find((c) => c.id === id);
      if (!note) return;

      // @-mentioned people only — no watchers and no submitter on this list.
      const recipients = customerNoteCommentRecipients({
        bodyHtml: comment.bodyHtml,
        authorEmail: comment.authorEmail,
      });
      if (recipients.length === 0) return;

      void notifyMentions({
        recipients,
        sender: { displayName: comment.authorName, email: comment.authorEmail },
        target: { kind: "customerNote", id: note.id, title: customerNoteLabel(note) },
        commentExcerpt: htmlToPlainText(comment.bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(CUSTOMER_NOTES_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_NOTES_KEY }),
  });
}

export function useEditCustomerNoteComment() {
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
    }) => editCustomerNoteComment(id, target, bodyHtml),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }) => {
      pushToast({ message: "Comment updated." });

      const note = qc.getQueryData<CustomerNote[]>(CUSTOMER_NOTES_KEY)?.find((c) => c.id === id);
      if (!note) return;

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
        target: { kind: "customerNote", id: note.id, title: customerNoteLabel(note) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: () => errorToast("Couldn't update the comment — please retry."),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_NOTES_KEY }),
  });
}
