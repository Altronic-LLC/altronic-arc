import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createComponentDescriptionOption,
  deleteComponentDescriptionOption,
  listComponentDescriptionOptions,
  updateComponentDescriptionOption,
  type ComponentDescriptionOptionInput,
} from "@/api/componentDescriptionOptions";
import type { ComponentDescriptionOption } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { optionsOfKind } from "@/lib/componentDescriptions";
import { manageDescriptionOptionsGate } from "@/lib/partsRoles";
import { useResolvePartsAccess } from "./usePartsRoles";

// =============================================================================
// The Description / Type / SIL category dropdowns for a new component, and
// the screen that manages them (/engineering/parts/descriptions).
//
// Every write asks manageDescriptionOptionsGate INSIDE its mutationFn — the
// SAP admin and the reviewing engineers — awaiting the roles list rather than
// trusting a render, so a greyed button and the write behind it can't
// disagree (the same arrangement as every Parts List write).
// =============================================================================

export const DESCRIPTION_OPTIONS_KEY = ["component-description-options", "list"] as const;

export function useComponentDescriptionOptions() {
  return useQuery<ComponentDescriptionOption[]>({
    queryKey: DESCRIPTION_OPTIONS_KEY,
    queryFn: listComponentDescriptionOptions,
    staleTime: 5 * 60_000,
  });
}

/** Asks the gate, throwing its hint when the answer is no. */
function useRequireManage() {
  const resolveAccess = useResolvePartsAccess();
  return async () => {
    const gate = manageDescriptionOptionsGate(await resolveAccess());
    if (!gate.allowed) throw new Error(gate.hint);
  };
}

function useSettle(action: string) {
  const qc = useQueryClient();
  return {
    onError: (err: unknown) => {
      pushToast({
        message: describeListWriteFailure(err, { action, site: "Altronic_Engineering", permission: "editing" }),
        variant: "error",
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: DESCRIPTION_OPTIONS_KEY }),
  };
}

export function useAddDescriptionOption() {
  const qc = useQueryClient();
  const requireManage = useRequireManage();
  return useMutation({
    mutationFn: async (input: ComponentDescriptionOptionInput) => {
      await requireManage();
      return createComponentDescriptionOption(input);
    },
    onSuccess: (created) =>
      qc.setQueryData<ComponentDescriptionOption[]>(DESCRIPTION_OPTIONS_KEY, (old) => (old ? [...old, created] : [created])),
    ...useSettle("add that option"),
  });
}

export function useUpdateDescriptionOption() {
  const qc = useQueryClient();
  const requireManage = useRequireManage();
  return useMutation({
    mutationFn: async (input: Parameters<typeof updateComponentDescriptionOption>[0]) => {
      await requireManage();
      return updateComponentDescriptionOption(input);
    },
    onSuccess: (updated) =>
      qc.setQueryData<ComponentDescriptionOption[]>(DESCRIPTION_OPTIONS_KEY, (old) =>
        old?.map((o) => (o.id === updated.id ? updated : o)),
      ),
    ...useSettle("change that option"),
  });
}

export function useDeleteDescriptionOption() {
  const qc = useQueryClient();
  const requireManage = useRequireManage();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireManage();
      await deleteComponentDescriptionOption(id);
      return id;
    },
    onSuccess: (id) =>
      qc.setQueryData<ComponentDescriptionOption[]>(DESCRIPTION_OPTIONS_KEY, (old) => old?.filter((o) => o.id !== id)),
    ...useSettle("remove that option"),
  });
}

/**
 * Move an option one place up or down within its kind, by swapping SortOrder
 * with its neighbour. The neighbour is found on a FRESH read, not the cache,
 * so two people reordering minutes apart don't swap against a stale order.
 */
export function useMoveDescriptionOption() {
  const qc = useQueryClient();
  const requireManage = useRequireManage();
  return useMutation({
    mutationFn: async ({ id, direction }: { id: number; direction: "up" | "down" }) => {
      await requireManage();
      const all = await listComponentDescriptionOptions();
      const moving = all.find((o) => o.id === id);
      if (!moving) throw new Error("That option is no longer on the list — somebody may have removed it.");
      const ordered = optionsOfKind(all, moving.kind);
      const at = ordered.findIndex((o) => o.id === id);
      const neighbour = ordered[direction === "up" ? at - 1 : at + 1];
      if (!neighbour) return [];
      // Equal orders can't be swapped into a change — step past the neighbour.
      const movingOrder =
        neighbour.sortOrder !== moving.sortOrder
          ? neighbour.sortOrder
          : neighbour.sortOrder + (direction === "up" ? -1 : 1);
      return Promise.all([
        updateComponentDescriptionOption({ id: moving.id, sortOrder: movingOrder }),
        updateComponentDescriptionOption({ id: neighbour.id, sortOrder: moving.sortOrder }),
      ]);
    },
    onSuccess: (updated) =>
      qc.setQueryData<ComponentDescriptionOption[]>(DESCRIPTION_OPTIONS_KEY, (old) =>
        old?.map((o) => updated.find((u) => u.id === o.id) ?? o),
      ),
    ...useSettle("move that option"),
  });
}
