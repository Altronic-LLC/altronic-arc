import { useRef } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addBuildRequestComment,
  createBuildRequest,
  editBuildRequestComment,
  listBuildRequests,
  setBuildRequestEngineer,
  setBuildRequestProjects,
  setBuildRequestRequestor,
  setBuildRequestWatchers,
  updateBuildRequestFields,
} from "@/api/buildRequests";
import {
  addBuildRequestItemComment,
  createBuildRequestItem,
  deleteBuildRequestItem,
  editBuildRequestItemComment,
  listBuildRequestItems,
  setBuildRequestItemWatchers,
  updateBuildRequestItemFields,
} from "@/api/buildRequestItems";
import type { BuildRequest, BuildRequestItem, Person } from "@/types/task";
import { ALL_CHECKLIST_FIELDS } from "@/lib/buildRequestChecklist";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import {
  fireAssigneeChangeAlert,
  fireBuildRequestCompleteAlert,
  fireBuildRequestPartProductionCompleteAlert,
  fireBuildRequestProductionCompleteAlert,
  fireBuildRequestReadyForProductionAlert,
  fireFieldChangeAlert,
  notifyMentions,
} from "@/api/email";
import { htmlToPlainText } from "@/lib/htmlText";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
} from "@/lib/mentions";
import { useCurrentUser, useCurrentUserEmails } from "@/hooks/useCurrentUser";
import { ADMINS_KEY } from "./useAdmins";
import { listAdmins } from "@/api/admins";
import { isAdminEmail } from "@/lib/adminAccess";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { productionTransitionRefusal } from "@/lib/buildRequestProduction";
import { resolveCurrentUserLookupId } from "@/api/currentUser";
import { autoWatchers } from "@/lib/people";
import { fanOutComment } from "@/hooks/useCommentMirror";
import {
  afterMentionAutoWatch,
  beginMentionAutoWatch,
  type MentionAutoWatch,
} from "./mentionAutoWatch";
import { buildRequestsForTask } from "@/lib/buildRequestFromTask";
import { parseWrittenDate } from "@/lib/dateInput";

// =============================================================================
// Build Request hooks — two query caches (headers + items) with the same
// forked optimistic snapshot/rollback/undo infra useEirs/useOperationsTasks
// use (that infra closes over its own types and isn't generic). Comment
// mutations fire mention/watcher emails with kind "buildRequest" (headers)
// or "buildRequestItem" (parts).
// =============================================================================

export const BUILD_REQUESTS_KEY = ["buildRequests", "list"] as const;
export const BUILD_REQUEST_ITEMS_KEY = ["buildRequestItems", "list"] as const;

export function useBuildRequests() {
  return useQuery({
    queryKey: BUILD_REQUESTS_KEY,
    queryFn: listBuildRequests,
    staleTime: 30_000,
  });
}

export function useBuildRequestItems() {
  return useQuery({
    queryKey: BUILD_REQUEST_ITEMS_KEY,
    queryFn: listBuildRequestItems,
    staleTime: 30_000,
  });
}

/** One header, derived from the list cache. */
export function useBuildRequest(id: number | null) {
  const list = useBuildRequests();
  return {
    ...list,
    data: id != null ? list.data?.find((b) => b.id === id) ?? null : null,
  };
}

/**
 * The Build Requests raised from a task — DERIVED from each BR's own
 * `TaskReference`, not stored on the task.
 *
 * The Task list has no Build Request column, and adding one would mean two
 * columns that can disagree about the same link (and a schema change on the
 * busiest list in ARC). Deriving costs nothing extra: the Build Requests
 * list is already loaded whole, and the filter runs in the browser.
 *
 * `isLoading` is forwarded so a caller can tell "no build request" from
 * "haven't looked yet" — rendering the first as the second is how a "Create
 * Build Request" button briefly appears on a task that already has one.
 */
export function useBuildRequestsForTask(taskId: number | null) {
  const list = useBuildRequests();
  return {
    ...list,
    data: buildRequestsForTask(list.data ?? [], taskId),
  };
}

// ---- optimistic infra: headers ---------------------------------------------

type BrCtx = { previous?: BuildRequest[]; prevBr?: BuildRequest };

