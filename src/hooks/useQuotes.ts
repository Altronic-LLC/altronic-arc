import { useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addQuoteComment,
  createQuote,
  editQuoteComment,
  getQuote,
  listQuotes,
  setQuoteLinks,
  setQuoteWatchers,
  updateQuoteFields,
  type QuoteCommentInput,
  type QuoteCreateInput,
} from "@/api/quotes";
import { createQuoteRevision } from "@/api/quoteRevisions";
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import { notifyMentions } from "@/api/email";
import type { Person } from "@/types/task";
import type { Quote, QuoteItem, QuoteLink } from "@/types/quote";
import { applyQuotePatch, type QuotePatch } from "@/lib/quoteMapper";
import { revisionsOf } from "@/lib/quoteNumber";
import {
  accessQuotesGate,
  createQuoteGate,
  editQuoteGate,
  setQuoteStatusGate,
} from "@/lib/quoteRoles";
import { autoWatchers, mergePeople } from "@/lib/people";
import { commentNotifyRecipients, extractMentionedRecipients, newlyMentionedHtml } from "@/lib/mentions";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { htmlToPlainText } from "@/lib/htmlText";
import { pushToast } from "@/components/Toast";
import {
  afterMentionAutoWatch,
  beginMentionAutoWatch,
  type MentionAutoWatch,
} from "./mentionAutoWatch";
import { useCurrentUser } from "./useCurrentUser";
import { requireQuoteGate, useResolveQuoteAccess } from "./useQuoteRoles";

// =============================================================================
// Quotes — the header hooks (one row per quote REVISION).
//
// Every write asks its gate INSIDE the mutationFn, against access resolved by
// awaiting the roles list (useResolveQuoteAccess) — never a render-time flag.
// Commenting and watching are open to every role, viewer included
// (`accessQuotesGate`); editing needs `editQuoteGate`, and a STATUS change
// also needs `setQuoteStatusGate` (only a manager sets or leaves an outcome).
//
// The comment thread follows the full house rules: watchers + @-mentions are
// emailed (`commentNotifyRecipients`), and a mention becomes a watcher the
// moment Post is pressed (hooks/mentionAutoWatch.ts), resolved against the
// PMO site — a lookupId is valid on one site collection only.
// =============================================================================

export const QUOTES_KEY = ["quotes", "list"] as const;
/** Where an assembly / item hook's caches live — invalidated by a new rev. */
export const QUOTE_ASSEMBLIES_KEY = ["quote-assemblies", "list"] as const;
export const QUOTE_ITEMS_KEY = ["quote-items", "list"] as const;

/** For the "ask an admin about X" sentence on a refused write. */
export const QUOTE_SITE_LABEL = "Altronic_PMO";

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useQuotes() {
  return useQuery<Quote[]>({
    queryKey: QUOTES_KEY,
    queryFn: listQuotes,
    staleTime: 60_000,
  });
}

/** One quote revision, derived from the list cache (like useTask). */
export function useQuote(id: number | null) {
  const { data: quotes = [], ...rest } = useQuotes();
  return {
    ...rest,
    data: id === null ? undefined : quotes.find((q) => q.id === id),
  };
}

/** Every rev of a base, newest (highest rev) first. */
export function useQuoteRevisions(quoteBase: string | null | undefined) {
  const { data: quotes = [], ...rest } = useQuotes();
  const data = useMemo(() => (quoteBase ? revisionsOf(quoteBase, quotes) : []), [quoteBase, quotes]);
  return { ...rest, data };
}

/** Everyone already on a quote or a component — the @-mention picker's starting point. */
export function collectQuotePeople(quotes: Quote[], items: QuoteItem[] = []): Person[] {
  return mergePeople(
    ...quotes.map((q) => [...q.watchers, ...(q.createdBy ? [q.createdBy] : [])]),
    ...items.map((i) => i.watchers),
  );
}

export function patchQuote(qc: QueryClient, id: number, update: (q: Quote) => Quote) {
  qc.setQueryData<Quote[]>(QUOTES_KEY, (old) => old?.map((q) => (q.id === id ? update(q) : q)));
}

