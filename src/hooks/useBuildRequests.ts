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
import { pushToast } from "@/components/Toast";
import { fireAssigneeChangeAlert, fireFieldChangeAlert, notifyMentions } from "@/api/email";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
  mockLookupIdForEmail,
} from "@/lib/mentions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { resolveCurrentUserLookupId } from "@/api/currentUser";
import { USE_MOCK } from "@/api/config";

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
    next.quotedShipDate = v ? new Date(v as string) : null;
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

export function useUpdateBuildRequestFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateBuildRequestFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatchBr(qc, id, patchBr(id, (b) => applyBrFieldsLocally(b, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: "Changes saved." });
      if ("BRStatus" in fields && ctx?.prevBr) {
        fireFieldChangeAlert({
          target: { kind: "buildRequest", id, title: ctx.prevBr.brNo || ctx.prevBr.title },
          fieldLabel: "status",
          from: ctx.prevBr.status,
          to: String(fields.BRStatus ?? ""),
          actor,
          watchers: ctx.prevBr.watchers,
          assignees: ctx.prevBr.engineerAssigned ? [ctx.prevBr.engineerAssigned] : [],
          reporter: ctx.prevBr.requestor,
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollbackBr(qc, ctx);
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
  return useMutation({
    mutationFn: createBuildRequest,
    onSuccess: (br) => {
      pushToast({ message: `Created ${br.brNo}.` });
      // Seed the cache so navigating straight to the new detail page works
      // without waiting for the background refetch (the createTask lesson).
      qc.setQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY, (old) => (old ? [br, ...old] : [br]));
      invalidateBrs(qc);
    },
    onError: () => errorToast("Couldn't create the build request — please retry."),
  });
}

// ---- auto-watch helpers -------------------------------------------------------

/**
 * Apply auto-watch additions optimistically — watcher chips + toast show
 * immediately, the SharePoint write happens in the background (re-patching
 * the cache after it lands in case a refetch overwrote the optimistic
 * version). On failure: error toast + refetch so the UI doesn't lie.
 */
async function applyBrWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = [...currentWatchers, ...additions];
  const patch = () =>
    qc.setQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY, (old) =>
      old?.map((b) => (b.id === id ? { ...b, watchers: next } : b)),
    );
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this build request.`
        : `${additions.length} people are now watching this build request.`,
  });
  try {
    await setBuildRequestWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    invalidateBrs(qc);
  }
}

/** Same as applyBrWatcherAdditions, for a build request ITEM's watcher list. */
async function applyItemWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = [...currentWatchers, ...additions];
  const patch = () =>
    qc.setQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY, (old) =>
      old?.map((i) => (i.id === id ? { ...i, watchers: next } : i)),
    );
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this part.`
        : `${additions.length} people are now watching this part.`,
  });
  try {
    await setBuildRequestItemWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    invalidateItems(qc);
  }
}

/**
 * Resolve which @-mentioned people should become new watchers. Prefers the
 * directory built from all BR headers + items; cold-start mentions (never a
 * participant before) resolve their lookupId on demand from the Engineering
 * site's User Information List.
 */
async function autoWatchFromMentions({
  recipients,
  currentWatchers,
  directory,
}: {
  recipients: Person[];
  currentWatchers: Person[];
  directory: Person[];
}): Promise<Person[]> {
  const alreadyWatching = new Set(
    currentWatchers.map((w) => (w.email ?? w.displayName).toLowerCase()),
  );
  const byEmail = new Map<string, Person>();
  for (const p of directory) {
    if (p.email && p.lookupId) byEmail.set(p.email.toLowerCase(), p);
  }
  const additions: Person[] = [];
  for (const r of recipients) {
    const key = (r.email ?? r.displayName).toLowerCase();
    if (alreadyWatching.has(key)) continue;
    if (!r.email) continue;
    let resolved = byEmail.get(r.email.toLowerCase());
    if (!resolved) {
      const lookupId = USE_MOCK
        ? mockLookupIdForEmail(r.email)
        : await resolveCurrentUserLookupId(r.email);
      if (!lookupId) continue;
      resolved = { displayName: r.displayName, email: r.email, lookupId };
    }
    additions.push(resolved);
    alreadyWatching.add(key);
  }
  return additions;
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
    onMutate: ({ id, comment }) =>
      snapshotAndPatchBr(
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
      ),
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const brs = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY);
      const br = brs?.find((b) => b.id === id);
      if (!br) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: br.watchers,
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

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      const items = qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY);
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: br.watchers,
        directory: collectBuildRequestPeople(brs, items),
      })
        .then((additions) => applyBrWatcherAdditions(qc, id, br.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for build request comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollbackBr(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => invalidateBrs(qc),
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
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatchBr(
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
      ),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
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

      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      const items = qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY);
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: br.watchers,
        directory: collectBuildRequestPeople(brs, items),
      })
        .then((additions) => applyBrWatcherAdditions(qc, id, br.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for edited build request comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollbackBr(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: () => invalidateBrs(qc),
  });
}

// ---- item mutations -------------------------------------------------------------

export function useCreateBuildRequestItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBuildRequestItem,
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
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateBuildRequestItemFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatchItem(qc, id, patchItem(id, (i) => applyItemFieldsLocally(i, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: "Part updated." });
      if ("Part_x0020_Status" in fields && ctx?.prevItem) {
        fireFieldChangeAlert({
          target: { kind: "buildRequestItem", id, title: ctx.prevItem.partNumber },
          fieldLabel: "part status",
          from: ctx.prevItem.partStatus ?? "Not set",
          to: String(fields.Part_x0020_Status ?? "Not set"),
          actor,
          watchers: ctx.prevItem.watchers,
          assignees: [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollbackItem(qc, ctx);
      errorToast("Couldn't save the part — changes reverted.");
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
    onMutate: ({ id, comment }) =>
      snapshotAndPatchItem(
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
      ),
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const items = qc.getQueryData<BuildRequestItem[]>(BUILD_REQUEST_ITEMS_KEY);
      const item = items?.find((i) => i.id === id);
      if (!item) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: item.watchers,
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

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      const brs = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY);
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: item.watchers,
        directory: collectBuildRequestPeople(brs, items),
      })
        .then((additions) => applyItemWatcherAdditions(qc, id, item.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for build request item comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollbackItem(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => invalidateItems(qc),
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
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatchItem(
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
      ),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
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

      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      const brs = qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY);
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: item.watchers,
        directory: collectBuildRequestPeople(brs, items),
      })
        .then((additions) => applyItemWatcherAdditions(qc, id, item.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for edited build request item comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollbackItem(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: () => invalidateItems(qc),
  });
}

// ---- misc -------------------------------------------------------------------------

/**
 * Strip HTML down to readable plain text for the email excerpt — same local
 * copy convention as useEirs / useOperationsTasks (each department keeps its
 * own rather than sharing a lib for this two-liner).
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
