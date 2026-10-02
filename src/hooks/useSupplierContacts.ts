import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addSupplierContactComment,
  createSupplierContact,
  deleteSupplierContact,
  editSupplierContactComment,
  listSupplierContacts,
  setSupplierContactWatchers,
  updateSupplierContactFields,
} from "@/api/supplierContacts";
import type { Person, SupplierContact, SupplierContactInput } from "@/types/task";
import { supplierContactLabel } from "@/lib/supplierContactMapper";
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
// Supplier Contacts hooks. The whole list is fetched once and scoped to one
// supplier in the component (useContactsFor) — same shape as the CRM Tool's
// Customer Contacts. Unlike Customer Contacts, this list carries its own
// Communication/Watchers thread, so the comment plumbing here mirrors
// useSuppliers.ts rather than being a plain CRUD hook.
// =============================================================================

export const SUPPLIER_CONTACTS_KEY = ["supplierContacts"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useSupplierContacts() {
  return useQuery({
    queryKey: SUPPLIER_CONTACTS_KEY,
    queryFn: listSupplierContacts,
    staleTime: 60_000,
  });
}

/** Every contact for one supplier, already sorted by the API. */
export function useSupplierContactsFor(supplierId: number | null) {
  const { data: contacts = [], ...rest } = useSupplierContacts();
  return {
    ...rest,
    data: supplierId === null ? [] : contacts.filter((c) => c.supplierId === supplierId),
  };
}

export function collectSupplierContactPeople(contacts: SupplierContact[]): Person[] {
  return mergePeople(contacts.flatMap((c) => c.watchers));
}

function patchContact(qc: QueryClient, id: number, update: (c: SupplierContact) => SupplierContact) {
  qc.setQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY, (old) =>
    old?.map((c) => (c.id === id ? update(c) : c)),
  );
}

export function useCreateSupplierContact() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: (input: SupplierContactInput) =>
      createSupplierContact({ ...input, watchers: autoWatchers(input.watchers, actor) }),
    onSuccess: (created) => {
      qc.setQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      pushToast({ message: `Added ${supplierContactLabel(created)}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't add the contact: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_CONTACTS_KEY }),
  });
}

export function useUpdateSupplierContactFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      changed,
    }: {
      id: number;
      changed: Parameters<typeof updateSupplierContactFields>[1];
    }) => updateSupplierContactFields(id, changed),
    onSuccess: (updated) => patchContact(qc, updated.id, () => updated),
    onError: (err: Error) => errorToast(`Couldn't save that change: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_CONTACTS_KEY }),
  });
}

export function useSetSupplierContactWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setSupplierContactWatchers(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: SUPPLIER_CONTACTS_KEY });
      const previous = qc.getQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY);
      patchContact(qc, id, (c) => ({ ...c, watchers: people }));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SUPPLIER_CONTACTS_KEY, ctx.previous);
      errorToast("Couldn't update the watchers — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_CONTACTS_KEY }),
  });
}

export function useDeleteSupplierContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteSupplierContact(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY, (old) => old?.filter((c) => c.id !== id));
      pushToast({ message: "Contact removed." });
    },
    onError: (err: Error) => errorToast(`Couldn't remove the contact: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIER_CONTACTS_KEY }),
  });
}

export function useAddSupplierContactComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addSupplierContactComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: SUPPLIER_CONTACTS_KEY });
      const previous = qc.getQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY);
      patchContact(qc, id, (c) => ({
        ...c,
        comments: [
          { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
          ...c.comments,
        ],
        modifiedAt: new Date(),
      }));
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      const autoWatch = beginContactMentionAutoWatch(qc, id, comment.bodyHtml);
      return { previous, autoWatch };
    },
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });

      const contacts = qc.getQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY);
      const contact = contacts?.find((c) => c.id === id);
      if (!contact) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: contact.watchers,
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "supplierContact", id: contact.id, title: supplierContactLabel(contact) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(SUPPLIER_CONTACTS_KEY, ctx.previous);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => void qc.invalidateQueries({ queryKey: SUPPLIER_CONTACTS_KEY })),
  });
}

export function useEditSupplierContactComment() {
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
    }) => editSupplierContactComment(id, target, bodyHtml),
    // Only mentions the edit ADDED subscribe anyone — same rule as before,
    // now started the moment Save is pressed.
    onMutate: ({ id, bodyHtml, previousBodyHtml }) => ({
      autoWatch: beginContactMentionAutoWatch(qc, id, newlyMentionedHtml(previousBodyHtml, bodyHtml)),
    }),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });

      const contacts = qc.getQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY);
      const contact = contacts?.find((c) => c.id === id);
      if (!contact) return;

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
        target: { kind: "supplierContact", id: contact.id, title: supplierContactLabel(contact) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      errorToast("Couldn't update the comment — please retry.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => void qc.invalidateQueries({ queryKey: SUPPLIER_CONTACTS_KEY })),
  });
}

/**
 * Start auto-watch for a supplier contact comment: the mentioned people appear as
 * watchers immediately and are written once the comment lands.
 */
function beginContactMentionAutoWatch(
  qc: QueryClient,
  id: number,
  bodyHtml: string,
): MentionAutoWatch | null {
  const contact = qc.getQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY)?.find((c) => c.id === id);
  if (!contact) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: contact.watchers,
    directory: () => collectSupplierContactPeople(qc.getQueryData<SupplierContact[]>(SUPPLIER_CONTACTS_KEY) ?? []),
    resolveLookupId: resolvePmoSiteUserLookupId,
    patch: (watchers) => patchContact(qc, id, (c) => ({ ...c, watchers })),
    write: (watchers) => setSupplierContactWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: SUPPLIER_CONTACTS_KEY }),
    noun: "contact",
  });
}