function upsertQuote(qc: QueryClient, row: Quote) {
  qc.setQueryData<Quote[]>(QUOTES_KEY, (old) => {
    if (!old) return [row];
    return old.some((q) => q.id === row.id) ? old.map((q) => (q.id === row.id ? row : q)) : [row, ...old];
  });
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export type QuoteCreateHookInput = Omit<QuoteCreateInput, "watchers"> & { watchers?: Person[] };

export function useCreateQuote() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  const actor = useCurrentUser();
  const actorRef = useRef(actor);
  actorRef.current = actor;
  return useMutation({
    mutationFn: async (input: QuoteCreateHookInput) => {
      requireQuoteGate(createQuoteGate(await resolve()));
      // Whoever raises a quote watches it — autoWatchers() in lib/people.ts.
      return createQuote({ ...input, watchers: autoWatchers(input.watchers, actorRef.current) });
    },
    onSuccess: (created) => {
      // Seed BEFORE invalidating: the form navigates to the new quote the
      // moment this resolves, and useQuote() derives from this cache.
      upsertQuote(qc, created);
      void qc.invalidateQueries({ queryKey: QUOTES_KEY });
      pushToast({ message: `Created ${created.quoteNumber}.` });
    },
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, {
          action: "create the quote",
          site: QUOTE_SITE_LABEL,
          permission: "creating items",
        }),
      ),
  });
}

// -----------------------------------------------------------------------------
// Field edits
// -----------------------------------------------------------------------------

/** The row BEFORE the optimistic patch, keyed on the variables object (the useScns arrangement). */
const pendingBefore = new WeakMap<object, Quote>();

export function useUpdateQuoteFields() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (vars: { id: number; patch: QuotePatch }) => {
      const access = await resolve();
      requireQuoteGate(editQuoteGate(access));
      const before = pendingBefore.get(vars) ?? (await getQuote(vars.id));
      if (!before) throw new Error(`Quote ${vars.id} not found`);
      const to = vars.patch.status;
      if (to !== undefined && to !== before.status) {
        requireQuoteGate(setQuoteStatusGate(access, before.status, to));
      }
      return updateQuoteFields(vars.id, vars.patch, before);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUOTES_KEY });
      const previous = qc.getQueryData<Quote[]>(QUOTES_KEY);
      const before = previous?.find((q) => q.id === vars.id);
      if (before) pendingBefore.set(vars, before);
      patchQuote(qc, vars.id, (q) => applyQuotePatch(q, vars.patch));
      return { previous };
    },
    onSuccess: (updated) => patchQuote(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUOTES_KEY, ctx.previous);
      errorToast(
        describeListWriteFailure(err, { action: "save that change", site: QUOTE_SITE_LABEL, permission: "editing" }),
      );
    },
    onSettled: (_data, _err, vars) => {
      pendingBefore.delete(vars);
      void qc.invalidateQueries({ queryKey: QUOTES_KEY });
    },
  });
}

// -----------------------------------------------------------------------------
// Watchers — open to every role (watching is collaborating, not editing).
// -----------------------------------------------------------------------------

export function useSetQuoteWatchers() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ id, people }: { id: number; people: Person[] }) => {
      requireQuoteGate(accessQuotesGate(await resolve()));
      return setQuoteWatchers(id, people);
    },
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: QUOTES_KEY });
      const previous = qc.getQueryData<Quote[]>(QUOTES_KEY);
      patchQuote(qc, id, (q) => ({ ...q, watchers: people }));
      return { previous };
    },
    onSuccess: (updated) => patchQuote(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUOTES_KEY, ctx.previous);
      errorToast(
        describeListWriteFailure(err, {
          action: "update the watchers",
          site: QUOTE_SITE_LABEL,
          permission: "editing",
        }),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTES_KEY }),
  });
}

// -----------------------------------------------------------------------------
// Comments — open to every role. Call `mutateAsync` and RETURN its promise
// from the composer's onSubmit, so a failed comment is restored to the box.
// -----------------------------------------------------------------------------

export function useAddQuoteComment() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment: QuoteCommentInput }) => {
      requireQuoteGate(accessQuotesGate(await resolve()));
      return addQuoteComment(id, comment);
    },
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: QUOTES_KEY });
      const previous = qc.getQueryData<Quote[]>(QUOTES_KEY);
      patchQuote(qc, id, (q) => ({
        ...q,
        comments: [{ ...comment, timestamp: new Date(), attachments: [] }, ...q.comments],
      }));
      return { previous, autoWatch: beginQuoteMentionAutoWatch(qc, id, comment.bodyHtml) };
    },
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });
      const quote = qc.getQueryData<Quote[]>(QUOTES_KEY)?.find((q) => q.id === id);
      if (!quote) return;
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: quote.watchers,
        // No assignee column: a quote is worked by its watchers.
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length === 0) return;
      void notifyMentions({
        recipients,
        sender: { displayName: comment.authorName, email: comment.authorEmail },
        target: { kind: "quote", id: quote.id, title: quote.quoteNumber },
        commentExcerpt: htmlToPlainText(comment.bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(QUOTES_KEY, ctx.previous);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: QUOTES_KEY });
      }),
  });
}

