import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addSupplierComment,
  clearSupplierLogo,
  createSupplier,
  editSupplierComment,
  listSuppliers,
  setSupplierWatchers,
  updateSupplierAssignedBuyer,
  updateSupplierDetails,
  updateSupplierLogo,
  updateSupplierPointOfContact,
} from "@/api/suppliers";
import type { Person, Supplier, SupplierInput } from "@/types/task";
import { supplierLabel } from "@/lib/supplierMapper";
import {
  commentNotifyRecipients,
  extractMentionedRecipients,
  newlyMentionedHtml,
} from "@/lib/mentions";
import { notifyMentions } from "@/api/email";
// Suppliers live on the PMO site, so cold-start mentions resolve there.
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import {
  afterMentionAutoWatch,
  beginMentionAutoWatch,
  type MentionAutoWatch,
} from "./mentionAutoWatch";
import { autoWatchers, mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { attachmentsKey } from "./useAttachments";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Suppliers List hooks — the SRM tool's anchor list.
//
// The comment thread here is the standard one — commentNotifyRecipients,
// notifyMentions, mention auto-watch (hooks/mentionAutoWatch.ts) — the same shape Gray Market Requests
// uses, since both live on the PMO site and both have a real Watchers column.
// =============================================================================

export const SUPPLIERS_KEY = ["suppliers"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useSuppliers() {
  return useQuery({
    queryKey: SUPPLIERS_KEY,
    queryFn: listSuppliers,
    staleTime: 60_000,
  });
}

/** One supplier out of the cached list. */
export function useSupplier(id: number | null) {
  const { data: suppliers = [], ...rest } = useSuppliers();
  return {
    ...rest,
    data: id === null ? undefined : suppliers.find((s) => s.id === id),
  };
}

/** Everyone already on a supplier — the @-mention picker's starting point. */
export function collectSupplierPeople(suppliers: Supplier[]): Person[] {
  return mergePeople(
    suppliers.flatMap((s) => [...(s.assignedBuyer ? [s.assignedBuyer] : []), ...s.watchers]),
  );
}

function patchSupplier(qc: QueryClient, id: number, update: (s: Supplier) => Supplier) {
  qc.setQueryData<Supplier[]>(SUPPLIERS_KEY, (old) => old?.map((s) => (s.id === id ? update(s) : s)));
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: (input: SupplierInput) =>
      // Whoever adds the supplier watches it, and so does the assigned buyer
      // they named, if that's someone else. See autoWatchers in lib/people.ts.
      createSupplier({ ...input, watchers: autoWatchers(input.watchers, input.assignedBuyer, actor) }),
    onSuccess: (created) => {
      qc.setQueryData<Supplier[]>(SUPPLIERS_KEY, (old) => (old ? [created, ...old] : [created]));
      qc.invalidateQueries({ queryKey: SUPPLIERS_KEY });
      pushToast({ message: `Added ${supplierLabel(created)}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't add the supplier: ${err.message}`),
  });
}

export function useUpdateSupplierDetails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      current,
      changed,
    }: {
      current: Supplier;
      changed: Parameters<typeof updateSupplierDetails>[1];
    }) => updateSupplierDetails(current, changed),
    onSuccess: (updated) => patchSupplier(qc, updated.id, () => updated),
    onError: (err: Error) => errorToast(`Couldn't save that change. ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
  });
}

export function useUpdateSupplierAssignedBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      updateSupplierAssignedBuyer(id, person),
    onSuccess: (updated) => patchSupplier(qc, updated.id, () => updated),
    onError: (err: Error) => errorToast(`Couldn't save that change. ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
  });
}

export function useUpdateSupplierPointOfContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, contactId }: { id: number; contactId: number | null }) =>
      updateSupplierPointOfContact(id, contactId),
    onSuccess: (updated) => patchSupplier(qc, updated.id, () => updated),
    onError: (err: Error) => errorToast(`Couldn't save that change. ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
  });
}

/** Upload/replace a supplier's logo. See `updateSupplierLogo` for why this touches an attachment as well as the Logo field. */
export function useUpdateSupplierLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ current, file }: { current: Supplier; file: File }) => updateSupplierLogo(current, file),
    onSuccess: (updated) => {
      patchSupplier(qc, updated.id, () => updated);
      pushToast({ message: "Logo updated." });
    },
    onError: (err: Error) => errorToast(`Couldn't update the logo. ${err.message}`),
    onSettled: (updated, _err, { current }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
        // The new/old logo file lives in the SAME attachment store the
        // Attachments card reads — invalidate it too, or the two cards
        // disagree about what's on the item until something else refetches.
        qc.invalidateQueries({ queryKey: attachmentsKey("supplier", (updated ?? current).id) }),
      ]),
  });
}