async function snapshotAndPatchBr(
  qc: QueryClient,
  prevId: number | null,
  patch: (brs: BuildRequest[]) => BuildRequest[],
): Promise<BrCtx> {
  await qc.cancelQueries({ queryKey: BUILD_REQUESTS_KEY });
  const previous = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY);
  const prevBr = prevId != null ? previous?.find((b) => b.id === prevId) : undefined;
  qc.setQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevBr };
}

function rollbackBr(qc: QueryClient, ctx: BrCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(BUILD_REQUESTS_KEY, ctx.previous);
}

function invalidateBrs(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: BUILD_REQUESTS_KEY });
}

function patchBr(id: number, transform: (b: BuildRequest) => BuildRequest) {
  return (brs: BuildRequest[]) => brs.map((b) => (b.id === id ? transform(b) : b));
}

function buildUndoBr(
  qc: QueryClient,
  snapshot: BuildRequest[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY, snapshot);
    serverRevert().catch((err) => {
      console.error("Undo failed:", err);
      pushToast({ message: "Couldn't undo on SharePoint. Refreshing the list.", variant: "error" });
      qc.invalidateQueries({ queryKey: BUILD_REQUESTS_KEY });
    });
  };
}

// ---- optimistic infra: items ------------------------------------------------

type ItemCtx = { previous?: BuildRequestItem[]; prevItem?: BuildRequestItem };

async function snapshotAndPatchItem(
  qc: QueryClient,
  prevId: number | null,
  patch: (items: BuildRequestItem[]) => BuildRequestItem[],
): Promise<ItemCtx> {
  await qc.cancelQueries({ queryKey: BUILD_REQUEST_ITEMS_KEY });
  const previous = qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY);
  const prevItem = prevId != null ? previous?.find((i) => i.id === prevId) : undefined;
  qc.setQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevItem };
}

function rollbackItem(qc: QueryClient, ctx: ItemCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(BUILD_REQUEST_ITEMS_KEY, ctx.previous);
}

function invalidateItems(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: BUILD_REQUEST_ITEMS_KEY });
}

function patchItem(id: number, transform: (i: BuildRequestItem) => BuildRequestItem) {
  return (items: BuildRequestItem[]) => items.map((i) => (i.id === id ? transform(i) : i));
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

// ---- header mutations --------------------------------------------------------

/** Apply a SharePoint-shaped fields object onto a header for the optimistic patch. */
function applyBrFieldsLocally(b: BuildRequest, fields: Record<string, unknown>): BuildRequest {
  const next = { ...b };
  if ("Title" in fields) next.title = fields.Title as string;
  if ("Product" in fields) next.product = fields.Product as string;
  if ("BRStatus" in fields) next.status = fields.BRStatus as BuildRequest["status"];
  if ("BrType0" in fields) next.brType = (fields.BrType0 as BuildRequest["brType"]) || null;
  if ("BlockedReason" in fields) {
    next.blockedReason = (fields.BlockedReason as BuildRequest["blockedReason"]) || null;
  }
  if ("RequiredLeadTime" in fields) {
    next.requiredLeadTime = (fields.RequiredLeadTime as BuildRequest["requiredLeadTime"]) || null;
  }
  if ("QuotedShipDate" in fields) {
    const v = fields.QuotedShipDate;
    next.quotedShipDate = parseWrittenDate(v);
  }
  if ("SamplePhase" in fields) {
    next.samplePhase = (fields.SamplePhase as BuildRequest["samplePhase"]) || null;
  }
  if ("CustomerName" in fields) next.customerName = fields.CustomerName as string;
  if ("CustomerPurchaseOrder" in fields) next.customerPO = fields.CustomerPurchaseOrder as string;
  if ("RoHS" in fields) next.leadFree = !!fields.RoHS;
  next.modifiedAt = new Date();
  return next;
}

/**
 * A status write the production hand-off rule refused
 * (`productionTransitionRefusal`). Thrown from `mutationFn` BEFORE any
 * request goes out, so the status picker can't bypass the detail page's
 * Ready for Production / Production Complete button.
 */
export class BuildRequestProductionRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BuildRequestProductionRefusedError";
  }
}

/**
 * Refusals decided in `onMutate`, against the PRE-patch row: by the time
 * `mutationFn` runs the optimistic patch has already moved the cached status
 * to the target, so every transition would read as a re-save. Keyed on the
 * variables object React Query hands to both — the FAIT `pendingSignOff`
 * pattern.
 */
