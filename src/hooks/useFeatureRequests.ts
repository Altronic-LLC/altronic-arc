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
import { autoWatchFromMentions } from "@/api/autoWatch";
import type { FeatureRequest, FeatureRequestInput, Person } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { notifyMentions } from "@/api/email";
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

function invalidateFeatureRequests(qc: QueryClient) {
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
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateFeatureRequestFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchFeatureRequest(id, (r) => applyFieldsLocally(r, fields))),
    onSuccess: (_data, { fields }) => {
      pushToast({ message: messageForFieldsUpdate(fields) });
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
    onMutate: ({ id, comment }) =>
      snapshotAndPatch(
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
      ),
    onSuccess: (_data, { id, comment }) => {
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

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolveFeatureRequestSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: request.watchers,
        directory: requests ? collectFeatureRequestPeople(requests) : [],
      })
        .then((additions) => applyFeatureRequestWatcherAdditions(qc, id, request.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for feature request comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => invalidateFeatureRequests(qc),
  });
}

async function applyFeatureRequestWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = [...currentWatchers, ...additions];
  const patch = () =>
    qc.setQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY, (old) =>
      old?.map((r) => (r.id === id ? { ...r, watchers: next } : r)),
    );
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this request.`
        : `${additions.length} people are now watching this request.`,
  });
  try {
    await setFeatureRequestWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    invalidateFeatureRequests(qc);
  }
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
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatch(
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
      ),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
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

      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      const allRequests = qc.getQueryData<FeatureRequest[]>(FEATURE_REQUESTS_KEY);
      void autoWatchFromMentions({
        resolveLookupId: resolveFeatureRequestSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: request.watchers,
        directory: allRequests ? collectFeatureRequestPeople(allRequests) : [],
      })
        .then((additions) =>
          applyFeatureRequestWatcherAdditions(qc, id, request.watchers, additions),
        )
        .catch((err) => {
          console.error("Auto-watch failed for edited feature request comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: () => invalidateFeatureRequests(qc),
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
    },
    onError: () => errorToast("Couldn't submit the feature request — please retry."),
  });
}