/** Remove a supplier's logo. */
export function useClearSupplierLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (current: Supplier) => clearSupplierLogo(current),
    onSuccess: (updated) => {
      patchSupplier(qc, updated.id, () => updated);
      pushToast({ message: "Logo removed." });
    },
    onError: (err: Error) => errorToast(`Couldn't remove the logo. ${err.message}`),
    onSettled: (updated, _err, current) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
        qc.invalidateQueries({ queryKey: attachmentsKey("supplier", (updated ?? current).id) }),
      ]),
  });
}

export function useSetSupplierWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setSupplierWatchers(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: SUPPLIERS_KEY });
      const previous = qc.getQueryData<Supplier[]>(SUPPLIERS_KEY);
      patchSupplier(qc, id, (s) => ({ ...s, watchers: people }));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SUPPLIERS_KEY, ctx.previous);
      errorToast("Couldn't update the watchers — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
  });
}

export function useAddSupplierComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addSupplierComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: SUPPLIERS_KEY });
      const previous = qc.getQueryData<Supplier[]>(SUPPLIERS_KEY);
      patchSupplier(qc, id, (s) => ({
        ...s,
        comments: [
          { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
          ...s.comments,
        ],
        modifiedAt: new Date(),
      }));
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      const autoWatch = beginSupplierMentionAutoWatch(qc, id, comment.bodyHtml);
      return { previous, autoWatch };
    },
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });

      const suppliers = qc.getQueryData<Supplier[]>(SUPPLIERS_KEY);
      const supplier = suppliers?.find((s) => s.id === id);
      if (!supplier) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: supplier.watchers,
        assignees: supplier.assignedBuyer ? [supplier.assignedBuyer] : [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "supplier", id: supplier.id, title: supplierLabel(supplier) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(SUPPLIERS_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => void qc.invalidateQueries({ queryKey: SUPPLIERS_KEY })),
  });
}

export function useEditSupplierComment() {
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
    }) => editSupplierComment(id, target, bodyHtml),
    // Only mentions the edit ADDED subscribe anyone — same rule as before,
    // now started the moment Save is pressed.
    onMutate: ({ id, bodyHtml, previousBodyHtml }) => ({
      autoWatch: beginSupplierMentionAutoWatch(
        qc,
        id,
        newlyMentionedHtml(previousBodyHtml, bodyHtml),
      ),
    }),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });

      const suppliers = qc.getQueryData<Supplier[]>(SUPPLIERS_KEY);
      const supplier = suppliers?.find((s) => s.id === id);
      if (!supplier) return;

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
        target: { kind: "supplier", id: supplier.id, title: supplierLabel(supplier) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      errorToast("Couldn't update the comment — please retry.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => void qc.invalidateQueries({ queryKey: SUPPLIERS_KEY })),
  });
}

/**
 * Start auto-watch for a supplier comment: the mentioned people appear as
 * watchers immediately and are written once the comment lands.
 */
function beginSupplierMentionAutoWatch(
  qc: QueryClient,
  id: number,
  bodyHtml: string,
): MentionAutoWatch | null {
  const supplier = qc.getQueryData<Supplier[]>(SUPPLIERS_KEY)?.find((s) => s.id === id);
  if (!supplier) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: supplier.watchers,
    directory: () => collectSupplierPeople(qc.getQueryData<Supplier[]>(SUPPLIERS_KEY) ?? []),
    resolveLookupId: resolvePmoSiteUserLookupId,
    patch: (watchers) => patchSupplier(qc, id, (s) => ({ ...s, watchers })),
    write: (watchers) => setSupplierWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
    noun: "supplier",
  });
}

