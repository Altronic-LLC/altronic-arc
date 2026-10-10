import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addQuoteItemComment,
  createQuoteItem,
  deleteQuoteItem,
  editQuoteItemComment,
  listQuoteItems,
  setQuoteItemWatchers,
  updateQuoteItemFields,
} from "@/api/quoteItems";
import type { QuoteCommentInput } from "@/api/quotes";
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import { notifyMentions, type MentionTarget } from "@/api/email";
import type { Person } from "@/types/task";
import type { Quote, QuoteItem } from "@/types/quote";
import { listQuoteAssemblies } from "@/api/quoteAssemblies";
import { applyQuoteItemPatch, type QuoteItemInput, type QuoteItemPatch } from "@/lib/quoteMapper";
import { accessQuotesGate, editQuoteGate } from "@/lib/quoteRoles";
import { autoWatchers } from "@/lib/people";
import { commentNotifyRecipients, newlyMentionedHtml } from "@/lib/mentions";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { htmlToPlainText } from "@/lib/htmlText";
import { pushToast } from "@/components/Toast";
import {
  afterMentionAutoWatch,
  beginMentionAutoWatch,
  type MentionAutoWatch,
} from "./mentionAutoWatch";
import { useCurrentUser } from "./useCurrentUser";
import {
  QUOTES_KEY,
  QUOTE_ASSEMBLIES_KEY,
  QUOTE_ITEMS_KEY,
  QUOTE_SITE_LABEL,
  collectQuotePeople,
  newlyMentionedRecipients,
  type EditCommentVars,
} from "./useQuotes";
import { syncAssemblyCustomerPrice } from "./useQuoteAssemblies";
import { requireQuoteGate, useResolveQuoteAccess } from "./useQuoteRoles";

export { QUOTE_ITEMS_KEY };

// =============================================================================
// Quote Items — the components under each final assembly. Cost, overhead and
// quantity live here; the margin does NOT — it is set once, on the assembly.
// Each component has its own INTERNAL comment thread.
//
// One cached query holds every component; `useQuoteItems(quoteId)` scopes it
// with a `select`. Creating, editing and deleting ask `editQuoteGate` inside
// the mutationFn; commenting and watching are open to every role, viewer
// included (`accessQuotesGate`).
//
// After any write lands, the parent assembly's stored CustomerPrice is
// re-synced (useQuoteAssemblies.ts `syncAssemblyCustomerPrice`). A failed sync
// toasts a warning and never fails the component write itself.
//
// A component's email links to its QUOTE — there is no per-component page.
// =============================================================================

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

/** Every component on one quote, in line order. */
export function useQuoteItems(quoteId: number | null) {
  const select = useCallback(
    (rows: QuoteItem[]) => (quoteId === null ? [] : rows.filter((i) => i.quoteId === quoteId)),
    [quoteId],
  );
  return useQuery({
    queryKey: QUOTE_ITEMS_KEY,
    queryFn: listQuoteItems,
    staleTime: 60_000,
    select,
  });
}

function patchItem(qc: QueryClient, id: number, update: (i: QuoteItem) => QuoteItem) {
  qc.setQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY, (old) => old?.map((i) => (i.id === id ? update(i) : i)));
}

function upsertItem(qc: QueryClient, row: QuoteItem) {
  qc.setQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY, (old) => {
    if (!old) return [row];
    return old.some((i) => i.id === row.id) ? old.map((i) => (i.id === row.id ? row : i)) : [...old, row];
  });
}

async function syncAll(qc: QueryClient, assemblyIds: Array<number | null | undefined>) {
  const ids = [...new Set(assemblyIds.filter((id): id is number => typeof id === "number"))];
  for (const id of ids) await syncAssemblyCustomerPrice(qc, id);
}

// -----------------------------------------------------------------------------
// Create / edit / delete
// -----------------------------------------------------------------------------

export function useCreateQuoteItem() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  const actor = useCurrentUser();
  const actorRef = useRef(actor);
  actorRef.current = actor;
  return useMutation({
    mutationFn: async (input: QuoteItemInput) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      const lines = await qc.ensureQueryData({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: listQuoteAssemblies });
      if (lines.find((a) => a.id === input.assemblyId)?.lineType === "Part") {
        throw new Error("A Part line has no components — its cost is entered on the line itself.");
      }
      // Whoever adds a component watches its thread.
      return createQuoteItem({ ...input, watchers: autoWatchers(input.watchers, actorRef.current) });
    },
    onSuccess: async (created) => {
      upsertItem(qc, created);
      await syncAll(qc, [created.assemblyId]);
    },
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, {
          action: "add the component",
          site: QUOTE_SITE_LABEL,
          permission: "creating items",
        }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY }),
  });
}

const pendingBefore = new WeakMap<object, QuoteItem>();

