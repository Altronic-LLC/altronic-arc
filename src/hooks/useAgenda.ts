import { useMemo } from "react";
import { useTasks } from "./useTasks";
import { useEirs } from "./useEirs";
import { useCurrentUserEmails } from "./useCurrentUser";
import { agendaAttentionCount, buildAgenda } from "@/lib/agenda";
import { toIsoDate } from "@/lib/dateInput";

// =============================================================================
// My agenda — the hooks over `lib/agenda.ts`.
//
// Both read the SAME task and EIR queries every other screen uses, and
// `useMentionScanner` (App.tsx) already subscribes to both on every page — so
// the header badge costs no extra download. Nothing here fetches anything new.
// =============================================================================

/**
 * `now`, re-read whenever the local day changes between renders. The day key
 * is what the memos depend on, so an agenda left open past midnight moves
 * "Tomorrow" to "Today" on its next render rather than holding yesterday's
 * clock for ever.
 */
function useToday(): { now: Date; today: string } {
  const now = new Date();
  return { now, today: toIsoDate(now) };
}

export function useAgenda({ days, includeWatching }: { days: number; includeWatching: boolean }) {
  const tasks = useTasks();
  const eirs = useEirs();
  const emails = useCurrentUserEmails();
  const { now, today } = useToday();

  const items = useMemo(
    () =>
      buildAgenda(tasks.data ?? [], eirs.data ?? [], { emails, days, includeWatching, now }),
    // `now` is deliberately keyed by `today`, not its own identity, which
    // changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks.data, eirs.data, emails, days, includeWatching, today],
  );

  return {
    items,
    now,
    isLoading: tasks.isLoading || eirs.isLoading,
    taskError: tasks.error,
    eirError: eirs.error,
    refetch: () => {
      void tasks.refetch();
      void eirs.refetch();
    },
  };
}

/**
 * The header badge: overdue + due today, assigned only. `null` until BOTH
 * lists have loaded — a count from half the data would undercount and then
 * jump, and "0" before anything has loaded is a claim nobody has checked.
 */
export function useAgendaAttentionCount(): number | null {
  const tasks = useTasks();
  const eirs = useEirs();
  const emails = useCurrentUserEmails();
  const { now, today } = useToday();

  return useMemo(
    () => {
      if (!tasks.data || !eirs.data) return null;
      return agendaAttentionCount(tasks.data, eirs.data, emails, now);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks.data, eirs.data, emails, today],
  );
}
