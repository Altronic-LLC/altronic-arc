import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPanelQcIssueComment,
  createPanelQcDefect,
  createPanelQcIssue,
  editPanelQcIssueComment,
  listPanelQcDefects,
  listPanelQcIssues,
  listPanelQcRepairDefectChoices,
  listPanelQcStatusChoices,
  setPanelQcIssueWatchers,
  unwatchPanelQcIssue,
  updatePanelQcIssue,
  watchPanelQcIssue,
} from "@/api/panelQcIssues";
import { autoWatchFromMentions } from "@/api/autoWatch";
import { resolvePanelSiteUserLookupId } from "@/api/panelOrders";
import { notifyMentions } from "@/api/email";
import { commentNotifyRecipients, commentRenotifyRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { htmlToPlainText } from "@/lib/htmlText";
import { autoWatchers } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { PanelQcDefect, PanelQcIssue, PanelQcIssueInput, Person } from "@/types/task";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Panel QC Issue Tracker hooks. Mirrors usePanelTasks.ts's Communication +
// Watchers wiring (same ALTRONICPANELTEAM site, same
// resolvePanelSiteUserLookupId resolver for cold-start @-mentions) — see that
// file's header for why the resolver is per-site.
// =============================================================================

export const PANEL_QC_ISSUES_KEY = ["panelQcIssues"] as const;
export const PANEL_QC_DEFECTS_KEY = ["panelQcDefects"] as const;
export const PANEL_QC_STATUS_CHOICES_KEY = ["panelQcStatusChoices"] as const;
export const PANEL_QC_REPAIR_DEFECT_CHOICES_KEY = ["panelQcRepairDefectChoices"] as const;

export function usePanelQcIssues() { return useQuery({ queryKey: PANEL_QC_ISSUES_KEY, queryFn: listPanelQcIssues, staleTime: 2 * 60_000 }); }
export function usePanelQcDefects() { return useQuery({ queryKey: PANEL_QC_DEFECTS_KEY, queryFn: listPanelQcDefects, staleTime: 5 * 60_000 }); }
// Both choice lists come straight off SharePoint's own column config — see
// listPanelQcStatusChoices / listPanelQcRepairDefectChoices — so they rarely
// change; a long staleTime avoids re-fetching column metadata on every open.
export function usePanelQcStatusChoices() { return useQuery({ queryKey: PANEL_QC_STATUS_CHOICES_KEY, queryFn: listPanelQcStatusChoices, staleTime: 30 * 60_000 }); }
export function usePanelQcRepairDefectChoices() { return useQuery({ queryKey: PANEL_QC_REPAIR_DEFECT_CHOICES_KEY, queryFn: listPanelQcRepairDefectChoices, staleTime: 30 * 60_000 }); }

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

function invalidateIssues(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: PANEL_QC_ISSUES_KEY });
}

function patchIssue(qc: QueryClient, id: number, transform: (issue: PanelQcIssue) => PanelQcIssue) {
  qc.setQueryData<PanelQcIssue[]>(PANEL_QC_ISSUES_KEY, (old) => old?.map((item) => (item.id === id ? transform(item) : item)));
}

/** Flatten every watcher across the issue list, deduped by email/displayName — the
 * directory an @-mention's cold-start resolution checks before it falls back
 * to a live site-user lookup. */
function collectPeopleFromPanelQcIssues(issues: PanelQcIssue[]): Person[] {
  const map = new Map<string, Person>();
  for (const issue of issues) {
    for (const p of issue.watchers) {
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(key) && p.lookupId) map.set(key, p);
    }
  }
  return [...map.values()];
}

export function useCreatePanelQcIssue() {
  const queryClient = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    // The creator watches their own issue — lib/people.ts autoWatchers().
    mutationFn: (input: PanelQcIssueInput) => createPanelQcIssue({ ...input, watchers: autoWatchers(input.watchers, null, actor) }),
    onSuccess: (created) => {
      queryClient.setQueryData<PanelQcIssue[]>(PANEL_QC_ISSUES_KEY, (old) => (old ? [created, ...old] : [created]));
      invalidateIssues(queryClient);
      pushToast({ message: "Panel QC issue added." });
    },
    onError: (error: Error) => errorToast(`Couldn't add the issue: ${error.message}`),
  });
}

export function useUpdatePanelQcIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: PanelQcIssueInput }) => updatePanelQcIssue(id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData<PanelQcIssue[]>(PANEL_QC_ISSUES_KEY, (old) => old?.map((item) => (item.id === updated.id ? updated : item)));
      invalidateIssues(queryClient);
      pushToast({ message: "Panel QC issue saved." });
    },
    onError: (error: Error) => errorToast(`Couldn't save the issue: ${error.message}`),
  });
}

export function useCreatePanelQcDefect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPanelQcDefect,
    onSuccess: (created) => {
      queryClient.setQueryData<PanelQcDefect[]>(PANEL_QC_DEFECTS_KEY, (old) => (old ? [...old, created].sort((a, b) => a.name.localeCompare(b.name)) : [created]));
      invalidateIssues(queryClient);
      pushToast({ message: `Added defect category "${created.name}".` });
    },
    onError: (error: Error) => errorToast(`Couldn't add the defect category: ${error.message}`),
  });
}

export function useSetPanelQcIssueWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setPanelQcIssueWatchers(id, people),
    onMutate: ({ id, people }) => patchIssue(qc, id, (issue) => ({ ...issue, watchers: people })),
    onSuccess: () => pushToast({ message: "Watchers updated." }),
    onError: () => { invalidateIssues(qc); errorToast("Couldn't update watchers — refreshing."); },
    onSettled: () => invalidateIssues(qc),
  });
}

