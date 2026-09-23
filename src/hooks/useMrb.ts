import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addMrbComment,
  createMrbEntry,
  editMrbComment,
  listMrbEntries,
  setMrbWatchers,
  updateMrbEntry,
} from "@/api/mrb";
import type { MrbEntry, MrbEntryInput, Person } from "@/types/task";
import { mrbLabel } from "@/lib/mrbMapper";
import { commentNotifyRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { notifyMentions } from "@/api/email";
import { autoWatchFromMentions } from "@/api/autoWatch";
// MRB lives on the PMO site, so cold-start mentions resolve there.
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import { autoWatchers, mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { pushToast } from "@/components/Toast";

// =============================================================================
// MRB hooks.
//
// No admin or role gate: any signed-in user can add an entry, record a
// disposition and comment. SharePoint's own list permissions remain the real
// boundary.
//
// **An edit needs the row it started from.** `updateMrbEntry` diffs against
// it, and that diff is what keeps the 734 rows holding an undeclared choice
// value editable at all — see `buildMrbFields`. The hook reads the previous
// row out of the cache so no caller has to remember.
//
// The comment thread is the standard one: post → optimistic insert → email
// every watcher and @-mentioned person → add the mentioned as watchers.
// **There is no assignee on this list**, so `commentNotifyRecipients` gets an
// empty `assignees` — watchers and mentions are the whole audience. The
// Watchers column may not exist yet (see api/mrb.ts), in which case the
// watcher half simply has nothing to work with and comments still post.
// =============================================================================

export const MRB_KEY = ["mrbEntries"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useMrbEntries() {
  return useQuery({
    queryKey: MRB_KEY,
    queryFn: listMrbEntries,
    staleTime: 60_000,
  });
}

/** One entry out of the cached list. */
export function useMrbEntry(id: number | null) {
  const { data: entries = [], ...rest } = useMrbEntries();
  return {
    ...rest,
    data: id === null ? undefined : entries.find((e) => e.id === id),
  };
}

function patchEntry(qc: QueryClient, id: number, update: (e: MrbEntry) => MrbEntry) {
  qc.setQueryData<MrbEntry[]>(MRB_KEY, (old) =>
    old?.map((e) => (e.id === id ? update(e) : e)),
  );
}

export function useCreateMrbEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MrbEntryInput) => createMrbEntry(input),
    onSuccess: (created) => {
      // Seeded into the cache, not just invalidated: the form navigates to
      // the new entry the instant this resolves, and an invalidate alone only
      // SCHEDULES a refetch — so the detail page would land on a stale list
      // and flash "not found" until it caught up.
      qc.setQueryData<MrbEntry[]>(MRB_KEY, (old) => (old ? [created, ...old] : [created]));
      qc.invalidateQueries({ queryKey: MRB_KEY });
      pushToast({ message: `Logged MRB entry ${mrbLabel(created)}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't log the entry: ${err.message}`),
  });
}

export function useUpdateMrbEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: MrbEntryInput }) => {
      const entries = qc.getQueryData<MrbEntry[]>(MRB_KEY) ?? [];
      const previous = entries.find((e) => e.id === id);
      if (!previous) {
        // Without the row we started from there is nothing to diff against,
        // and sending every column would be refused on any row holding an
        // undeclared choice value. Refuse rather than write blind.
        throw new Error(
          "The entry isn't loaded yet — reopen it and try again.",
        );
      }
      return updateMrbEntry(id, input, previous);
    },
    onSuccess: (updated) => {
      patchEntry(qc, updated.id, () => updated);
      qc.invalidateQueries({ queryKey: MRB_KEY });
      pushToast({ message: `Saved ${mrbLabel(updated)}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't save changes: ${err.message}`),
  });
}

/** Everyone already on an entry — the @-mention picker's starting point. */
export function collectMrbPeople(entries: MrbEntry[]): Person[] {
  return mergePeople(...entries.map((e) => e.watchers));
}

export function useSetMrbWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setMrbWatchers(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: MRB_KEY });
      const previous = qc.getQueryData<MrbEntry[]>(MRB_KEY);
      patchEntry(qc, id, (e) => ({ ...e, watchers: people }));
      return { previous };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MRB_KEY, ctx.previous);
      errorToast(`Couldn't update the watchers — reverted. ${err.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MRB_KEY }),
  });
}

export function useAddMrbComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addMrbComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: MRB_KEY });
      const previous = qc.getQueryData<MrbEntry[]>(MRB_KEY);
      patchEntry(qc, id, (e) => ({
        ...e,
        comments: [
          {
            timestamp: new Date(),
            authorName: comment.authorName,
            authorEmail: comment.authorEmail,
            bodyHtml: comment.bodyHtml,
            attachments: [],
          },
          ...e.comments,
        ],
        modifiedAt: new Date(),
      }));
      return { previous };
    },
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const entries = qc.getQueryData<MrbEntry[]>(MRB_KEY);
      const entry = entries?.find((e) => e.id === id);
      if (!entry) return;

      const sender: Person = {
        displayName: comment.authorName,
        email: comment.authorEmail,
      };
      // Watchers + whoever was mentioned, minus the author. There is no
      // assignee column on this list, so `assignees` is empty rather than
      // standing something else in — an MRB entry is owned by the board,
      // not by one person.
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: entry.watchers,
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "mrb", id: entry.id, title: mrbLabel(entry) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: entry.watchers,
        directory: entries ? collectMrbPeople(entries) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, entry.watchers, additions))
        .catch((err: unknown) => {
          console.error("Auto-watch failed for an MRB comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MRB_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MRB_KEY }),
  });
}

export function useEditMrbComment() {
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
    }) => editMrbComment(id, target, bodyHtml),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }) => {
      pushToast({ message: "Comment updated." });

      const entries = qc.getQueryData<MrbEntry[]>(MRB_KEY);
      const entry = entries?.find((e) => e.id === id);
      if (!entry) return;

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
        target: { kind: "mrb", id: entry.id, title: mrbLabel(entry) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: added,
        currentWatchers: entry.watchers,
        directory: entries ? collectMrbPeople(entries) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, entry.watchers, additions))
        .catch((err: unknown) => {
          console.error("Auto-watch failed for an MRB comment edit:", err);
        });
    },
    onError: () => errorToast("Couldn't update the comment — please retry."),
    onSettled: () => qc.invalidateQueries({ queryKey: MRB_KEY }),
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
  const patch = () => patchEntry(qc, id, (e) => ({ ...e, watchers: next }));
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this MRB entry.`
        : `${additions.length} people are now watching this MRB entry.`,
  });
  try {
    await setMrbWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    qc.invalidateQueries({ queryKey: MRB_KEY });
  }
}
