import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addPricingRequestComment,
  createPricingRequest,
  editPricingRequestComment,
  getPricingRequest,
  listPricingRequests,
  resolveSalesTeamSiteUserLookupId,
  setPricingRequestWatchers,
  updatePricingRequest,
  type PricingCommentInput,
  type PricingRequestPeople,
} from "@/api/pricingRequests";
import { getPricingHistoryForRequest, recordPricing } from "@/api/pricingHistory";
import { isPricingDataNotConnected, lookupSapPart, mockAddPartToSap } from "@/api/pricingLookup";
import { USE_MOCK } from "@/api/config";
import { notifyChangeEmails, notifyMentions } from "@/api/email";
import type { Person } from "@/types/task";
import type { PricingHistoryEntry, PricingHistoryRecord, PricingRequest, SapPart } from "@/types/pricing";
import { applyPricingRequestPatch, type PricingRequestPatch } from "@/lib/pricingMapper";
import {
  accessPricingGate,
  addedToSapGate,
  cancelRequestGate,
  priceGate,
  seePricingCostGate,
} from "@/lib/pricingRoles";
import {
  buildAddedToSapEmails,
  buildPricedEmails,
  buildPricingRequestRaisedEmails,
  requestDetails,
} from "@/lib/pricingAlerts";
import type { ChangeTarget } from "@/lib/changeAlerts";
import { autoWatchers, mergePeople } from "@/lib/people";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { commentNotifyRecipients, newlyMentionedHtml } from "@/lib/mentions";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { htmlToPlainText } from "@/lib/htmlText";
import { pushToast } from "@/components/Toast";
import { afterMentionAutoWatch, beginMentionAutoWatch, type MentionAutoWatch } from "./mentionAutoWatch";
import { useCurrentUser } from "./useCurrentUser";
import { newlyMentionedRecipients } from "./useQuotes";
import { readPricingRoles, requirePricingGate, useResolvePricingAccess } from "./usePricingRoles";

// =============================================================================
// Pricing Requests — the hooks (BusinessIT#47).
//
// Every write asks its gate INSIDE the mutationFn, against access resolved by
// awaiting the roles list. The workflow (Ray, 2026-10-13):
//
//   Awaiting SAP → Submitted → In Review → Priced      (and Cancelled)
//
//   * On submit ARC looks the part up in SAP. Found → Submitted, the SAP
//     number and description filled in, the managers emailed. Not found →
//     Awaiting SAP, the admins emailed to set it up.
//   * Added to SAP (admin) re-checks SAP and moves it on to Submitted.
//   * In Review is set when a manager first opens it.
//   * Priced writes Pricing History FIRST (the reasoning), then the request
//     (the outcome), and emails the requester and watchers.
//   * A manager can reopen a priced request; the old pricing stays in History.
//
// While SAP data isn't connected, the SAP number TYPED on the form decides
// the route — a request is never refused for want of a lookup.
// =============================================================================

export const PRICING_REQUESTS_KEY = ["pricing-requests", "list"] as const;
export const PRICING_HISTORY_KEY = ["pricing-history"] as const;

export const PRICING_SITE_LABEL = "ALTRONICSALESTEAM";

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function usePricingRequests(enabled = true) {
  return useQuery<PricingRequest[]>({
    queryKey: PRICING_REQUESTS_KEY,
    queryFn: listPricingRequests,
    staleTime: 60_000,
    enabled,
  });
}

/** One request, derived from the list cache (like useTask). */
export function usePricingRequest(id: number | null) {
  const { data: requests = [], ...rest } = usePricingRequests();
  return { ...rest, data: id === null ? undefined : requests.find((r) => r.id === id) };
}

/** The pricing record for a request — only fetched for someone who may see cost. */
export function usePricingHistory(requestId: number | null, canSeeCost: boolean) {
  return useQuery<PricingHistoryRecord | null>({
    queryKey: [...PRICING_HISTORY_KEY, requestId],
    queryFn: () => getPricingHistoryForRequest(requestId!),
    enabled: canSeeCost && requestId !== null,
    staleTime: 60_000,
  });
}