export interface EditCommentVars {
  id: number;
  target: { timestamp: Date; authorEmail: string };
  bodyHtml: string;
  /** Mentions already in the comment before the edit — not re-notified. */
  previousBodyHtml: string;
}

/** Only the NEWLY mentioned in an edit — editing must not re-ping everyone already in it. */
export function newlyMentionedRecipients(previousBodyHtml: string, bodyHtml: string) {
  const before = new Set(extractMentionedRecipients(previousBodyHtml).map((r) => r.email.toLowerCase()));
  return extractMentionedRecipients(bodyHtml)
    .filter((r) => !before.has(r.email.toLowerCase()))
    .map((r) => ({ displayName: r.displayName, email: r.email, reason: "mentioned" as const }));
}

export function useEditQuoteComment() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ id, target, bodyHtml }: EditCommentVars) => {
      requireQuoteGate(accessQuotesGate(await resolve()));
      return editQuoteComment(id, target, bodyHtml);
    },
    onMutate: async ({ id, bodyHtml, previousBodyHtml }) => {
      const newMentions = newlyMentionedHtml(previousBodyHtml, bodyHtml);
      if (newMentions) await qc.cancelQueries({ queryKey: QUOTES_KEY });
      return { autoWatch: beginQuoteMentionAutoWatch(qc, id, newMentions) };
    },
    onSuccess: (updated, { target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });
      const added = newlyMentionedRecipients(previousBodyHtml, bodyHtml);
      if (added.length === 0) return;
      void notifyMentions({
        recipients: added,
        sender: { displayName: "", email: target.authorEmail },
        target: { kind: "quote", id: updated.id, title: updated.quoteNumber },
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
        void qc.invalidateQueries({ queryKey: QUOTES_KEY });
      }),
  });
}

/**
 * Mentioned people show as watchers at once and are written once the comment
 * lands — against the PMO site (see api/autoWatch.ts).
 */
function beginQuoteMentionAutoWatch(qc: QueryClient, id: number, bodyHtml: string): MentionAutoWatch | null {
  const quote = qc.getQueryData<Quote[]>(QUOTES_KEY)?.find((q) => q.id === id);
  if (!quote || !bodyHtml) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: quote.watchers,
    directory: () =>
      collectQuotePeople(
        qc.getQueryData<Quote[]>(QUOTES_KEY) ?? [],
        qc.getQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY) ?? [],
      ),
    resolveLookupId: resolvePmoSiteUserLookupId,
    patch: (watchers) => patchQuote(qc, id, (q) => ({ ...q, watchers })),
    write: (watchers) => setQuoteWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: QUOTES_KEY }),
    noun: "quote",
  });
}

// -----------------------------------------------------------------------------
// Revisions
// -----------------------------------------------------------------------------

/** Copy a quote forward as its next rev. Resolves `{ quote, warnings }`. */
export function useCreateQuoteRevision() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (quoteId: number) => {
      requireQuoteGate(createQuoteGate(await resolve()));
      return createQuoteRevision(quoteId);
    },
    onSuccess: ({ quote, warnings }) => {
      upsertQuote(qc, quote);
      void qc.invalidateQueries({ queryKey: QUOTES_KEY });
      void qc.invalidateQueries({ queryKey: QUOTE_ASSEMBLIES_KEY });
      void qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY });
      pushToast({ message: `Created ${quote.quoteNumber}.` });
      for (const message of warnings) pushToast({ message, variant: "error" });
    },
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, {
          action: "create the new rev",
          site: QUOTE_SITE_LABEL,
          permission: "creating items",
        }),
      ),
  });
}

// -----------------------------------------------------------------------------
// Phase 2 plumbing — the task hyperlinks, each in its own PATCH.
// -----------------------------------------------------------------------------

export function useSetQuoteLinks() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({
      id,
      links,
    }: {
      id: number;
      links: { engineeringTaskLink?: QuoteLink | null; operationsTaskLink?: QuoteLink | null };
    }) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      return setQuoteLinks(id, links);
    },
    onSuccess: (updated) => patchQuote(qc, updated.id, () => updated),
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, { action: "set the task link", site: QUOTE_SITE_LABEL, permission: "editing" }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTES_KEY }),
  });
}
