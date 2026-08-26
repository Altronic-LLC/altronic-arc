import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addSupplierComment,
  createSupplier,
  editSupplierComment,
  listSuppliers,
  setSupplierWatchers,
  updateSupplierAssignedBuyer,
  updateSupplierDetails,
  updateSupplierPointOfContact,
} from "@/api/suppliers";
import type { Person, Supplier, SupplierInput } from "@/types/task";
import { supplierLabel } from "@/lib/supplierMapper";
import { commentNotifyRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { notifyMentions } from "@/api/email";
import { autoWatchFromMentions } from "@/api/autoWatch";
// Suppliers live on the PMO site, so cold-start mentions resolve there.
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import { autoWatchers, mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Suppliers List hooks — the SRM tool's anchor list.
//
// The comment thread here is the standard one — commentNotifyRecipients,
// notifyMentions, autoWatchFromMentions — the same shape Gray Market Requests
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
      return { previous };
    },
    onSuccess: (_data, { id, comment }) => {
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

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: supplier.watchers,
        directory: suppliers ? collectSupplierPeople(suppliers) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, supplier.watchers, additions))
        .catch((err: unknown) => console.error("Auto-watch failed for a supplier comment:", err));
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SUPPLIERS_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
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
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }) => {
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
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: added,
        currentWatchers: supplier.watchers,
        directory: suppliers ? collectSupplierPeople(suppliers) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, supplier.watchers, additions))
        .catch((err: unknown) => console.error("Auto-watch failed for a supplier comment edit:", err));
    },
    onError: () => errorToast("Couldn't update the comment — please retry."),
    onSettled: () => qc.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
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
  const patch = () => patchSupplier(qc, id, (s) => ({ ...s, watchers: next }));
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this supplier.`
        : `${additions.length} people are now watching this supplier.`,
  });
  try {
    await setSupplierWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    qc.invalidateQueries({ queryKey: SUPPLIERS_KEY });
  }
}
