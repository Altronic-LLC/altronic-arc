import { useEffect, useSyncExternalStore } from "react";
import { useTasks } from "./useTasks";
import { useEirs } from "./useEirs";
import { useCurrentUser } from "./useCurrentUser";
import { isUserMentionedInComments } from "@/lib/mentionDetector";

/**
 * Unique identifier for an item that has unseen mentions.
 * Format: "task:123" or "eir:456"
 */
export type UnseenMentionId = `task:${number}` | `eir:${number}`;

// ============================================================================
// Global store for unseen mentions — similar to useVersionCheck.ts
// ============================================================================

const UNSEEN_MENTIONS_KEY = "arc-unseen-mentions";

// Poll interval: 10 minutes in milliseconds (currently not actively used,
// but available for future polling mechanism)
// const POLL_INTERVAL_MS = 10 * 60 * 1000;

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
  return () => listeners.delete(listener);
}

function getStoreSnapshot(): UnseenStore {
  return storeState;
}

/**
 * Load persisted unseen mention IDs from localStorage.
 */
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

/**
 * Save unseen mention IDs to localStorage.
 */
function persistUnseen(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(UNSEEN_MENTIONS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage full or disabled — silently fail
  }
}

/**
 * Check for mentions in current tasks and EIRs.
 * Returns the set of item IDs that mention the user.
 */
function checkForMentions(
  tasks: any[] | undefined,
  eirs: any[] | undefined,
  userEmail: string | undefined
): Set<UnseenMentionId> {
  if (!userEmail) return new Set();

  const mentioned = new Set<UnseenMentionId>();

  // Check tasks
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (Array.isArray(task.comments) && isUserMentionedInComments(task.comments, userEmail)) {
        mentioned.add(`task:${task.id}` as UnseenMentionId);
      }
    }
  }

  // Check EIRs
  if (Array.isArray(eirs)) {
    for (const eir of eirs) {
      if (Array.isArray(eir.comments) && isUserMentionedInComments(eir.comments, userEmail)) {
        mentioned.add(`eir:${eir.id}` as UnseenMentionId);
      }
    }
  }

  return mentioned;
}

/**
 * Public hook to get unseen mention IDs and mark them as seen.
 *
 * The set persists across page reloads and browser restarts (localStorage).
 * It re-checks every 10 minutes or when task/EIR data changes.
 *
 * Call `markAsSeen(id)` when the user opens an item to remove it from the
 * unseen set.
 */
export function useUnseenMentions() {
  const { data: tasks } = useTasks();
  const { data: eirs } = useEirs();
  const user = useCurrentUser();

  const userEmail = user.email?.toLowerCase();

  // Recompute the set of mentioned items whenever tasks, EIRs, or user email changes
  useEffect(() => {
    if (!userEmail) return;

    // Load persisted unseen from localStorage
    const persisted = loadPersistedUnseen();

    // Check for new mentions in current data
    const currentlyMentioned = checkForMentions(tasks, eirs, userEmail);

    // Union: keep persisted unseen + add newly discovered mentions
    const combined = new Set([...persisted, ...currentlyMentioned]);

    // Filter out any that no longer exist in the data (task/EIR deleted)
    const allIds = new Set<UnseenMentionId>();
    if (Array.isArray(tasks)) {
      tasks.forEach((t) => allIds.add(`task:${t.id}` as UnseenMentionId));
    }
    if (Array.isArray(eirs)) {
      eirs.forEach((e) => allIds.add(`eir:${e.id}` as UnseenMentionId));
    }

    const filtered = new Set<UnseenMentionId>(
      ([...combined].filter((id) => allIds.has(id as UnseenMentionId)) as UnseenMentionId[])
    );

    // Save and update global store
    persistUnseen(filtered);
    updateStore({
      unseenIds: filtered,
      lastCheckTime: Date.now(),
    });
  }, [tasks, eirs, userEmail]);

  // Use external store hook to subscribe to global mention state
  const state = useSyncExternalStore(subscribeToStore, getStoreSnapshot);

  return {
    /**
     * Set of item IDs (e.g. "task:123", "eir:456") that have unseen mentions.
     */
    unseenIds: state.unseenIds,

    /**
     * Mark an item as seen by removing it from the unseen set.
     * Used when the user opens a task or EIR detail view.
     */
    markAsSeen: (id: UnseenMentionId) => {
      const updated = new Set(state.unseenIds);
      updated.delete(id);
      persistUnseen(updated);
      updateStore({
        unseenIds: updated,
        lastCheckTime: state.lastCheckTime,
      });
    },

    /**
     * Check if a specific item has unseen mentions.
     */
    isUnseen: (id: UnseenMentionId): boolean => {
      return state.unseenIds.has(id);
    },
  };
}