export function targetOf(r: Pick<PricingRequest, "id" | "requestNumber" | "altronicPartNumber">): ChangeTarget {
  return {
    kind: "pricingRequest",
    id: r.id,
    title: r.altronicPartNumber ? `${r.requestNumber} — ${r.altronicPartNumber}` : r.requestNumber,
  };
}

/** Everyone already on a request — the @-mention picker's starting point. */
export function collectPricingPeople(requests: PricingRequest[]): Person[] {
  return mergePeople(
    ...requests.map((r) => [...r.watchers, ...(r.requestedBy ? [r.requestedBy] : []), ...(r.pricedBy ? [r.pricedBy] : [])]),
  );
}

function patchRequest(qc: QueryClient, id: number, update: (r: PricingRequest) => PricingRequest) {
  qc.setQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY, (old) => old?.map((r) => (r.id === id ? update(r) : r)));
}

function upsertRequest(qc: QueryClient, row: PricingRequest) {
  qc.setQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY, (old) => {
    if (!old) return [row];
    return old.some((r) => r.id === row.id) ? old.map((r) => (r.id === row.id ? row : r)) : [row, ...old];
  });
}

/** The current user, read through a ref so a callback captured early still sees /me's answer. */
function useActorRef() {
  const actor = useCurrentUser();
  const ref = useRef(actor);
  ref.current = actor;
  return ref;
}

/** The request as it stands — the cache first, then a fresh read. */
async function currentRequest(qc: QueryClient, id: number): Promise<PricingRequest> {
  const cached = qc.getQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY)?.find((r) => r.id === id);
  const found = cached ?? (await getPricingRequest(id));
  if (!found) throw new Error(`Request ${id} not found`);
  return found;
}

/** Send emails in the background; a failed send toasts itself (api/email.ts). */
function send(target: ChangeTarget, emails: ReturnType<typeof buildPricedEmails>) {
  if (emails.length > 0) void notifyChangeEmails({ target, emails });
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface PricingRequestFormInput {
  altronicPartNumber: string;
  sapPartNumber: string;
  description: string;
  requestedBy: Person;
  notes: string;
  customerSoldTo: string;
  customerName: string;
  customerGroup: string;
}

/**
 * Where a new request goes, from what SAP says. `part` null with
 * `notConnected` false means SAP genuinely hasn't got it.
 */
export function routeNewRequest(
  input: Pick<PricingRequestFormInput, "sapPartNumber" | "description">,
  sap: { part: SapPart | null; notConnected: boolean },
): { inSap: boolean; sapPartNumber: string; description: string; mpg: string } {
  if (sap.part) {
    return {
      inSap: true,
      sapPartNumber: sap.part.sapPartNumber,
      description: sap.part.description || input.description,
      mpg: sap.part.mpg,
    };
  }
  if (sap.notConnected) {
    // No warehouse to ask: a typed SAP number is the requester's word that it exists.
    return { inSap: !!input.sapPartNumber.trim(), sapPartNumber: input.sapPartNumber.trim(), description: input.description, mpg: "" };
  }
  return { inSap: false, sapPartNumber: input.sapPartNumber.trim(), description: input.description, mpg: "" };
}

async function askSap(args: { altronicPartNumber: string; sapPartNumber: string }) {
  try {
    return { part: await lookupSapPart(args), notConnected: false };
  } catch (err) {
    if (isPricingDataNotConnected(err)) return { part: null, notConnected: true };
    throw err;
  }
}

export function useCreatePricingRequest() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async (input: PricingRequestFormInput) => {
      requirePricingGate(accessPricingGate(await resolve()));
      const route = routeNewRequest(input, await askSap(input));
      const created = await createPricingRequest({
        status: route.inSap ? "Submitted" : "Awaiting SAP",
        altronicPartNumber: input.altronicPartNumber,
        sapPartNumber: route.sapPartNumber,
        requestedDescription: input.description,
        description: route.description,
        mpg: route.mpg,
        requestedBy: input.requestedBy,
        notes: input.notes,
        customerSoldTo: input.customerSoldTo,
        customerName: input.customerName,
        customerGroup: input.customerGroup,
        // The requester (and whoever raised it for them) watch it.
        watchers: autoWatchers([], input.requestedBy, actorRef.current),
      });
      return { created, inSap: route.inSap };
    },
    onSuccess: async ({ created, inSap }) => {
      upsertRequest(qc, created);
      void qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY });
      pushToast({
        message: inSap
          ? `Raised ${created.requestNumber} — sent to the pricing managers.`
          : `Raised ${created.requestNumber} — the part isn't in SAP yet, so it has gone to be set up first.`,
      });
      try {
        const roles = await readPricingRoles(qc);
        send(
          targetOf(created),
          buildPricingRequestRaisedEmails({
            target: targetOf(created),
            actor: actorRef.current,
            requester: created.requestedBy,
            roles,
            inSap,
            details: requestDetails(created),
          }),
        );
      } catch {
        errorToast("The request was raised, but the pricing roles couldn't be read to email anyone.");
      }
    },
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, { action: "raise the request", site: PRICING_SITE_LABEL, permission: "creating items" }),
      ),
  });
}

