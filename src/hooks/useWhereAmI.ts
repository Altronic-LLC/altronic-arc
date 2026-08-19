import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWhereAmI,
  deleteWhereAmI,
  listWhereAmI,
  updateWhereAmI,
} from "@/api/whereAmI";
import type { WhereAmIEntry } from "@/types/task";
import { pushToast } from "@/components/Toast";

// =============================================================================
// "Where am I?" hooks — Engineering's out-of-office calendar.
//
// Anyone signed in has full control, so there's no admin guard here; the real
// boundary is SharePoint's list permissions.
//
// Adding a range creates one row per day (the list has no end date), so the
// create hook takes a LIST of entries and reports how many landed — a partial
// failure has to say so rather than silently leaving half a holiday on the
// calendar.
// =============================================================================

export const WHERE_AM_I_KEY = ["whereAmI"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useWhereAmI() {
  return useQuery({
    queryKey: WHERE_AM_I_KEY,
    queryFn: listWhereAmI,
    // People check this to plan a day, and it changes a few times a week.
    staleTime: 60_000,
  });
}

export function useCreateWhereAmI() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entries: { title: string; date: Date | null }[]) => {
      // Sequential rather than parallel: it's a handful of rows at most, and
      // a burst of parallel POSTs to one list is how you meet SharePoint's
      // throttling. Whatever succeeded before a failure stays created.
      const created: WhereAmIEntry[] = [];
      for (const entry of entries) {
        created.push(await createWhereAmI(entry));
      }
      return created;
    },
    onSuccess: (created) => {
      qc.setQueryData<WhereAmIEntry[]>(WHERE_AM_I_KEY, (old) =>
        old ? [...old, ...created] : created,
      );
      qc.invalidateQueries({ queryKey: WHERE_AM_I_KEY });
      pushToast({
        message:
          created.length === 1
            ? "Added to the calendar."
            : `Added ${created.length} days to the calendar.`,
      });
    },
    onError: (err: Error) => {
      // Some of a range may already be on the calendar — say so rather than
      // implying nothing happened.
      errorToast(`Couldn't finish adding to the calendar: ${err.message}`);
      qc.invalidateQueries({ queryKey: WHERE_AM_I_KEY });
    },
  });
}

export function useUpdateWhereAmI() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: { title: string; date: Date | null };
    }) => updateWhereAmI(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: WHERE_AM_I_KEY });
      const previous = qc.getQueryData<WhereAmIEntry[]>(WHERE_AM_I_KEY);
      qc.setQueryData<WhereAmIEntry[]>(WHERE_AM_I_KEY, (old) =>
        old?.map((e) => (e.id === id ? { ...e, ...input, modifiedAt: new Date() } : e)),
      );
      return { previous };
    },
    onSuccess: () => pushToast({ message: "Calendar entry updated." }),
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(WHERE_AM_I_KEY, ctx.previous);
      errorToast("Couldn't save that change — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WHERE_AM_I_KEY }),
  });
}

export function useDeleteWhereAmI() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteWhereAmI(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: WHERE_AM_I_KEY });
      const previous = qc.getQueryData<WhereAmIEntry[]>(WHERE_AM_I_KEY);
      qc.setQueryData<WhereAmIEntry[]>(WHERE_AM_I_KEY, (old) =>
        old?.filter((e) => e.id !== id),
      );
      return { previous };
    },
    onSuccess: () => pushToast({ message: "Removed from the calendar." }),
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(WHERE_AM_I_KEY, ctx.previous);
      errorToast("Couldn't remove that entry — put it back.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WHERE_AM_I_KEY }),
  });
}