/** Edit a component, optimistically, DIFFED against the row the edit started from. */
export function useUpdateQuoteItem() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (vars: { id: number; patch: QuoteItemPatch }) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      let before = pendingBefore.get(vars);
      if (!before) before = (await listQuoteItems()).find((i) => i.id === vars.id);
      if (!before) throw new Error(`Quote component ${vars.id} not found`);
      return updateQuoteItemFields(vars.id, vars.patch, before);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUOTE_ITEMS_KEY });
      const previous = qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY);
      const before = previous?.find((i) => i.id === vars.id);
      if (before) pendingBefore.set(vars, before);
      patchItem(qc, vars.id, (i) => applyQuoteItemPatch(i, vars.patch));
      return { previous, before };
    },
    onSuccess: async (updated, _vars, ctx) => {
      upsertItem(qc, updated);
      // A component moved between assemblies changes BOTH prices.
      await syncAll(qc, [updated.assemblyId, ctx?.before?.assemblyId]);
    },
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUOTE_ITEMS_KEY, ctx.previous);
      errorToast(
        describeListWriteFailure(err, {
          action: "save the component",
          site: QUOTE_SITE_LABEL,
          permission: "editing",
        }),
      );
    },
    onSettled: (_d, _e, vars) => {
      pendingBefore.delete(vars);
      void qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY });
    },
  });
}

export function useDeleteQuoteItem() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      await deleteQuoteItem(id);
      return id;
    },
    onSuccess: async (id) => {
      const gone = qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY)?.find((i) => i.id === id);
      qc.setQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY, (old) => old?.filter((i) => i.id !== id));
      await syncAll(qc, [gone?.assemblyId]);
    },
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, {
          action: "delete the component",
          site: QUOTE_SITE_LABEL,
          permission: "deleting",
        }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY }),
  });
}

// -----------------------------------------------------------------------------
// Watchers + comments — open to every role.
// -----------------------------------------------------------------------------

export function useSetQuoteItemWatchers() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ id, people }: { id: number; people: Person[] }) => {
      requireQuoteGate(accessQuotesGate(await resolve()));
      return setQuoteItemWatchers(id, people);
    },
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: QUOTE_ITEMS_KEY });
      const previous = qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY);
      patchItem(qc, id, (i) => ({ ...i, watchers: people }));
      return { previous };
    },
    onSuccess: (updated) => patchItem(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUOTE_ITEMS_KEY, ctx.previous);
      errorToast(
        describeListWriteFailure(err, {
          action: "update the watchers",
          site: QUOTE_SITE_LABEL,
          permission: "editing",
        }),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY }),
  });
}

/** The email target for a component: its QUOTE's page, named for the component. */
function itemTarget(qc: QueryClient, item: QuoteItem): MentionTarget | null {
  if (item.quoteId === null) return null;
  const quote = qc.getQueryData<Quote[]>(QUOTES_KEY)?.find((q) => q.id === item.quoteId);
  const part = item.altronicPartNumber || `line ${item.lineNo}`;
  return {
    kind: "quote",
    id: item.quoteId,
    title: quote ? `${quote.quoteNumber} — component ${part}` : `component ${part}`,
  };
}

/** Return the promise from the composer's onSubmit, so a failed comment is restored. */
export function useAddQuoteItemComment() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment: QuoteCommentInput }) => {
      requireQuoteGate(accessQuotesGate(await resolve()));
      return addQuoteItemComment(id, comment);
    },
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: QUOTE_ITEMS_KEY });
      const previous = qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY);
      patchItem(qc, id, (i) => ({
        ...i,
        comments: [{ ...comment, timestamp: new Date(), attachments: [] }, ...i.comments],
      }));
      return { previous, autoWatch: beginItemMentionAutoWatch(qc, id, comment.bodyHtml) };
    },
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });
      const item = qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY)?.find((i) => i.id === id);
      if (!item) return;
      const target = itemTarget(qc, item);
      if (!target) return;
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: item.watchers,
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length === 0) return;
      void notifyMentions({
        recipients,
        sender: { displayName: comment.authorName, email: comment.authorEmail },
        target,
        commentExcerpt: htmlToPlainText(comment.bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(QUOTE_ITEMS_KEY, ctx.previous);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY });
      }),
  });
}

export function useEditQuoteItemComment() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ id, target, bodyHtml }: EditCommentVars) => {
      requireQuoteGate(accessQuotesGate(await resolve()));
      return editQuoteItemComment(id, target, bodyHtml);
    },
    onMutate: async ({ id, bodyHtml, previousBodyHtml }) => {
      const newMentions = newlyMentionedHtml(previousBodyHtml, bodyHtml);
      if (newMentions) await qc.cancelQueries({ queryKey: QUOTE_ITEMS_KEY });
      return { autoWatch: beginItemMentionAutoWatch(qc, id, newMentions) };
    },
    onSuccess: (updated, { target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });
      const added = newlyMentionedRecipients(previousBodyHtml, bodyHtml);
      const mailTarget = itemTarget(qc, updated);
      if (added.length === 0 || !mailTarget) return;
      void notifyMentions({
        recipients: added,
        sender: { displayName: "", email: target.authorEmail },
        target: mailTarget,
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
        void qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY });
      }),
  });
}

function beginItemMentionAutoWatch(qc: QueryClient, id: number, bodyHtml: string): MentionAutoWatch | null {
  const item = qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY)?.find((i) => i.id === id);
  if (!item || !bodyHtml) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: item.watchers,
    directory: () =>
      collectQuotePeople(
        qc.getQueryData<Quote[]>(QUOTES_KEY) ?? [],
        qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY) ?? [],
      ),
    resolveLookupId: resolvePmoSiteUserLookupId,
    patch: (watchers) => patchItem(qc, id, (i) => ({ ...i, watchers })),
    write: (watchers) => setQuoteItemWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY }),
    noun: "component",
  });
}