// -----------------------------------------------------------------------------
// Workflow steps
// -----------------------------------------------------------------------------

/** Admin: the part has been set up in SAP. Re-checks SAP and moves the request on. */
export function useMarkAddedToSap() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async (vars: { id: number; sapPartNumber: string }) => {
      requirePricingGate(addedToSapGate(await resolve()));
      const before = await currentRequest(qc, vars.id);
      if (before.status !== "Awaiting SAP") throw new Error(`${before.requestNumber} isn't waiting on SAP.`);
      // MOCK ONLY: stand in for the admin's work in SAP, so the demo can walk it.
      if (USE_MOCK) mockAddPartToSap(before.altronicPartNumber, before.description);
      const sap = await askSap({ altronicPartNumber: before.altronicPartNumber, sapPartNumber: vars.sapPartNumber });
      let patch: PricingRequestPatch;
      if (sap.part) {
        patch = { sapPartNumber: sap.part.sapPartNumber, description: sap.part.description || before.description, mpg: sap.part.mpg };
      } else if (sap.notConnected) {
        if (!vars.sapPartNumber.trim()) throw new Error("Enter the SAP part number it was set up under.");
        patch = { sapPartNumber: vars.sapPartNumber.trim() };
      } else {
        throw new Error(
          `SAP doesn't show ${before.altronicPartNumber} yet. ARC reads a copy of SAP that can lag a little behind ` +
            "it — if you've just set the part up, try again shortly.",
        );
      }
      const updated = await updatePricingRequest(
        vars.id,
        { ...patch, status: "Submitted", addedToSapAt: new Date().toISOString() },
        before,
        { addedToSapBy: actorRef.current },
      );
      return updated;
    },
    onSuccess: async (updated) => {
      upsertRequest(qc, updated);
      pushToast({ message: `${updated.requestNumber} is in SAP — sent to the pricing managers.` });
      try {
        const roles = await readPricingRoles(qc);
        send(
          targetOf(updated),
          buildAddedToSapEmails({
            target: targetOf(updated),
            actor: actorRef.current,
            requester: updated.requestedBy,
            roles,
            sapPartNumber: updated.sapPartNumber,
          }),
        );
      } catch {
        errorToast("Saved, but the pricing roles couldn't be read to email the managers.");
      }
    },
    onError: (err: unknown) => errorToast(err instanceof Error ? err.message : "Couldn't record that — try again."),
    onSettled: () => qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY }),
  });
}

/**
 * Submitted → In Review, the first time a manager opens it. Quiet: a failure
 * here costs only the label, and the manager is about to price it anyway.
 */
export function useStartPricingReview() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePricingGate(priceGate(await resolve()));
      const before = await currentRequest(qc, id);
      if (before.status !== "Submitted") return before;
      return updatePricingRequest(id, { status: "In Review" }, before);
    },
    onSuccess: (updated) => upsertRequest(qc, updated),
  });
}

export interface PriceRequestVars {
  id: number;
  /** Everything about how the price was reached, minus who and when (added here). */
  entry: Omit<PricingHistoryEntry, "pricedAt" | "pricedBy">;
}

