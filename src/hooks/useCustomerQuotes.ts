import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addCustomerQuoteComment,
  createCustomerQuote,
  createCustomerQuoteRevision,
  editCustomerQuoteComment,
  listCustomerQuotes,
  setCustomerQuoteWatchers,
  updateCustomerQuote,
  type CustomerQuoteRow,
  type QuoteCommentInput,
} from "@/api/customerQuotes";
import { resolveSalesTeamSiteUserLookupId } from "@/api/pricingRequests";
import { notifyMentions } from "@/api/email";
import type { Person } from "@/types/task";
import type { CustomerQuote } from "@/types/pricing";
import { applyCustomerQuotePatch, type CustomerQuotePatch } from "@/lib/pricingMapper";
import { priceGate } from "@/lib/pricingRoles";
import { autoWatchers, mergePeople } from "@/lib/people";
import { commentNotifyRecipients, newlyMentionedHtml } from "@/lib/mentions";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { htmlToPlainText } from "@/lib/htmlText";
import { pushToast } from "@/components/Toast";
import { afterMentionAutoWatch, beginMentionAutoWatch, type MentionAutoWatch } from "./mentionAutoWatch";
import { useCurrentUser } from "./useCurrentUser";
import { newlyMentionedRecipients } from "./useQuotes";
import { requirePricingGate, useResolvePricingAccess } from "./usePricingRoles";
import { PRICING_SITE_LABEL } from "./usePricingRequests";

// =============================================================================
// Customer Quotes — the hooks. Managers and admins only, so EVERY write
// (comments and watchers included) asks `priceGate` inside its mutationFn.
// Comments follow the house rules: watchers + @-mentions are emailed, and a
// mention becomes a watcher when Post is pressed, resolved on the Sales site.
// =============================================================================

export const CUSTOMER_QUOTES_KEY = ["customer-quotes", "list"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useCustomerQuotes(enabled = true) {
  return useQuery<CustomerQuote[]>({
    queryKey: CUSTOMER_QUOTES_KEY,
    queryFn: listCustomerQuotes,
    staleTime: 60_000,
    enabled,
  });
}

export function useCustomerQuote(id: number | null) {
  const { data: quotes = [], ...rest } = useCustomerQuotes();
  return { ...rest, data: id === null ? undefined : quotes.find((q) => q.id === id) };
}

export function collectCustomerQuotePeople(quotes: CustomerQuote[]): Person[] {
  return mergePeople(...quotes.map((q) => [...q.watchers, ...(q.createdBy ? [q.createdBy] : [])]));
}

function patchQuote(qc: QueryClient, id: number, update: (q: CustomerQuote) => CustomerQuote) {
  qc.setQueryData<CustomerQuote[]>(CUSTOMER_QUOTES_KEY, (old) => old?.map((q) => (q.id === id ? update(q) : q)));
}

function upsert(qc: QueryClient, row: CustomerQuote) {
  qc.setQueryData<CustomerQuote[]>(CUSTOMER_QUOTES_KEY, (old) => {
    if (!old) return [row];
    return old.some((q) => q.id === row.id) ? old.map((q) => (q.id === row.id ? row : q)) : [row, ...old];
  });
}

function useActorRef() {
  const actor = useCurrentUser();
  const ref = useRef(actor);
  ref.current = actor;
  return ref;
}

export function useCreateCustomerQuote() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async (input: Omit<CustomerQuoteRow, "watchers">) => {
      requirePricingGate(priceGate(await resolve()));
      return createCustomerQuote({ ...input, watchers: autoWatchers([], actorRef.current) });
    },
    onSuccess: (created) => {
      upsert(qc, created);
      void qc.invalidateQueries({ queryKey: CUSTOMER_QUOTES_KEY });
      pushToast({ message: `Created ${created.quoteNumber}.` });
    },
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "create the quote", site: PRICING_SITE_LABEL, permission: "creating items" })),
  });
}

export function useUpdateCustomerQuote() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: CustomerQuotePatch }) => {
      requirePricingGate(priceGate(await resolve()));
      return updateCustomerQuote(id, patch);
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: CUSTOMER_QUOTES_KEY });
      const previous = qc.getQueryData<CustomerQuote[]>(CUSTOMER_QUOTES_KEY);
      patchQuote(qc, id, (q) => applyCustomerQuotePatch(q, patch));
      return { previous };
    },
    onSuccess: (saved) => upsert(qc, saved),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(CUSTOMER_QUOTES_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action: "save the quote", site: PRICING_SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_QUOTES_KEY }),
  });
}

