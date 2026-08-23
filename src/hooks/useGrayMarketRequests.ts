import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addGrayMarketComment,
  createGrayMarketRequest,
  editGrayMarketComment,
  listGrayMarketRequests,
  setGrayMarketWatchers,
  updateGrayMarketFields,
} from "@/api/grayMarketRequests";
import type { GrayMarketRequest, GrayMarketRequestInput, Person } from "@/types/task";
import { grayMarketLabel } from "@/lib/grayMarketMapper";
import { formatSpDate } from "@/lib/spDates";
import { commentNotifyRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { fireNewGrayMarketRequestAlert, notifyMentions } from "@/api/email";
import { autoWatchFromMentions } from "@/api/autoWatch";
// Gray Market lives on the PMO site, so cold-start mentions resolve there.
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import { autoWatchers, mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Gray Market Request hooks.
//
// The comment thread is the standard one: post → optimistic insert → email
// every watcher and @-mentioned person → add the mentioned as watchers. That
// path is identical across six entities already, so the pieces are shared
// (commentNotifyRecipients, notifyMentions, autoWatchFromMentions) and only
// the target kind and the cache key differ here.
//
// Field edits are optimistic and single-column, so a choice picker on the
// detail page doesn't sit there for a round-trip.
// =============================================================================

export const GRAY_MARKET_KEY = ["grayMarketRequests"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useGrayMarketRequests() {
  return useQuery({
    queryKey: GRAY_MARKET_KEY,
    queryFn: listGrayMarketRequests,
    staleTime: 60_000,
  });
}

/** One request out of the cached list. */
export function useGrayMarketRequest(id: number | null) {
  const { data: requests = [], ...rest } = useGrayMarketRequests();
  return {
    ...rest,
    data: id === null ? undefined : requests.find((r) => r.id === id),
  };
}

/** Everyone already on a request — the @-mention picker's starting point. */
export function collectGrayMarketPeople(requests: GrayMarketRequest[]): Person[] {
  const lists = requests.map((r) =>
    [r.requestor, r.partsLocation, ...r.watchers].filter((p): p is Person => !!p),
  );
  return mergePeople(...lists);
}

function patchRequest(
  qc: QueryClient,
  id: number,
  update: (r: GrayMarketRequest) => GrayMarketRequest,
) {
  qc.setQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY, (old) =>
    old?.map((r) => (r.id === id ? update(r) : r)),
  );
}

export function useCreateGrayMarketRequest() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: (input: GrayMarketRequestInput) => {
      const existing = qc.getQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY) ?? [];
      // Whoever raises the request watches it — and so does the requestor they
      // named, if that's someone else. See autoWatchers in lib/people.ts.
      return createGrayMarketRequest(
        { ...input, requestor: input.requestor ?? actor },
        existing,
      );
    },
    onSuccess: (created) => {
      qc.setQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: GRAY_MARKET_KEY });
      pushToast({ message: `Logged ${grayMarketLabel(created)}.` });

      // Nothing watches the list itself, so a new request used to sit until
      // someone opened ARC and noticed it. The configured intake list is told
      // on every create (Ray, 2026-08-23) — see GRAY_MARKET_NEW_REQUEST_ALERTS.
      fireNewGrayMarketRequestAlert({
        target: {
          kind: "grayMarketRequest",
          id: created.id,
          title: grayMarketLabel(created),
        },
        actor: created.requestor ?? actor,
        details: newRequestDetails(created),
      });
    },
    onError: (err: Error) => errorToast(`Couldn't log the request: ${err.message}`),
  });
}

/**
 * What the intake email says about a new request. Blank values are dropped by
 * the builder — a new request is mostly empty by design, since purchasing,
 * engineering and inspection fill their own stages in later.
 */
function newRequestDetails(r: GrayMarketRequest) {
  return [
    { label: "Assembly number", value: r.title },
    { label: "Part description", value: r.values.partDescription ?? "" },
    { label: "AI part no.", value: r.values.aiPartNo ?? "" },
    { label: "Vendor", value: r.values.vendor ?? "" },
    { label: "Qty purchased", value: r.values.qtyPurchased ?? "" },
    { label: "PO no.", value: r.values.poNo ?? "" },
    { label: "Requested", value: r.requestDate ? formatSpDate(r.requestDate) : "" },
    { label: "Testing required", value: r.testingRequired },
    { label: "Requestor", value: r.requestor?.displayName ?? "" },
  ];
}