export function useWatchPanelQcIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => watchPanelQcIssue(id, person),
    onMutate: ({ id, person }) =>
      patchIssue(qc, id, (issue) => {
        const key = (person.email ?? person.displayName).toLowerCase();
        const has = issue.watchers.some((p) => (p.email ?? p.displayName).toLowerCase() === key);
        return has ? issue : { ...issue, watchers: [...issue.watchers, person] };
      }),
    onSuccess: () => pushToast({ message: "You're now watching this issue." }),
    onError: () => { invalidateIssues(qc); errorToast("Couldn't start watching — refreshing."); },
    onSettled: () => invalidateIssues(qc),
  });
}

export function useUnwatchPanelQcIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => unwatchPanelQcIssue(id, person),
    onMutate: ({ id, person }) =>
      patchIssue(qc, id, (issue) => {
        const key = (person.email ?? person.displayName).toLowerCase();
        return { ...issue, watchers: issue.watchers.filter((p) => (p.email ?? p.displayName).toLowerCase() !== key) };
      }),
    onSuccess: () => pushToast({ message: "Stopped watching." }),
    onError: () => { invalidateIssues(qc); errorToast("Couldn't stop watching — refreshing."); },
    onSettled: () => invalidateIssues(qc),
  });
}

/**
 * Apply auto-watch additions optimistically, then persist. On failure:
 * error toast + refetch, mirroring usePanelTasks.ts's identical helper.
 */
async function applyPanelQcIssueWatcherAdditions(qc: QueryClient, id: number, currentWatchers: Person[], additions: Person[]): Promise<void> {
  if (additions.length === 0) return;
  const next = [...currentWatchers, ...additions];
  patchIssue(qc, id, (issue) => ({ ...issue, watchers: next }));
  pushToast({
    message: additions.length === 1
      ? `${additions[0].displayName} is now watching this issue.`
      : `${additions.length} people are now watching this issue.`,
  });
  try {
    await setPanelQcIssueWatchers(id, next);
    invalidateIssues(qc);
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    invalidateIssues(qc);
  }
}

export function useAddPanelQcIssueComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: number; comment: { authorName: string; authorEmail: string; bodyHtml: string } }) =>
      addPanelQcIssueComment(id, comment),
    onMutate: ({ id, comment }) =>
      patchIssue(qc, id, (issue) => ({
        ...issue,
        comments: [
          { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
          ...issue.comments,
        ],
      })),
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const issues = qc.getQueryData<PanelQcIssue[]>(PANEL_QC_ISSUES_KEY);
      const issue = issues?.find((item) => item.id === id);
      if (!issue) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: issue.watchers,
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "panelQcIssue", id: issue.id, title: issueTitle(issue) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolvePanelSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: issue.watchers,
        directory: issues ? collectPeopleFromPanelQcIssues(issues) : [],
      })
        .then((additions) => applyPanelQcIssueWatcherAdditions(qc, id, issue.watchers, additions))
        .catch((err) => console.error("Auto-watch failed for panel QC issue comment:", err));
    },
    onError: () => { invalidateIssues(qc); errorToast("Couldn't post comment — refreshing."); },
    onSettled: () => invalidateIssues(qc),
  });
}

export function useEditPanelQcIssueComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target, newBodyHtml }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      newBodyHtml: string;
      /** Author opted in to "Notify everyone again" — see onSuccess below. */
      renotify?: boolean;
    }) => editPanelQcIssueComment(id, target, newBodyHtml),
    onMutate: ({ id, target, newBodyHtml }) =>
      patchIssue(qc, id, (issue) => ({
        ...issue,
        comments: issue.comments.map((c) =>
          c.timestamp.getTime() === target.timestamp.getTime() && (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
            ? { ...c, bodyHtml: newBodyHtml }
            : c,
        ),
      })),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }) => {
      pushToast({ message: "Comment updated." });

      const issues = qc.getQueryData<PanelQcIssue[]>(PANEL_QC_ISSUES_KEY);
      const issue = issues?.find((item) => item.id === id);
      if (!issue) return;
      const prevComment = issue.comments.find(
        (c) => c.timestamp.getTime() === target.timestamp.getTime() && (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase(),
      );
      const prevBody = prevComment?.bodyHtml;
      const sender: Person = { displayName: prevComment?.authorName ?? "", email: target.authorEmail };
      const targetRef = { kind: "panelQcIssue" as const, id: issue.id, title: issueTitle(issue) };

      if (renotify) {
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: issue.watchers,
          assignees: [],
          authorEmail: target.authorEmail,
        });
        if (recipients.length > 0) {
          void notifyMentions({ recipients, sender, target: targetRef, commentExcerpt: htmlToPlainText(newBodyHtml), attachments: [] });
        }
      } else {
        const prevMentions = new Set(prevBody ? extractMentionedRecipients(prevBody).map((r) => r.email.toLowerCase()) : []);
        const newMentions = extractMentionedRecipients(newBodyHtml).filter((r) => !prevMentions.has(r.email.toLowerCase()));
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
      void autoWatchFromMentions({
        resolveLookupId: resolvePanelSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: issue.watchers,
        directory: issues ? collectPeopleFromPanelQcIssues(issues) : [],
      })
        .then((additions) => applyPanelQcIssueWatcherAdditions(qc, id, issue.watchers, additions))
        .catch((err) => console.error("Auto-watch failed for edited panel QC issue comment:", err));
    },
    onError: () => { invalidateIssues(qc); errorToast("Couldn't save comment — refreshing."); },
    onSettled: () => invalidateIssues(qc),
  });
}

function issueTitle(issue: PanelQcIssue): string {
  return issue.tagNumber || issue.panelSerialNumber || `Panel QC issue #${issue.id}`;
}