/** Set (or change) the price: History first, then the request, then the emails. */
export function usePriceRequest() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async ({ id, entry }: PriceRequestVars) => {
      requirePricingGate(priceGate(await resolve()));
      const before = await currentRequest(qc, id);
      if (before.status === "Cancelled") throw new Error(`${before.requestNumber} is cancelled.`);
      if (before.status === "Awaiting SAP") throw new Error("This part isn't in SAP yet — it can't be priced until an admin sets it up.");
      const actor = actorRef.current;
      const pricedAt = new Date().toISOString();
      const full: PricingHistoryEntry = {
        ...entry,
        pricedAt,
        pricedBy: { displayName: actor.displayName, email: actor.email ?? "" },
      };
      // The reasoning FIRST: a price on the request with no record of how it
      // was reached is the outcome this feature exists to prevent.
      const record = await recordPricing(before, full);
      const updated = await updatePricingRequest(
        id,
        {
          status: "Priced",
          listPrice: entry.listPrice,
          customerDiscountPct: entry.customerDiscountPct,
          customerPrice: entry.customerPrice,
          pricedAt,
        },
        before,
        { pricedBy: actor },
      );
      return { updated, record, repriced: record.history.length > 1 };
    },
    onSuccess: ({ updated, record, repriced }) => {
      upsertRequest(qc, updated);
      qc.setQueryData([...PRICING_HISTORY_KEY, updated.id], record);
      pushToast({ message: `${repriced ? "Re-priced" : "Priced"} ${updated.requestNumber}.` });
      send(
        targetOf(updated),
        buildPricedEmails({
          target: targetOf(updated),
          actor: actorRef.current,
          requester: updated.requestedBy,
          watchers: updated.watchers,
          listPrice: updated.listPrice ?? 0,
          customerName: updated.customerName,
          customerPrice: updated.customerPrice,
          repriced,
        }),
      );
    },
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "save the price", site: PRICING_SITE_LABEL, permission: "editing" })),
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY });
      void qc.invalidateQueries({ queryKey: [...PRICING_HISTORY_KEY, vars.id] });
    },
  });
}

/** A manager reopens a priced request to change the price. Its history is kept. */
export function useReopenPricingRequest() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePricingGate(priceGate(await resolve()));
      const before = await currentRequest(qc, id);
      if (before.status !== "Priced") throw new Error(`${before.requestNumber} isn't priced.`);
      return updatePricingRequest(id, { status: "In Review" }, before);
    },
    onSuccess: (updated) => {
      upsertRequest(qc, updated);
      pushToast({ message: `Reopened ${updated.requestNumber} — the earlier price stays in its history.` });
    },
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "reopen the request", site: PRICING_SITE_LABEL, permission: "editing" })),
    onSettled: () => qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY }),
  });
}

/** Cancel — never delete. A reason is required. */
export function useCancelPricingRequest() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      if (!reason.trim()) throw new Error("Say why it's being cancelled.");
      const before = await currentRequest(qc, id);
      const actor = actorRef.current;
      const isMine = !!before.requestedBy?.email && matchesAnyEmail([actor.email ?? ""], before.requestedBy.email);
      requirePricingGate(cancelRequestGate(await resolve(), { status: before.status, isMine }));
      return updatePricingRequest(id, { status: "Cancelled", cancelReason: reason.trim() }, before);
    },
    onSuccess: (updated) => {
      upsertRequest(qc, updated);
      pushToast({ message: `Cancelled ${updated.requestNumber}.` });
    },
    onError: (err: unknown) => errorToast(err instanceof Error ? err.message : "Couldn't cancel — try again."),
    onSettled: () => qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY }),
  });
}

