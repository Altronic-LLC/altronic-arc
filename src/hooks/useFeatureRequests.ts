import { useRef } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addFeatureRequestComment,
  collectFeatureRequestPeople,
  createFeatureRequest,
  editFeatureRequestComment,
  listFeatureRequests,
  resolveFeatureRequestSiteUserLookupId,
  setFeatureRequestWatchers,
  updateFeatureRequestFields,
} from "@/api/featureRequests";
import {
  afterMentionAutoWatch,
  beginMentionAutoWatch,
  type MentionAutoWatch,
} from "./mentionAutoWatch";
import type { FeatureRequest, FeatureRequestInput, Person } from "@/types/task";
import { pushToast } from "@/components/Toast";
import {
  fireFeatureRequestStatusAlert,
  fireFieldChangeAlert,
  fireNewFeatureRequestAlert,
  notifyMentions,
} from "@/api/email";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
} from "@/lib/mentions";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// =============================================================================
// ARC Feature Requests hooks — mirrors usePanelTasks.ts's optimistic-update
// infra, forked for FeatureRequest's own query key. No admin gate anywhere:
// any signed-in user can create, comment, and change status/priority/target
// version. See src/api/featureRequests.ts for the underlying calls.
// =============================================================================

export const FEATURE_REQUESTS_KEY = ["featureRequests", "list"] as const;

export function useFeatureRequests() {
  return useQuery({
    queryKey: FEATURE_REQUESTS_KEY,
    queryFn: listFeatureRequests,
    staleTime: 60_000,
  });
}

export function useFeatureRequest(id: number | null) {
  const list = useFeatureRequests();
  return {
    ...list,
    data: id !== null ? list.data?.find((r) => r.id === id) ?? null : null,
  };
}

type FeatureRequestCtx = { previous?: FeatureRequest[]; prevRequest?: FeatureRequest };

async function snapshotAndPatch(
  qc: QueryClient,
  prevId: number | null,
  patch: (requests: FeatureRequest[]) => FeatureRequest[],
): Promise<FeatureRequestCtx> {
  await qc.cancelQueries({ queryKey: FEATURE_REQUESTS_KEY });
  const previous = qc.getQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY);
  const prevRequest = prevId != null ? previous?.find((r) => r.id === prevId) : undefined;
  qc.setQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevRequest };
}

function rollback(qc: QueryClient, ctx: FeatureRequestCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(FEATURE_REQUESTS_KEY, ctx.previous);
}

/**
 * Refetch the list. Comment mutations don't call this until any auto-watch
 * write has landed (`afterMentionAutoWatch`), so the refetch can't read a row
 * that predates the new watchers — "watchers aren't sticking" (Ray,
 * 2026-09-02) was exactly that race.
 */
export function invalidateFeatureRequests(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: FEATURE_REQUESTS_KEY });
}

function patchFeatureRequest(id: number, transform: (r: FeatureRequest) => FeatureRequest) {
  return (requests: FeatureRequest[]) => requests.map((r) => (r.id === id ? transform(r) : r));
}

function buildUndo(
  qc: QueryClient,
  snapshot: FeatureRequest[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY, snapshot);
    serverRevert().catch((err) => {
      console.error("Undo failed:", err);
      pushToast({ message: "Couldn't undo on SharePoint. Refreshing the list.", variant: "error" });
      qc.invalidateQueries({ queryKey: FEATURE_REQUESTS_KEY });
    });
  };
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

function messageForFieldsUpdate(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).filter((k) => !k.endsWith("@odata.type"));
  if (keys.length === 1) {
    switch (keys[0]) {
      case "Status":
        return "Status updated.";
      case "Priority":
        return "Priority updated.";
      case "TargetVersion":
        return "Target version updated.";
      case "Department":
        return "Department updated.";
      default:
        return "Feature request updated.";
    }
  }
  return "Feature request updated.";
}

function applyFieldsLocally(
  r: FeatureRequest,
  fields: Record<string, unknown>,
): FeatureRequest {
  const next = { ...r };
  if ("Title" in fields) next.title = (fields.Title as string) ?? "";
  if ("Description" in fields) next.description = (fields.Description as string) ?? "";
  if ("Department" in fields) {
    next.department = (fields.Department as FeatureRequest["department"]) ?? null;
  }
  if ("Priority" in fields) next.priority = (fields.Priority as FeatureRequest["priority"]) ?? null;
  if ("Status" in fields) next.status = fields.Status as FeatureRequest["status"];
  if ("TargetVersion" in fields) next.targetVersion = (fields.TargetVersion as string) ?? "";
  next.modifiedAt = new Date();
  return next;
}

// =============================================================================
// Mutations
// =============================================================================

export function useUpdateFeatureRequestFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  // Read through a ref inside onSuccess: the identity hook re-resolves (its
  // lookupId arrives async), and the callback should use whoever is signed in
  // now rather than closing over a stale first render.
  const actorRef = useRef(actor);
  actorRef.current = actor;
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateFeatureRequestFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchFeatureRequest(id, (r) => applyFieldsLocally(r, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: messageForFieldsUpdate(fields) });

      // A genuine status MOVE tells the intake list. `"Status" in fields` is
      // PRESENCE, not change — the sidebar re-sends whatever it holds, so
      // re-saving an unchanged status must not re-announce it. `ctx` carries
      // the pre-write row (captured in onMutate, before the optimistic
      // patch), which is the only place the previous value still exists.
      if (!("Status" in fields)) return;
      const from = ctx?.prevRequest?.status ?? "";
      const to = String(fields.Status ?? "");
      if (!to || to === from) return;

      const request = qc
        .getQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY)
        ?.find((r) => r.id === id);
      if (!request) return;

      const target = { kind: "featureRequest" as const, id, title: request.title };

      // The generic note — WATCHERS plus the requester. This is what tells the
      // person who suggested the feature that their own request moved: they
      // auto-watch it on create (`autoWatchers` in api/featureRequests.ts).
      // Kept alongside the intake alert below, which goes only to the people
      // working the queue — suppressing this would stop the requester hearing
      // about their own request, the same reasoning as EIR's status alerts.
      fireFieldChangeAlert({
        target,
        fieldLabel: "status",
        from,
        to,
        actor: actorRef.current,
        watchers: request.watchers,
        assignees: request.requestedBy ? [request.requestedBy] : [],
      });

      // And the intake queue, who track the list itself.
      fireFeatureRequestStatusAlert({
        target,
        actor: actorRef.current,
        from,
        to,
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save changes — they have been reverted.");
    },
    onSettled: () => invalidateFeatureRequests(qc),
  });
}

export function useSetFeatureRequestWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setFeatureRequestWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(
        qc,
        id,
        patchFeatureRequest(id, (r) => ({ ...r, watchers: people, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevRequest?.watchers ?? [];
      pushToast({
        message: "Watchers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setFeatureRequestWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidateFeatureRequests(qc),
  });
}

export function useAddFeatureRequestComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addFeatureRequestComment(id, comment),
    onMutate: async ({ id, comment }) => ({
      ...(await snapshotAndPatch(
        qc,
        id,
        patchFeatureRequest(id, (r) => ({
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
        })),
      )),
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      autoWatch: beginFeatureRequestMentionAutoWatch(qc, id, comment.bodyHtml),
    }),
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });

      const requests = qc.getQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY);
      const request = requests?.find((r) => r.id === id);
      if (!request) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: request.watchers,
        assignees: request.requestedBy ? [request.requestedBy] : [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "featureRequest", id: request.id, title: request.title },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      rollback(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => invalidateFeatureRequests(qc)),
  });
}

/**
 * Start auto-watch for a feature request comment: the mentioned people appear
 * as watchers immediately and are written once the comment lands.
 */
function beginFeatureRequestMentionAutoWatch(
  qc: QueryClient,
  id: number,
  bodyHtml: string,
): MentionAutoWatch | null {
  const request = qc
    .getQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY)
    ?.find((r) => r.id === id);
  if (!request) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: request.watchers,
    directory: () =>
      collectFeatureRequestPeople(qc.getQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY) ?? []),
    resolveLookupId: resolveFeatureRequestSiteUserLookupId,
    patch: (watchers) =>
      qc.setQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY, (old) =>
        old?.map((r) => (r.id === id ? { ...r, watchers } : r)),
      ),
    write: (watchers) => setFeatureRequestWatchers(id, watchers),
    onWriteFailed: () => invalidateFeatureRequests(qc),
    noun: "request",
  });
}

export function useEditFeatureRequestComment() {
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
    }) => editFeatureRequestComment(id, target, newBodyHtml),
    onMutate: async ({ id, target, newBodyHtml }) => ({
      ...(await snapshotAndPatch(
        qc,
        id,
        patchFeatureRequest(id, (r) => ({
          ...r,
          comments: r.comments.map((c) =>
            c.timestamp.getTime() === target.timestamp.getTime() &&
            (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
              ? { ...c, bodyHtml: newBodyHtml }
              : c,
          ),
          modifiedAt: new Date(),
        })),
      )),
      // Anyone @-mentioned in the edited body becomes a watcher (unless
      // already watching) — same rule, and same timing, as a new comment.
      autoWatch: beginFeatureRequestMentionAutoWatch(qc, id, newBodyHtml),
    }),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
      ctx?.autoWatch?.commit();
      const prevComment = ctx?.prevRequest?.comments.find(
        (c) =>
          c.timestamp.getTime() === target.timestamp.getTime() &&
          (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase(),
      );
      const prevBody = prevComment?.bodyHtml;
      pushToast({
        message: "Comment updated.",
        undo:
          prevBody !== undefined
            ? buildUndo(qc, ctx?.previous, () => editFeatureRequestComment(id, target, prevBody))
            : undefined,
      });
      if (!prevComment) return;
      const request = qc.getQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY)?.find((r) => r.id === id);
      if (!request) return;
      const sender: Person = { displayName: prevComment.authorName, email: prevComment.authorEmail };
      const targetRef = { kind: "featureRequest" as const, id: request.id, title: request.title };

      if (renotify) {
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: request.watchers,
          assignees: request.requestedBy ? [request.requestedBy] : [],
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
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => invalidateFeatureRequests(qc)),
  });
}

export function useCreateFeatureRequest() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: (input: FeatureRequestInput) => createFeatureRequest(input, actor),
    onSuccess: (request) => {
      pushToast({ message: `Feature request "${request.title}" submitted.` });
      qc.setQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY, (old) =>
        old ? [request, ...old] : [request],
      );
      invalidateFeatureRequests(qc);

      // Nothing watches this list, so a suggestion used to sit until somebody
      // opened the screen — the same gap the Gray Market / FAIT / Cost Impact
      // intake alerts each closed (Ray, 2026-09-16).
      fireNewFeatureRequestAlert({
        target: { kind: "featureRequest", id: request.id, title: request.title },
        actor,
        details: [
          { label: "Department", value: request.department ?? "" },
          { label: "Priority", value: request.priority ?? "" },
          { label: "Description", value: request.description },
        ],
      });
    },
    onError: () => errorToast("Couldn't submit the feature request — please retry."),
  });
}