/** Patch one or more columns, optimistically. */
export function useUpdateGrayMarketFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: number;
      fields: Record<string, unknown>;
      patch: (r: GrayMarketRequest) => GrayMarketRequest;
    }) => updateGrayMarketFields(id, fields),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: GRAY_MARKET_KEY });
      const previous = qc.getQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY);
      patchRequest(qc, id, patch);
      return { previous };
    },
    onSuccess: (updated) => {
      patchRequest(qc, updated.id, () => updated);
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(GRAY_MARKET_KEY, ctx.previous);
      errorToast(`Couldn't save that change — reverted. ${err.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: GRAY_MARKET_KEY }),
  });
}

export function useSetGrayMarketWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setGrayMarketWatchers(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: GRAY_MARKET_KEY });
      const previous = qc.getQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY);
      patchRequest(qc, id, (r) => ({ ...r, watchers: people }));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(GRAY_MARKET_KEY, ctx.previous);
      errorToast("Couldn't update the watchers — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: GRAY_MARKET_KEY }),
  });
}

export function useAddGrayMarketComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addGrayMarketComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: GRAY_MARKET_KEY });
      const previous = qc.getQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY);
      patchRequest(qc, id, (r) => ({
        ...r,
        comments: [
          {
            timestamp: new Date(),
            authorName: comment.authorName,
            authorEmail: comment.authorEmail,
            bodyHtml: comment.bodyHtml,
            attachments: [],
          },
          ...r.comments,
        ],
        modifiedAt: new Date(),
      }));
      return { previous };
    },
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const requests = qc.getQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY);
      const request = requests?.find((r) => r.id === id);
      if (!request) return;

      const sender: Person = {
        displayName: comment.authorName,
        email: comment.authorEmail,
      };
      // Watchers + the requestor, minus the author — the standard rule. A
      // gray market request has no "assignee", so the requestor plays that
      // part: they're the person waiting on the answer.
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: request.watchers,
        assignees: request.requestor ? [request.requestor] : [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: {
            kind: "grayMarketRequest",
            id: request.id,
            title: grayMarketLabel(request),
          },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: request.watchers,
        directory: requests ? collectGrayMarketPeople(requests) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, request.watchers, additions))
        .catch((err: unknown) => {
          console.error("Auto-watch failed for a gray market comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(GRAY_MARKET_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: GRAY_MARKET_KEY }),
  });
}

export function useEditGrayMarketComment() {
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
    }) => editGrayMarketComment(id, target, bodyHtml),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }) => {
      pushToast({ message: "Comment updated." });

      const requests = qc.getQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY);
      const request = requests?.find((r) => r.id === id);
      if (!request) return;

      // Only the NEWLY mentioned are emailed — editing a comment shouldn't
      // re-ping everyone who was already in it.
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
        target: {
          kind: "grayMarketRequest",
          id: request.id,
          title: grayMarketLabel(request),
        },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: added,
        currentWatchers: request.watchers,
        directory: requests ? collectGrayMarketPeople(requests) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, request.watchers, additions))
        .catch((err: unknown) => {
          console.error("Auto-watch failed for a gray market comment edit:", err);
        });
    },
    onError: () => errorToast("Couldn't update the comment — please retry."),
    onSettled: () => qc.invalidateQueries({ queryKey: GRAY_MARKET_KEY }),
  });
}

/**
 * Apply auto-watch additions optimistically, then save them — the watcher
 * chips and toast show at once, and a failed write refetches so the UI stops
 * claiming someone is watching when they aren't.
 */
async function applyWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = autoWatchers(currentWatchers, additions);
  const patch = () => patchRequest(qc, id, (r) => ({ ...r, watchers: next }));
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this request.`
        : `${additions.length} people are now watching this request.`,
  });
  try {
    await setGrayMarketWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    qc.invalidateQueries({ queryKey: GRAY_MARKET_KEY });
  }
}
