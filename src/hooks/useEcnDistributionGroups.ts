import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  listEcnDistributionGroups,
  setEcnDistributionGroupMembers,
} from "@/api/ecnDistributionGroups";
import type { EcnDistributionGroup, Person } from "@/types/task";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { useRequireArcAdmin } from "./useRequireArcAdmin";
import { pushToast } from "@/components/Toast";

// =============================================================================
// ECN Distribution Groups (BusinessIT#57) — who receives an ECN for each role.
//
// Readable by anyone signed in (an ECN shows who its roles reach); only ARC
// admins change a group, asked INSIDE the mutationFn (useRequireArcAdmin
// awaits the Admins list), so a screen that forgot to hide its control still
// can't write.
//
// The send reads the groups FRESH (`readEcnDistributionGroups`), so an admin's
// change reaches the very next ECN with no deploy and no stale cache.
// =============================================================================

export const ECN_DISTRIBUTION_GROUPS_KEY = ["ecn-distribution-groups", "list"] as const;

export function useEcnDistributionGroups() {
  return useQuery<EcnDistributionGroup[]>({
    queryKey: ECN_DISTRIBUTION_GROUPS_KEY,
    queryFn: listEcnDistributionGroups,
    staleTime: 60_000,
  });
}

/** The groups as they stand NOW — for a send. */
export function readEcnDistributionGroups(qc: QueryClient): Promise<EcnDistributionGroup[]> {
  return qc.fetchQuery({
    queryKey: ECN_DISTRIBUTION_GROUPS_KEY,
    queryFn: listEcnDistributionGroups,
    staleTime: 0,
  });
}

export function useSetEcnDistributionGroupMembers() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async ({ id, members }: { id: number; members: Person[] }) => {
      await requireAdmin("change who an ECN is distributed to");
      return setEcnDistributionGroupMembers(id, members);
    },
    onMutate: async ({ id, members }) => {
      await qc.cancelQueries({ queryKey: ECN_DISTRIBUTION_GROUPS_KEY });
      const previous = qc.getQueryData<EcnDistributionGroup[]>(ECN_DISTRIBUTION_GROUPS_KEY);
      qc.setQueryData<EcnDistributionGroup[]>(ECN_DISTRIBUTION_GROUPS_KEY, (old) =>
        old?.map((g) => (g.id === id ? { ...g, members } : g)),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ECN_DISTRIBUTION_GROUPS_KEY, ctx.previous);
      pushToast({
        message: describeListWriteFailure(err, {
          action: "update that distribution group",
          site: "Altronic_Engineering",
          permission: "editing",
        }),
        variant: "error",
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ECN_DISTRIBUTION_GROUPS_KEY }),
  });
}