const pendingProductionRefusal = new WeakMap<object, string>();

const PRODUCTION_GATED_STATUSES: readonly string[] = ["Ready for Production", "Production Complete"];

/**
 * Status changes whose own hand-off alert REPLACES the generic "status
 * changed" note (it already reaches the same watchers — sending both would
 * double-email them). "Production Complete" is deliberately absent: its own
 * alert goes only to the reviewer, so the generic note still tells watchers.
 */
function brStatusHasOwnAlert(from: string, to: string): boolean {
  if (from === to) return false;
  if (to === "Ready for Production") return true;
  return to === "Complete" && from === "Production Complete";
}

type BrFieldWrite = { id: number; fields: Record<string, unknown> };

export function useUpdateBuildRequestFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const isAdmin = useIsAdmin();
  const myEmails = useCurrentUserEmails();
  // Read at mutation time rather than closed over the first render: the
  // Admins list and /me both resolve asynchronously.
  const accessRef = useRef({ isAdmin, myEmails });
  accessRef.current = { isAdmin, myEmails };
  const actorRef = useRef(actor);
  actorRef.current = actor;
  return useMutation({
    mutationFn: (vars: BrFieldWrite) => {
      const refusal = pendingProductionRefusal.get(vars);
      if (refusal) throw new BuildRequestProductionRefusedError(refusal);
      return updateBuildRequestFields(vars.id, vars.fields);
    },
    onMutate: async (vars: BrFieldWrite): Promise<BrCtx> => {
      const { id, fields } = vars;
      if ("BRStatus" in fields) {
        const target = String(fields.BRStatus ?? "");
        if (PRODUCTION_GATED_STATUSES.includes(target)) {
          const brs = await qc.ensureQueryData({
            queryKey: BUILD_REQUESTS_KEY,
            queryFn: listBuildRequests,
          });
          const br = brs.find((b) => b.id === id);
          let refusal: string | null;
          if (!br) {
            refusal = "This build request couldn't be found — refresh and try again.";
          } else {
            const items = await qc.ensureQueryData({
              queryKey: BUILD_REQUEST_ITEMS_KEY,
              queryFn: listBuildRequestItems,
            });
            const parts = items.filter((i) => i.buildRequestLookupId === id);
            // The render-time admin flag reads FALSE while the Admins list is
            // still loading, which would refuse a real admin on first paint.
            // Await the list here (the CMMS gates do the same); fall back to
            // the render-time flag only if that read fails.
            const { myEmails } = accessRef.current;
            const admins = await qc
              .ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins })
              .catch(() => null);
            const isAdmin = admins
              ? myEmails.some((e) => isAdminEmail(e, admins))
              : accessRef.current.isAdmin;
            refusal = productionTransitionRefusal(br, parts, target, { isAdmin, myEmails });
          }
          if (refusal) {
            pendingProductionRefusal.set(vars, refusal);
            // No optimistic patch: nothing is going to be written.
            return {};
          }
        }
      }
      return snapshotAndPatchBr(qc, id, patchBr(id, (b) => applyBrFieldsLocally(b, fields)));
    },
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: "Changes saved." });
      const prevBr = ctx?.prevBr;
      if ("BRStatus" in fields && prevBr) {
        const from = prevBr.status;
        const to = String(fields.BRStatus ?? "");
        const who = actorRef.current;
        if (!brStatusHasOwnAlert(from, to)) {
          // No-ops by itself when from === to.
          fireFieldChangeAlert({
            target: { kind: "buildRequest", id, title: prevBr.brNo || prevBr.title },
            fieldLabel: "status",
            from,
            to,
            actor: who,
            watchers: prevBr.watchers,
            assignees: prevBr.engineerAssigned ? [prevBr.engineerAssigned] : [],
            reporter: prevBr.requestor,
          });
        }
        // `"BRStatus" in fields` is PRESENCE, not change — `to !== from` is
        // OUR guard, so re-saving a status never re-announces it.
        if (to !== from) {
          if (to === "Ready for Production") {
            fireBuildRequestReadyForProductionAlert({ buildRequest: prevBr, actor: who });
          } else if (to === "Production Complete") {
            fireBuildRequestProductionCompleteAlert({ buildRequest: prevBr, actor: who });
          } else if (to === "Complete" && from === "Production Complete") {
            fireBuildRequestCompleteAlert({ buildRequest: prevBr, actor: who });
          }
        }
      }
    },
    onError: (err, _vars, ctx) => {
      rollbackBr(qc, ctx);
      if (err instanceof BuildRequestProductionRefusedError) {
        errorToast(err.message);
        return;
      }
      errorToast("Couldn't save changes — they have been reverted.");
    },
    onSettled: () => invalidateBrs(qc),
  });
}