export function useCreateCustomerQuoteRevision() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async (quote: CustomerQuote) => {
      requirePricingGate(priceGate(await resolve()));
      return createCustomerQuoteRevision(quote.id, autoWatchers(quote.watchers, actorRef.current));
    },
    onSuccess: (created) => {
      upsert(qc, created);
      void qc.invalidateQueries({ queryKey: CUSTOMER_QUOTES_KEY });
      pushToast({ message: `Created ${created.quoteNumber}.` });
    },
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "create the new revision", site: PRICING_SITE_LABEL, permission: "creating items" })),
  });
}

export function useSetCustomerQuoteWatchers() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, people }: { id: number; people: Person[] }) => {
      requirePricingGate(priceGate(await resolve()));
      return setCustomerQuoteWatchers(id, people);
    },
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: CUSTOMER_QUOTES_KEY });
      const previous = qc.getQueryData<CustomerQuote[]>(CUSTOMER_QUOTES_KEY);
      patchQuote(qc, id, (q) => ({ ...q, watchers: people }));
      return { previous };
    },
    onSuccess: (saved) => upsert(qc, saved),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(CUSTOMER_QUOTES_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action: "update the watchers", site: PRICING_SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_QUOTES_KEY }),
  });
}

function beginQuoteMentionAutoWatch(qc: QueryClient, id: number, bodyHtml: string): MentionAutoWatch | null {
  const quote = qc.getQueryData<CustomerQuote[]>(CUSTOMER_QUOTES_KEY)?.find((q) => q.id === id);
  if (!quote || !bodyHtml) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: quote.watchers,
    directory: () => collectCustomerQuotePeople(qc.getQueryData<CustomerQuote[]>(CUSTOMER_QUOTES_KEY) ?? []),
    resolveLookupId: resolveSalesTeamSiteUserLookupId,
    patch: (watchers) => patchQuote(qc, id, (q) => ({ ...q, watchers })),
    write: (watchers) => setCustomerQuoteWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: CUSTOMER_QUOTES_KEY }),
    noun: "quote",
  });
}

export function useAddCustomerQuoteComment() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment: QuoteCommentInput }) => {
      requirePricingGate(priceGate(await resolve()));
      return addCustomerQuoteComment(id, comment);
    },
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: CUSTOMER_QUOTES_KEY });
      const previous = qc.getQueryData<CustomerQuote[]>(CUSTOMER_QUOTES_KEY);
      patchQuote(qc, id, (q) => ({ ...q, comments: [{ ...comment, timestamp: new Date(), attachments: [] }, ...q.comments] }));
      return { previous, autoWatch: beginQuoteMentionAutoWatch(qc, id, comment.bodyHtml) };
    },
    onSuccess: (_d, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });
      const quote = qc.getQueryData<CustomerQuote[]>(CUSTOMER_QUOTES_KEY)?.find((q) => q.id === id);
      if (!quote) return;
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: quote.watchers,
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length === 0) return;
      void notifyMentions({
        recipients,
        sender: { displayName: comment.authorName, email: comment.authorEmail },
        target: { kind: "customerQuote", id: quote.id, title: quote.quoteNumber },
        commentExcerpt: htmlToPlainText(comment.bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(CUSTOMER_QUOTES_KEY, ctx.previous);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: CUSTOMER_QUOTES_KEY });
      }),
  });
}

export function useEditCustomerQuoteComment() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async (vars: { id: number; target: { timestamp: Date; authorEmail: string }; bodyHtml: string; previousBodyHtml: string }) => {
      requirePricingGate(priceGate(await resolve()));
      return editCustomerQuoteComment(vars.id, vars.target, vars.bodyHtml);
    },
    onMutate: async ({ id, bodyHtml, previousBodyHtml }) => {
      const newMentions = newlyMentionedHtml(previousBodyHtml, bodyHtml);
      if (newMentions) await qc.cancelQueries({ queryKey: CUSTOMER_QUOTES_KEY });
      return { autoWatch: beginQuoteMentionAutoWatch(qc, id, newMentions) };
    },
    onSuccess: (saved, { target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });
      const added = newlyMentionedRecipients(previousBodyHtml, bodyHtml);
      if (added.length === 0) return;
      void notifyMentions({
        recipients: added,
        sender: { displayName: "", email: target.authorEmail },
        target: { kind: "customerQuote", id: saved.id, title: saved.quoteNumber },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      errorToast("Couldn't update the comment — please retry.");
    },
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: CUSTOMER_QUOTES_KEY });
      }),
  });
}