/** Edit the request's own details (notes, description, customer) before it is priced. */
export function useUpdatePricingRequest() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, patch, people }: { id: number; patch: PricingRequestPatch; people?: PricingRequestPeople }) => {
      requirePricingGate(accessPricingGate(await resolve()));
      const before = await currentRequest(qc, id);
      return updatePricingRequest(id, patch, before, people);
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: PRICING_REQUESTS_KEY });
      const previous = qc.getQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY);
      patchRequest(qc, id, (r) => applyPricingRequestPatch(r, patch));
      return { previous };
    },
    onSuccess: (updated) => upsertRequest(qc, updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PRICING_REQUESTS_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action: "save that change", site: PRICING_SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY }),
  });
}

// -----------------------------------------------------------------------------
// Watchers and comments — open to every role.
// -----------------------------------------------------------------------------

export function useSetPricingRequestWatchers() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, people }: { id: number; people: Person[] }) => {
      requirePricingGate(accessPricingGate(await resolve()));
      return setPricingRequestWatchers(id, people);
    },
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: PRICING_REQUESTS_KEY });
      const previous = qc.getQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY);
      patchRequest(qc, id, (r) => ({ ...r, watchers: people }));
      return { previous };
    },
    onSuccess: (updated) => upsertRequest(qc, updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PRICING_REQUESTS_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action: "update the watchers", site: PRICING_SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY }),
  });
}

function beginPricingMentionAutoWatch(qc: QueryClient, id: number, bodyHtml: string): MentionAutoWatch | null {
  const request = qc.getQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY)?.find((r) => r.id === id);
  if (!request || !bodyHtml) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: request.watchers,
    directory: () => collectPricingPeople(qc.getQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY) ?? []),
    // A lookupId is valid on ONE site — the Sales site's, here.
    resolveLookupId: resolveSalesTeamSiteUserLookupId,
    patch: (watchers) => patchRequest(qc, id, (r) => ({ ...r, watchers })),
    write: (watchers) => setPricingRequestWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY }),
    noun: "request",
  });
}

/** Call `mutateAsync` and RETURN its promise from the composer, so a failed comment is restored. */
export function useAddPricingRequestComment() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment: PricingCommentInput }) => {
      requirePricingGate(accessPricingGate(await resolve()));
      return addPricingRequestComment(id, comment);
    },
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: PRICING_REQUESTS_KEY });
      const previous = qc.getQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY);
      patchRequest(qc, id, (r) => ({ ...r, comments: [{ ...comment, timestamp: new Date(), attachments: [] }, ...r.comments] }));
      return { previous, autoWatch: beginPricingMentionAutoWatch(qc, id, comment.bodyHtml) };
    },
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });
      const request = qc.getQueryData<PricingRequest[]>(PRICING_REQUESTS_KEY)?.find((r) => r.id === id);
      if (!request) return;
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: request.watchers,
        // No assignee column — the requester watches their own request.
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length === 0) return;
      void notifyMentions({
        recipients,
        sender: { displayName: comment.authorName, email: comment.authorEmail },
        target: { kind: "pricingRequest", id: request.id, title: targetOf(request).title },
        commentExcerpt: htmlToPlainText(comment.bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(PRICING_REQUESTS_KEY, ctx.previous);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY });
      }),
  });
}

export function useEditPricingRequestComment() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async (vars: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      bodyHtml: string;
      previousBodyHtml: string;
    }) => {
      requirePricingGate(accessPricingGate(await resolve()));
      return editPricingRequestComment(vars.id, vars.target, vars.bodyHtml);
    },
    onMutate: async ({ id, bodyHtml, previousBodyHtml }) => {
      const newMentions = newlyMentionedHtml(previousBodyHtml, bodyHtml);
      if (newMentions) await qc.cancelQueries({ queryKey: PRICING_REQUESTS_KEY });
      return { autoWatch: beginPricingMentionAutoWatch(qc, id, newMentions) };
    },
    onSuccess: (updated, { target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });
      const added = newlyMentionedRecipients(previousBodyHtml, bodyHtml);
      if (added.length === 0) return;
      void notifyMentions({
        recipients: added,
        sender: { displayName: "", email: target.authorEmail },
        target: { kind: "pricingRequest", id: updated.id, title: targetOf(updated).title },
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
        void qc.invalidateQueries({ queryKey: PRICING_REQUESTS_KEY });
      }),
  });
}

export { seePricingCostGate };
