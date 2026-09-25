import { autoWatchFromMentions } from "@/api/autoWatch";
import { pushToast } from "@/components/Toast";
import { extractMentionedRecipients } from "@/lib/mentions";
import type { Person } from "@/types/task";

// =============================================================================
// Mention → watcher, from the moment Post is pressed.
//
// Auto-watch used to start in the comment mutation's onSuccess: the comment
// had to finish its SharePoint round trip (read Communication, PATCH it,
// re-read the row) before the mentioned person's lookupId was even looked up,
// and only then did their chip appear. On top of that, the comment's own
// onSettled refetch — in flight before the Watchers write had landed — came
// back without them and wiped the chip until the write's re-patch put it
// back. Reported as "mentioned people take too long to become watchers"
// (Ray, 2026-09-25).
//
// So the work is split across the mutation's lifecycle:
//
//   onMutate  → `beginMentionAutoWatch`: the chips + toast appear NOW. No
//               lookupId is needed to DISPLAY a person, only to write one.
//   onSuccess → `commit()`: resolve lookupIds and write Watchers. Only after
//               the comment has landed — a failed comment must not leave a
//               subscription behind it.
//   onError   → `cancel()`: nothing is written. The caller's snapshot
//               rollback removes the optimistic chips along with the comment.
//   onSettled → wait on `settled` before refetching, so the refetch reads a
//               row that already holds the new watchers.
//
// One copy, shared by every comment thread, for the reason api/autoWatch.ts
// gives: seventeen hand-rolled copies is how a fix reaches only one of them.
// =============================================================================

export interface MentionAutoWatch {
  /** The comment landed: resolve lookupIds and write the watchers. */
  commit(): void;
  /** The comment failed: write nothing. */
  cancel(): void;
  /** Resolves once the watcher write has finished, failed, or been cancelled. Never rejects. */
  settled: Promise<void>;
}

export interface BeginMentionAutoWatchArgs {
  bodyHtml: string;
  /** The item's watchers BEFORE this comment. */
  currentWatchers: Person[];
  /** People already known to the app, for lookupIds without a network call. Read at commit time. */
  directory: () => Person[];
  /** Resolve an email to a lookupId ON THE SITE THIS ITEM LIVES ON — see api/autoWatch.ts. */
  resolveLookupId: (email: string) => Promise<number>;
  /** Put this watcher list into the cache for the item. Called optimistically and again after the write. */
  patch: (watchers: Person[]) => void;
  /** Write this watcher list to SharePoint. */
  write: (watchers: Person[]) => Promise<unknown>;
  /** The write failed: refetch so the screen stops showing watchers SharePoint doesn't hold. */
  onWriteFailed: () => void;
  /** What the item is called in the toast — "task", "EIR", "request". */
  noun: string;
}

function key(p: { email?: string | null; displayName: string }): string {
  return (p.email ?? p.displayName).toLowerCase();
}

/**
 * Show every newly @-mentioned person as a watcher immediately, and return a
 * handle that writes them once the comment lands. Returns `null` when the
 * comment mentions nobody who isn't already watching.
 */
export function beginMentionAutoWatch(args: BeginMentionAutoWatchArgs): MentionAutoWatch | null {
  const watching = new Set(args.currentWatchers.map(key));
  const mentioned = extractMentionedRecipients(args.bodyHtml).filter((r) => {
    const k = key(r);
    if (watching.has(k)) return false;
    watching.add(k);
    return true;
  });
  if (mentioned.length === 0) return null;

  // Display-only Persons: no lookupId yet, which is fine for a chip.
  args.patch([
    ...args.currentWatchers,
    ...mentioned.map((m) => ({ displayName: m.displayName, email: m.email })),
  ]);
  pushToast({
    message:
      mentioned.length === 1
        ? `${mentioned[0].displayName} is now watching this ${args.noun}.`
        : `${mentioned.length} people are now watching this ${args.noun}.`,
  });

  let finish!: () => void;
  const settled = new Promise<void>((resolve) => (finish = resolve));
  let state: "pending" | "committed" | "cancelled" = "pending";

  const run = async () => {
    try {
      const additions = await autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: args.currentWatchers,
        directory: args.directory(),
        resolveLookupId: args.resolveLookupId,
      });
      const next = [...args.currentWatchers, ...additions];
      const added = new Set(additions.map(key));
      const dropped = mentioned.filter((m) => !added.has(key(m)));
      if (dropped.length > 0) {
        // Shown optimistically, but there is no SharePoint user to write.
        // Take the chip back and SAY so — silently dropping them is how a
        // mention that subscribes nobody went unnoticed before.
        args.patch(next);
        pushToast({
          message: `Couldn't add ${dropped.map((d) => d.displayName).join(", ")} as a watcher — no SharePoint account was found.`,
          variant: "error",
        });
      }
      if (additions.length === 0) return;
      await args.write(next);
      args.patch(next);
    } catch (err) {
      console.error(`Auto-watch failed for a ${args.noun} comment:`, err);
      pushToast({
        message: "Couldn't add the mentioned person as a watcher — refreshing.",
        variant: "error",
      });
      args.onWriteFailed();
    } finally {
      finish();
    }
  };

  return {
    commit() {
      if (state !== "pending") return;
      state = "committed";
      void run();
    },
    cancel() {
      if (state !== "pending") return;
      state = "cancelled";
      finish();
    },
    settled,
  };
}

/** For an onSettled: run `then` once any auto-watch write has landed. */
export function afterMentionAutoWatch(
  handle: MentionAutoWatch | null | undefined,
  then: () => void,
): void {
  if (!handle) return then();
  void handle.settled.then(then);
}