export function useSetBuildRequestRequestor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setBuildRequestRequestor(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatchBr(qc, id, patchBr(id, (b) => ({ ...b, requestor: person, modifiedAt: new Date() }))),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevBr?.requestor ?? null;
      pushToast({
        message: "Requestor updated.",
        undo: buildUndoBr(qc, ctx?.previous, () => setBuildRequestRequestor(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollbackBr(qc, ctx);
      errorToast("Couldn't update the requestor — reverted.");
    },
    onSettled: () => invalidateBrs(qc),
  });
}

export function useSetBuildRequestEngineer() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setBuildRequestEngineer(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatchBr(
        qc,
        id,
        patchBr(id, (b) => ({ ...b, engineerAssigned: person, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      const prev = ctx?.prevBr?.engineerAssigned ?? null;
      pushToast({
        message: "Engineer updated.",
        undo: buildUndoBr(qc, ctx?.previous, () => setBuildRequestEngineer(id, prev)),
      });
      if (ctx?.prevBr) {
        fireAssigneeChangeAlert({
          target: { kind: "buildRequest", id, title: ctx.prevBr.brNo || ctx.prevBr.title },
          prev: prev ? [prev] : [],
          next: person ? [person] : [],
          actor,
          watchers: ctx.prevBr.watchers,
          reporter: ctx.prevBr.requestor,
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollbackBr(qc, ctx);
      errorToast("Couldn't update the engineer — reverted.");
    },
    onSettled: () => invalidateBrs(qc),
  });
}

export function useSetBuildRequestProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lookupIds }: { id: number; lookupIds: number[] }) =>
      setBuildRequestProjects(id, lookupIds),
    onMutate: ({ id, lookupIds }) =>
      snapshotAndPatchBr(
        qc,
        id,
        patchBr(id, (b) => ({
          ...b,
          parentProjects: lookupIds.map(
            (lid) => b.parentProjects.find((p) => p.lookupId === lid) ?? { lookupId: lid, title: "" },
          ),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevBr?.parentProjects.map((p) => p.lookupId) ?? [];
      pushToast({
        message: "Project references updated.",
        undo: buildUndoBr(qc, ctx?.previous, () => setBuildRequestProjects(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollbackBr(qc, ctx);
      errorToast("Couldn't update project references — reverted.");
    },
    onSettled: () => invalidateBrs(qc),
  });
}

export function useSetBuildRequestWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setBuildRequestWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatchBr(qc, id, patchBr(id, (b) => ({ ...b, watchers: people, modifiedAt: new Date() }))),
    onSuccess: () => pushToast({ message: "Watchers updated." }),
    onError: (_err, _vars, ctx) => {
      rollbackBr(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidateBrs(qc),
  });
}

export function useCreateBuildRequest() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    // Creator + assigned engineer watch the new request — lib/people.ts.
    mutationFn: (input: Parameters<typeof createBuildRequest>[0]) =>
      createBuildRequest({
        ...input,
        watchers: autoWatchers(input.watchers, input.engineerAssigned, actor),
      }),
    onSuccess: (br, variables) => {
      pushToast({ message: `Created ${br.brNo}.` });
      // Seed the cache so navigating straight to the new detail page works
      // without waiting for the background refetch (the createTask lesson).
      qc.setQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY, (old) => (old ? [br, ...old] : [br]));
      invalidateBrs(qc);
      // Notify the engineer assigned at creation — see the note in
      // useOperationsTasks.ts's useCreateOperationsTask.
      const engineer = variables.engineerAssigned ?? null;
      if (engineer) {
        fireAssigneeChangeAlert({
          target: { kind: "buildRequest", id: br.id, title: br.brNo || br.title },
          prev: [],
          next: [engineer],
          actor,
          watchers: [],
        });
      }
    },
    onError: () => errorToast("Couldn't create the build request — please retry."),
  });
}

// ---- auto-watch helpers -------------------------------------------------------

/**
 * Start auto-watch for a build request HEADER comment: the mentioned people
 * appear as watchers immediately and are written once the comment lands.
 * Build requests live on the ENGINEERING site — hence that resolver.
 */
function beginBrMentionAutoWatch(
  qc: QueryClient,
  id: number,
  bodyHtml: string,
): MentionAutoWatch | null {
  const br = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY)?.find((b) => b.id === id);
  if (!br) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: br.watchers,
    directory: () =>
      collectBuildRequestPeople(
        qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY),
        qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY),
      ),
    resolveLookupId: resolveCurrentUserLookupId,
    patch: (watchers) =>
      qc.setQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY, (old) =>
        old?.map((b) => (b.id === id ? { ...b, watchers } : b)),
      ),
    write: (watchers) => setBuildRequestWatchers(id, watchers),
    onWriteFailed: () => invalidateBrs(qc),
    noun: "build request",
  });
}

