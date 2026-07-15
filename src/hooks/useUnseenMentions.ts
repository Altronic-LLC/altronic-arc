import { useEffect, useSyncExternalStore } from "react";
import { useTasks } from "./useTasks";
import { useEirs } from "./useEirs";
import { useOperationsTasks } from "./useOperationsTasks";
import { useCurrentUser } from "./useCurrentUser";
import { isUserMentionedInComments } from "@/lib/mentionDetector";

/**
 * Unique identifier for an item that has unseen mentions.
 * Format: "task:123", "eir:456", or "operationsTask:789"
 */
export type UnseenMentionId =
  | `task:${number}`
  | `eir:${number}`
  | `operationsTask:${number}`;

// ============================================================================
// Global store for unseen mentions.
//
// Two-layer design (performance-critical — the list/Kanban views can render
// hundreds of rows at once):
//
//   1. The scanner — `useMentionScanner()` — runs ONCE near the top of the
//      tree. It owns the React Query subscriptions for tasks/EIRs and the
//      effect that recomputes the unseen set.
//
//   2. The reader — `useIsMentioned(id)` — is called by every row, but only
//      re-renders that one row when ITS specific id flips in/out of the
//      unseen set. This is achieved by giving `useSyncExternalStore` a
//      primitive boolean snapshot. (`markAsSeen` is a stable module-level
//      function, not a hook return, so subscribing to it does not cause
//      re-renders.)
//
// Previously every row called a single mega-hook that ran the scan effect,
// returned a fresh `markAsSeen` reference per render, and notified every
// subscriber on every change — which O(N²)-ed the list views and froze the
// UI on click.
// ============================================================================

const UNSEEN_MENTIONS_KEY = "arc-unseen-mentions";

interface UnseenStore {
  unseenIds: Set<UnseenMentionId>;
  lastCheckTime: number;
}

let storeState: UnseenStore = {
  unseenIds: new Set(),
  lastCheckTime: 0,
};

const listeners = new Set<() => void>();

function updateStore(newState: UnseenStore) {
  storeState = newState;
  listeners.forEach((l) => l());
}

function subscribeToStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function loadPersistedUnseen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(UNSEEN_MENTIONS_KEY);
    if (!stored) return new Set();
    const parsed = JSON.parse(stored) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function persistUnseen(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(UNSEEN_MENTIONS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage full or disabled — silently fail
  }
}

function checkForMentions(
  tasks: any[] | undefined,
  eirs: any[] | undefined,
  operationsTasks: any[] | undefined,
  userEmail: string | undefined,
): Set<UnseenMentionId> {
  if (!userEmail) return new Set();

  const mentioned = new Set<UnseenMentionId>();

  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (Array.isArray(task.comments) && isUserMentionedInComments(task.comments, userEmail)) {
        mentioned.add(`task:${task.id}` as UnseenMentionId);
      }
    }
  }

  if (Array.isArray(eirs)) {
    for (const eir of eirs) {
      if (Array.isArray(eir.comments) && isUserMentionedInComments(eir.comments, userEmail)) {
        mentioned.add(`eir:${eir.id}` as UnseenMentionId);
      }
    }
  }

  if (Array.isArray(operationsTasks)) {
    for (const task of operationsTasks) {
      if (Array.isArray(task.comments) && isUserMentionedInComments(task.comments, userEmail)) {
        mentioned.add(`operationsTask:${task.id}` as UnseenMentionId);
      }
    }
  }

  return mentioned;
}

/**
 * Mark an item as seen. Stable module-level reference so consumers can
 * import it directly without triggering re-renders or destabilising
 * effect deps.
 */
export function markAsSeen(id: UnseenMentionId): void {
  if (!storeState.unseenIds.has(id)) return;
  const updated = new Set(storeState.unseenIds);
  updated.delete(id);
  persistUnseen(updated);
  updateStore({
    unseenIds: updated,
    lastCheckTime: storeState.lastCheckTime,
  });
}

/**
 * Per-row hook: returns true iff this id is currently in the unseen set.
 *
 * Snapshot is a primitive boolean, so a row only re-renders when ITS
 * mention state flips — not when any other row's does.
 */
export function useIsMentioned(id: UnseenMentionId): boolean {
  return useSyncExternalStore(
    subscribeToStore,
    () => storeState.unseenIds.has(id),
    () => false,
  );
}

/**
 * App-level hook: subscribes to tasks/EIRs and recomputes the unseen set
 * when data changes. Call this ONCE near the top of the tree. Calling it
 * from every row would re-run the full O(N) scan per row on every change.
 */
export function useMentionScanner(): void {
  const { data: tasks } = useTasks();
  const { data: eirs } = useEirs();
  const { data: operationsTasks } = useOperationsTasks();
  const user = useCurrentUser();

  const userEmail = user.email?.toLowerCase();

  useEffect(() => {
    if (!userEmail) return;

    const persisted = loadPersistedUnseen();
    const currentlyMentioned = checkForMentions(tasks, eirs, operationsTasks, userEmail);
    const combined = new Set([...persisted, ...currentlyMentioned]);

    // Filter out any ids that no longer exist in the data (task/EIR/Operations task deleted).
    const allIds = new Set<UnseenMentionId>();
    if (Array.isArray(tasks)) {
      tasks.forEach((t) => allIds.add(`task:${t.id}` as UnseenMentionId));
    }
    if (Array.isArray(eirs)) {
      eirs.forEach((e) => allIds.add(`eir:${e.id}` as UnseenMentionId));
    }
    if (Array.isArray(operationsTasks)) {
      operationsTasks.forEach((t) => allIds.add(`operationsTask:${t.id}` as UnseenMentionId));
    }
    const filtered = new Set<UnseenMentionId>(
      ([...combined].filter((id) => allIds.has(id as UnseenMentionId)) as UnseenMentionId[]),
    );

    persistUnseen(filtered);
    updateStore({
      unseenIds: filtered,
      lastCheckTime: Date.now(),
    });
  }, [tasks, eirs, operationsTasks, userEmail]);
}
