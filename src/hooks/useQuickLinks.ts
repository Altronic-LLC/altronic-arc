import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createQuickLink,
  deleteQuickLink,
  listQuickLinks,
  setQuickLinkOrder,
  updateQuickLink,
  type QuickLinkInput,
} from "@/api/quickLinks";
import type { DashboardDepartment, QuickLink } from "@/types/task";
import { useIsAdmin } from "./useIsAdmin";

// =============================================================================
// Quick Links hooks. Reading is open to any signed-in user (the Dashboard
// renders them); every mutation re-checks admin access and refuses before
// touching the API — the same defence-in-depth as Admins and CSA Listings.
// The real security boundary remains SharePoint's own list permissions.
// =============================================================================

export const QUICK_LINKS_KEY = ["quickLinks", "list"] as const;

export function useQuickLinks() {
  return useQuery<QuickLink[]>({
    queryKey: QUICK_LINKS_KEY,
    queryFn: listQuickLinks,
    staleTime: 60_000,
  });
}

/** Just this department's links, already in display order. */
export function useQuickLinksFor(department: DashboardDepartment) {
  const { data = [], ...rest } = useQuickLinks();
  return { ...rest, data: data.filter((l) => l.department === department) };
}

function requireAdmin(isAdmin: boolean) {
  if (!isAdmin) throw new Error("Only admins can manage Quick Links.");
}

export function useCreateQuickLink() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const { data: links = [] } = useQuickLinks();
  return useMutation({
    // A new link defaults to last in its department — admins re-order from
    // there rather than guessing a number up front.
    mutationFn: (input: Omit<QuickLinkInput, "order">) => {
      requireAdmin(isAdmin);
      const inDept = links.filter((l) => l.department === input.department);
      const order = inDept.length > 0 ? Math.max(...inDept.map((l) => l.order)) + 1 : 1;
      return createQuickLink({ ...input, order });
    },
    onSuccess: (created) => {
      qc.setQueryData<QuickLink[]>(QUICK_LINKS_KEY, (old) => (old ? [...old, created] : [created]));
      qc.invalidateQueries({ queryKey: QUICK_LINKS_KEY });
    },
  });
}

export function useUpdateQuickLink() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Omit<QuickLinkInput, "order"> }) => {
      requireAdmin(isAdmin);
      return updateQuickLink(id, input);
    },
    onSuccess: (updated) => {
      qc.setQueryData<QuickLink[]>(QUICK_LINKS_KEY, (old) =>
        old?.map((l) => (l.id === updated.id ? updated : l)),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUICK_LINKS_KEY }),
  });
}

export function useDeleteQuickLink() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (id: number) => {
      requireAdmin(isAdmin);
      return deleteQuickLink(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QUICK_LINKS_KEY });
      const previous = qc.getQueryData<QuickLink[]>(QUICK_LINKS_KEY);
      qc.setQueryData<QuickLink[]>(QUICK_LINKS_KEY, (old) => old?.filter((l) => l.id !== id));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUICK_LINKS_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUICK_LINKS_KEY }),
  });
}

/**
 * Move a link one place earlier or later within its OWN department — the
 * "pick the order they appear" control. Swaps `order` with whichever
 * neighbour is on that side, so no other row's position moves. Two writes
 * (one per row), both optimistic, and both rolled back together on failure
 * so the list never ends up with two rows carrying the same order value.
 */
export function useMoveQuickLink() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const { data: links = [] } = useQuickLinks();
  return useMutation({
    mutationFn: async ({ id, direction }: { id: number; direction: "up" | "down" }) => {
      requireAdmin(isAdmin);
      const link = links.find((l) => l.id === id);
      if (!link) throw new Error("That quick link is no longer there — refresh and try again.");

      const siblings = [...links]
        .filter((l) => l.department === link.department)
        .sort((a, b) => a.order - b.order || a.id - b.id);
      const index = siblings.findIndex((l) => l.id === id);
      const neighborIndex = direction === "up" ? index - 1 : index + 1;
      const neighbor = siblings[neighborIndex];
      // Already first / last in its department — nothing to do, and no
      // "can't move further" error either; the buttons just disable there.
      if (!neighbor) return [link, link] as const;

      const [a, b] = await Promise.all([
        setQuickLinkOrder(link.id, neighbor.order),
        setQuickLinkOrder(neighbor.id, link.order),
      ]);
      return [a, b] as const;
    },
    onMutate: async ({ id, direction }) => {
      await qc.cancelQueries({ queryKey: QUICK_LINKS_KEY });
      const previous = qc.getQueryData<QuickLink[]>(QUICK_LINKS_KEY);
      const link = links.find((l) => l.id === id);
      if (link) {
        const siblings = [...links]
          .filter((l) => l.department === link.department)
          .sort((a, b) => a.order - b.order || a.id - b.id);
        const index = siblings.findIndex((l) => l.id === id);
        const neighbor = siblings[direction === "up" ? index - 1 : index + 1];
        if (neighbor) {
          qc.setQueryData<QuickLink[]>(QUICK_LINKS_KEY, (old) =>
            old?.map((l) => {
              if (l.id === link.id) return { ...l, order: neighbor.order };
              if (l.id === neighbor.id) return { ...l, order: link.order };
              return l;
            }),
          );
        }
      }
      return { previous };
    },
    // Land the CONFIRMED pair the write actually returned — not just leave
    // the optimistic guess from onMutate sitting there until the background
    // refetch from onSettled eventually lands. The two neighbor calculations
    // are separate code paths (one runs against whatever's in the cache
    // before the write, the other against the fresh read after it), so a
    // future edit to one without the other should show up here rather than
    // only in a slow-refetch window.
    onSuccess: ([a, b]) => {
      qc.setQueryData<QuickLink[]>(QUICK_LINKS_KEY, (old) =>
        old?.map((l) => {
          if (l.id === a.id) return a;
          if (l.id === b.id) return b;
          return l;
        }),
      );
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUICK_LINKS_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUICK_LINKS_KEY }),
  });
}