/**
 * Same as beginBrMentionAutoWatch, for a PART's comment. A part's watchers
 * live on the item (Build Request Items list, BUILD_REQUEST_ITEMS_KEY), not
 * on its header.
 */
function beginItemMentionAutoWatch(
  qc: QueryClient,
  id: number,
  bodyHtml: string,
): MentionAutoWatch | null {
  const item = qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY)?.find((i) => i.id === id);
  if (!item) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: item.watchers,
    directory: () =>
      collectBuildRequestPeople(
        qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY),
        qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY),
      ),
    resolveLookupId: resolveCurrentUserLookupId,
    patch: (watchers) =>
      qc.setQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY, (old) =>
        old?.map((i) => (i.id === id ? { ...i, watchers } : i)),
      ),
    write: (watchers) => setBuildRequestItemWatchers(id, watchers),
    onWriteFailed: () => invalidateItems(qc),
    noun: "part",
  });
}

/** Flatten every Person across headers + items, deduped, lookupId-only. */
function collectBuildRequestPeople(
  brs: BuildRequest[] | undefined,
  items: BuildRequestItem[] | undefined,
): Person[] {
  const map = new Map<string, Person>();
  const note = (p: Person | null | undefined) => {
    if (!p) return;
    const key = (p.email ?? p.displayName).toLowerCase();
    if (!map.has(key) && p.lookupId) map.set(key, p);
  };
  for (const b of brs ?? []) {
    note(b.requestor);
    note(b.engineerAssigned);
    b.watchers.forEach(note);
  }
  for (const i of items ?? []) {
    i.watchers.forEach(note);
  }
  return [...map.values()];
}

// ---- header comments -----------------------------------------------------------

export function useAddBuildRequestComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addBuildRequestComment(id, comment),
    onMutate: async ({ id, comment }) => ({
      ...(await snapshotAndPatchBr(
        qc,
        id,
        patchBr(id, (b) => ({
          ...b,
          comments: [
            {
              timestamp: new Date(),
              authorName: comment.authorName,
              authorEmail: comment.authorEmail,
              bodyHtml: comment.bodyHtml,
              attachments: [],
            },
            ...b.comments,
          ],
          modifiedAt: new Date(),
        })),
      )),
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      autoWatch: beginBrMentionAutoWatch(qc, id, comment.bodyHtml),
    }),
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });

      const brs = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY);
      const br = brs?.find((b) => b.id === id);
      if (!br) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: br.watchers,
        assignees: br.engineerAssigned ? [br.engineerAssigned] : [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: {
            kind: "buildRequest",
            id: br.id,
            title: [br.brNo, br.title].filter(Boolean).join(" — ") || br.title,
          },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      // Copy it onto the task this request was raised from, if any, and
      // notify that side's watchers minus whoever we just emailed.
      void fanOutComment({
        qc,
        source: { kind: "buildRequest", id },
        comment,
        alreadyNotified: recipients,
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      rollbackBr(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    // Refetch only once any auto-watch write has landed, so the refetch
    // doesn't read a row without the new watchers and wipe their chips.
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => invalidateBrs(qc)),
  });
}

