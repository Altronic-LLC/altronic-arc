import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEcnChecklistComment,
  createEcnChecklist,
  ecnChecklistsConfigured,
  editEcnChecklistComment,
  listEcnChecklists,
  saveChecklistAnswers,
  setChecklistCompletedBy,
  setEcnChecklistWatchers,
} from "@/api/ecnChecklists";
import type { Comment, EcnChecklist, Person } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  mergeAnswers,
  parseAnswers,
  progressFor,
  serialiseAnswers,
  statusFromProgress,
  type EcnChecklistAnswer,
} from "@/lib/ecnChecklist";

// =============================================================================
// ECN Checklist hooks.
//
// NO ADMIN GATE anywhere (Ray, 2026-09-15): any signed-in user can create a
// checklist, answer items and sign one off — the same rule ECN comments and
// edits already follow. The real boundary stays SharePoint's own list
// permissions, as everywhere else in ARC.
//
// The answer mutation is OPTIMISTIC, because ticking a box must feel instant
// and a checklist is 84 of them. The write itself re-reads and merges
// server-side (see `saveChecklistAnswers`), so the optimistic patch is a
// local preview and the reconciled row is what lands.
// =============================================================================

export const ECN_CHECKLISTS_KEY = ["ecnChecklists", "list"] as const;

export function useEcnChecklists() {
  return useQuery({
    queryKey: ECN_CHECKLISTS_KEY,
    queryFn: listEcnChecklists,
    staleTime: 60_000,
  });
}

/** The checklist for one ECN, derived from the same cached list. */
export function useChecklistForEcn(ecnId: number | null) {
  const list = useEcnChecklists();
  return {
    ...list,
    data: ecnId !== null ? list.data?.find((c) => c.ecnId === ecnId) ?? null : null,
  };
}

/** Whether the SharePoint list has been created and configured. */
export function useEcnChecklistsConfigured(): boolean {
  return ecnChecklistsConfigured();
}

type Ctx = { previous?: EcnChecklist[] };

async function snapshotAndPatch(
  qc: QueryClient,
  patch: (all: EcnChecklist[]) => EcnChecklist[],
): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: ECN_CHECKLISTS_KEY });
  const previous = qc.getQueryData<EcnChecklist[]>(ECN_CHECKLISTS_KEY);
  qc.setQueryData<EcnChecklist[]>(ECN_CHECKLISTS_KEY, (old) => (old ? patch(old) : old ?? []));
  return { previous };
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  // Only restore what was actually snapshotted — writing [] into a query that
  // had no data yet renders an empty state that survives the rollback.
  if (ctx?.previous) qc.setQueryData(ECN_CHECKLISTS_KEY, ctx.previous);
}

function reconcile(qc: QueryClient, next: EcnChecklist) {
  qc.setQueryData<EcnChecklist[]>(ECN_CHECKLISTS_KEY, (old) => {
    if (!old) return [next];
    return old.some((c) => c.id === next.id)
      ? old.map((c) => (c.id === next.id ? next : c))
      : [next, ...old];
  });
}

/**
 * Create the checklist for an ECN.
 *
 * Used automatically after an ECN is created, and by the "Create checklist"
 * button on an ECN that predates this feature.
 */
export function useCreateEcnChecklist() {
  const qc = useQueryClient();
  const me = useCurrentUser();
  return useMutation({
    mutationFn: ({ ecnId, logNo }: { ecnId: number; logNo: string }) =>
      createEcnChecklist(ecnId, logNo, me ?? undefined),
    onSuccess: (created) => {
      // Seed the cache rather than only invalidating: the card renders from
      // this same query and would otherwise show "no checklist" until the
      // background refetch landed.
      reconcile(qc, created);
      void qc.invalidateQueries({ queryKey: ECN_CHECKLISTS_KEY });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't create the checklist — ${err.message}`, variant: "error" });
    },
  });
}

/**
 * Write one or more item answers.
 *
 * The optimistic patch applies the same merge the API will, so the counts and
 * the progress bar move immediately and then agree with what comes back.
 */
export function useSaveChecklistAnswers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: number;
      changes: Record<string, EcnChecklistAnswer>;
    }) => saveChecklistAnswers(id, changes),
    onMutate: async ({ id, changes }) =>
      snapshotAndPatch(qc, (all) =>
        all.map((c) => {
          if (c.id !== id) return c;
          const merged = mergeAnswers(parseAnswers(c.answersJson), changes);
          const p = progressFor(merged);
          return {
            ...c,
            answersJson: serialiseAnswers(merged),
            status: statusFromProgress(p),
            itemsTotal: p.total,
            itemsComplete: p.complete,
            itemsNa: p.na,
            itemsFlagged: p.flagged,
          };
        }),
      ),
    onSuccess: (next) => reconcile(qc, next),
    onError: (err: Error, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: `Couldn't save the checklist — ${err.message}`, variant: "error" });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ECN_CHECKLISTS_KEY }),
  });
}

/** Sign the checklist off, or clear the sign-off. */
export function useSetChecklistCompletedBy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setChecklistCompletedBy(id, person),
    onMutate: async ({ id, person }) =>
      snapshotAndPatch(qc, (all) =>
        all.map((c) =>
          c.id === id
            ? { ...c, completedBy: person, completedDate: person ? new Date() : null }
            : c,
        ),
      ),
    onSuccess: (next) => reconcile(qc, next),
    onError: (err: Error, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: `Couldn't record the sign-off — ${err.message}`, variant: "error" });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ECN_CHECKLISTS_KEY }),
  });
}

export function useSetEcnChecklistWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setEcnChecklistWatchers(id, people),
    onMutate: async ({ id, people }) =>
      snapshotAndPatch(qc, (all) =>
        all.map((c) => (c.id === id ? { ...c, watchers: people } : c)),
      ),
    onSuccess: (next) => reconcile(qc, next),
    onError: (err: Error, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: `Couldn't update watchers — ${err.message}`, variant: "error" });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ECN_CHECKLISTS_KEY }),
  });
}

export function useAddEcnChecklistComment() {
  const qc = useQueryClient();
  const me = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, bodyHtml }: { id: number; bodyHtml: string }) => {
      if (!me) throw new Error("You are not signed in.");
      return addEcnChecklistComment(id, bodyHtml, me);
    },
    onSuccess: (next) => {
      reconcile(qc, next);
      void qc.invalidateQueries({ queryKey: ECN_CHECKLISTS_KEY });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't post the comment — ${err.message}`, variant: "error" });
    },
  });
}

export function useEditEcnChecklistComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
      bodyHtml,
    }: {
      id: number;
      comment: Comment;
      bodyHtml: string;
    }) => editEcnChecklistComment(id, comment.timestamp, comment.authorEmail, bodyHtml),
    onSuccess: (next) => {
      reconcile(qc, next);
      void qc.invalidateQueries({ queryKey: ECN_CHECKLISTS_KEY });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't edit the comment — ${err.message}`, variant: "error" });
    },
  });
}