export function useEditBuildRequestComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      newBodyHtml,
    }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      newBodyHtml: string;
      renotify?: boolean;
    }) => editBuildRequestComment(id, target, newBodyHtml),
    onMutate: async ({ id, target, newBodyHtml }) => ({
      ...(await snapshotAndPatchBr(
        qc,
        id,
        patchBr(id, (b) => ({
          ...b,
          comments: b.comments.map((c) =>
            c.timestamp.getTime() === target.timestamp.getTime() &&
            (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
              ? { ...c, bodyHtml: newBodyHtml }
              : c,
          ),
          modifiedAt: new Date(),
        })),
      )),
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      autoWatch: beginBrMentionAutoWatch(qc, id, newBodyHtml),
    }),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
      ctx?.autoWatch?.commit();
      const prevComment = ctx?.prevBr?.comments.find(
        (c) =>
          c.timestamp.getTime() === target.timestamp.getTime() &&
          (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase(),
      );
      const prevBody = prevComment?.bodyHtml;
      pushToast({
        message: "Comment updated.",
        undo:
          prevBody !== undefined
            ? buildUndoBr(qc, ctx?.previous, () => editBuildRequestComment(id, target, prevBody))
            : undefined,
      });
      if (!prevComment) return;
      const brs = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY);
      const br = brs?.find((b) => b.id === id);
      if (!br) return;
      const sender: Person = { displayName: prevComment.authorName, email: prevComment.authorEmail };
      const targetRef = {
        kind: "buildRequest" as const,
        id: br.id,
        title: [br.brNo, br.title].filter(Boolean).join(" — ") || br.title,
      };

      if (renotify) {
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: br.watchers,
          assignees: br.engineerAssigned ? [br.engineerAssigned] : [],
          authorEmail: prevComment.authorEmail,
        });
        if (recipients.length > 0) {
          void notifyMentions({
            recipients,
            sender,
            target: targetRef,
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      } else {
        const prevMentions = new Set(
          prevBody ? extractMentionedRecipients(prevBody).map((r) => r.email.toLowerCase()) : [],
        );
        const newMentions = extractMentionedRecipients(newBodyHtml).filter(
          (r) => !prevMentions.has(r.email.toLowerCase()),
        );
        if (newMentions.length > 0) {
          void notifyMentions({
            recipients: newMentions.map((m) => ({ ...m, reason: "mentioned" as const })),
            sender,
            target: targetRef,
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      rollbackBr(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    // Refetch only once any auto-watch write has landed, so the refetch
    // doesn't read a row without the new watchers and wipe their chips.
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => invalidateBrs(qc)),
  });
}

// ---- item mutations -------------------------------------------------------------

export function useCreateBuildRequestItem() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    // Whoever adds a part watches it — parts carry their own comment thread,
    // so without this the person who added it misses every question about it.
    mutationFn: (input: Parameters<typeof createBuildRequestItem>[0]) =>
      createBuildRequestItem({
        ...input,
        watchers: autoWatchers(input.watchers, actor),
      }),
    onSuccess: (item) => {
      pushToast({ message: `Added part "${item.partNumber}".` });
      qc.setQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY, (old) =>
        old ? [item, ...old] : [item],
      );
      invalidateItems(qc);
    },
    onError: () => errorToast("Couldn't add the part — please retry."),
  });
}

/** Apply a SharePoint-shaped fields object onto an item for the optimistic patch. */
function applyItemFieldsLocally(
  i: BuildRequestItem,
  fields: Record<string, unknown>,
): BuildRequestItem {
  const next = { ...i, checklist: { ...i.checklist } };
  if ("Title" in fields) next.partNumber = fields.Title as string;
  if ("PartDesc" in fields) next.partDesc = fields.PartDesc as string;
  if ("DrawingNo" in fields) next.drawingNo = fields.DrawingNo as string;
  if ("DrawingRev" in fields) next.drawingRev = fields.DrawingRev as string;
  if ("Qty" in fields) next.qty = (fields.Qty as number | null) ?? null;
  if ("WONo_x002e_" in fields) next.woNo = fields.WONo_x002e_ as string;
  if ("SpecialInstructions" in fields) next.specialInstructions = fields.SpecialInstructions as string;
  if ("TestPlan" in fields) next.testPlan = fields.TestPlan as string;
  if ("OPSummary" in fields) next.opSummary = fields.OPSummary as string;
  if ("SerialNos" in fields) next.serialNos = fields.SerialNos as string;
  if ("RevisionDate" in fields) next.revisionDate = fields.RevisionDate as string;
  if ("PartType" in fields) next.partType = (fields.PartType as BuildRequestItem["partType"]) || null;
  if ("Part_x0020_Status" in fields) {
    next.partStatus = (fields.Part_x0020_Status as BuildRequestItem["partStatus"]) || null;
  }
  if ("Disposition" in fields) {
    next.disposition = (fields.Disposition as BuildRequestItem["disposition"]) || null;
  }
  if ("Assembly" in fields) next.assembly = (fields.Assembly as string[]) ?? [];
  if ("Operations" in fields) next.operations = (fields.Operations as string[]) ?? [];
  if ("Testing" in fields) next.testing = (fields.Testing as string[]) ?? [];
  for (const def of ALL_CHECKLIST_FIELDS) {
    if (def.field in fields) next.checklist[def.field] = !!fields[def.field];
  }
  next.modifiedAt = new Date();
  return next;
}

export function useUpdateBuildRequestItemFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  // Read at send time: useCurrentUser re-resolves asynchronously.
  const actorRef = useRef(actor);
  actorRef.current = actor;
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateBuildRequestItemFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatchItem(qc, id, patchItem(id, (i) => applyItemFieldsLocally(i, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: "Part updated." });
      const prevItem = ctx?.prevItem;
      if (!("Part_x0020_Status" in fields) || !prevItem) return;
      const from = prevItem.partStatus ?? "Not set";
      const to = String(fields.Part_x0020_Status ?? "Not set");
      const generic = () =>
        fireFieldChangeAlert({
          target: { kind: "buildRequestItem", id, title: prevItem.partNumber },
          fieldLabel: "part status",
          from,
          to,
          actor: actorRef.current,
          watchers: prevItem.watchers,
          assignees: [],
        });
      // `to !== from` is the guard; presence of the field is not a change.
      if (to !== "Production Complete" || to === from) {
        generic();
        return;
      }
      // A part REACHING Production Complete gets its own alert (the request's
      // engineer, watchers and requestor plus the part's watchers), replacing
      // the generic note rather than doubling it. The parent is LOADED if the
      // cache hasn't got it — a part edited before the requests list arrived
      // must still reach the engineer, not only the part's watchers.
      void qc
        .ensureQueryData({ queryKey: BUILD_REQUESTS_KEY, queryFn: listBuildRequests })
        .then((brs) => brs.find((b) => b.id === prevItem.buildRequestLookupId))
        .catch(() => undefined)
        .then((parent) => {
          if (parent) {
            fireBuildRequestPartProductionCompleteAlert({
              buildRequest: parent,
              part: prevItem,
              actor: actorRef.current,
            });
          } else {
            generic();
          }
        });
    },
    onError: (err, _vars, ctx) => {
      rollbackItem(qc, ctx);
      // Say WHY. This toast threw the error away entirely, so a refused
      // write read as "the app is broken" — reported 2026-09-24 against the
      // Assembly / Operations / Testing pickers, where ARC's own values,
      // array shape and $select all check out against the live column
      // definitions, which leaves the SharePoint permission boundary (the
      // real one — ARC's gating is only UI-level) and nothing on screen
      // naming it.
      errorToast(
        `${describeListWriteFailure(err, {
          action: "save this part",
          site: "Engineering",
          permission: "editing",
        })} Your changes have been reverted.`,
      );
    },
    onSettled: () => invalidateItems(qc),
  });
}

export function useDeleteBuildRequestItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteBuildRequestItem(id),
    onMutate: (id) =>
      snapshotAndPatchItem(qc, id, (items) => items.filter((i) => i.id !== id)),
    onSuccess: () => pushToast({ message: "Part removed." }),
    onError: (_err, _vars, ctx) => {
      rollbackItem(qc, ctx);
      errorToast("Couldn't remove the part — restored.");
    },
    onSettled: () => invalidateItems(qc),
  });
}

export function useSetBuildRequestItemWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setBuildRequestItemWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatchItem(
        qc,
        id,
        patchItem(id, (i) => ({ ...i, watchers: people, modifiedAt: new Date() })),
      ),
    onSuccess: () => pushToast({ message: "Watchers updated." }),
    onError: (_err, _vars, ctx) => {
      rollbackItem(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidateItems(qc),
  });
}

// ---- item comments ---------------------------------------------------------------

export function useAddBuildRequestItemComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addBuildRequestItemComment(id, comment),
    onMutate: async ({ id, comment }) => ({
      ...(await snapshotAndPatchItem(
        qc,
        id,
        patchItem(id, (i) => ({
          ...i,
          comments: [
            {
              timestamp: new Date(),
              authorName: comment.authorName,
              authorEmail: comment.authorEmail,
              bodyHtml: comment.bodyHtml,
              attachments: [],
            },
            ...i.comments,
          ],
          modifiedAt: new Date(),
        })),
      )),
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      autoWatch: beginItemMentionAutoWatch(qc, id, comment.bodyHtml),
    }),
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });

      const items = qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY);
      const item = items?.find((i) => i.id === id);
      if (!item) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: item.watchers,
        // Parts have no Assigned column of their own — the Build Request
        // Items list doesn't carry one, same reason its change alerts pass
        // no assignees. Watchers + mentions are the whole audience here.
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "buildRequestItem", id: item.id, title: item.partNumber },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      // A part comment fans out BOTH ways — onto the linked task AND onto its
      // own build request header — each copy flagged as coming from this part
      // and linking back here to reply (Ray, 2026-09-21).
      void fanOutComment({
        qc,
        source: { kind: "buildRequestItem", id },
        comment,
        alreadyNotified: recipients,
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      rollbackItem(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    // Refetch only once any auto-watch write has landed, so the refetch
    // doesn't read a row without the new watchers and wipe their chips.
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => invalidateItems(qc)),
  });
}

export function useEditBuildRequestItemComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      newBodyHtml,
    }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      newBodyHtml: string;
      renotify?: boolean;
    }) => editBuildRequestItemComment(id, target, newBodyHtml),
    onMutate: async ({ id, target, newBodyHtml }) => ({
      ...(await snapshotAndPatchItem(
        qc,
        id,
        patchItem(id, (i) => ({
          ...i,
          comments: i.comments.map((c) =>
            c.timestamp.getTime() === target.timestamp.getTime() &&
            (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
              ? { ...c, bodyHtml: newBodyHtml }
              : c,
          ),
          modifiedAt: new Date(),
        })),
      )),
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      autoWatch: beginItemMentionAutoWatch(qc, id, newBodyHtml),
    }),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
      ctx?.autoWatch?.commit();
      const prevComment = ctx?.prevItem?.comments.find(
        (c) =>
          c.timestamp.getTime() === target.timestamp.getTime() &&
          (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase(),
      );
      const prevBody = prevComment?.bodyHtml;
      pushToast({ message: "Comment updated." });
      if (!prevComment) return;
      const items = qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY);
      const item = items?.find((i) => i.id === id);
      if (!item) return;
      const sender: Person = { displayName: prevComment.authorName, email: prevComment.authorEmail };
      const targetRef = { kind: "buildRequestItem" as const, id: item.id, title: item.partNumber };

      if (renotify) {
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: item.watchers,
          // No Assigned column on parts — see the comment on posting above.
          assignees: [],
          authorEmail: prevComment.authorEmail,
        });
        if (recipients.length > 0) {
          void notifyMentions({
            recipients,
            sender,
            target: targetRef,
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      } else {
        const prevMentions = new Set(
          prevBody ? extractMentionedRecipients(prevBody).map((r) => r.email.toLowerCase()) : [],
        );
        const newMentions = extractMentionedRecipients(newBodyHtml).filter(
          (r) => !prevMentions.has(r.email.toLowerCase()),
        );
        if (newMentions.length > 0) {
          void notifyMentions({
            recipients: newMentions.map((m) => ({ ...m, reason: "mentioned" as const })),
            sender,
            target: targetRef,
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      rollbackItem(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    // Refetch only once any auto-watch write has landed, so the refetch
    // doesn't read a row without the new watchers and wipe their chips.
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => invalidateItems(qc)),
  });
}

// ---- misc -------------------------------------------------------------------------

// htmlToPlainText now comes from @/lib/htmlText — the "each department keeps
// its own copy" convention let the EIR one drift and ship a bug.
