import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEirRole,
  listEirRoles,
  removeEirRole,
  updateEirRole,
} from "@/api/eirRoles";
import { EIR_ROLES_ENFORCED } from "@/api/config";
import type { EirRoleEntry } from "@/types/task";
import { useCurrentUser } from "./useCurrentUser";
import { useIsAdmin } from "./useIsAdmin";

const EIR_ROLES_KEY = ["eir-roles", "list"] as const;

// Defense-in-depth guard message for the admin-only EIR Roles mutations. The
// views already hide these controls from non-admins; this stops the mutation
// from running even if a control is ever wired up outside the gated view. The
// real security boundary is SharePoint per-list permissions.
const NOT_ADMIN = "Only admins can modify the EIR Roles list.";

export function useEirRoles() {
  return useQuery<EirRoleEntry[]>({
    queryKey: EIR_ROLES_KEY,
    queryFn: listEirRoles,
    staleTime: 60_000,
  });
}

export function useAddEirRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (input: Parameters<typeof addEirRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return addEirRole(input);
    },
    // Optimistic: show the new row immediately under a temporary negative
    // id; the settled refetch swaps in the server-assigned id.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: EIR_ROLES_KEY });
      const previous = qc.getQueryData<EirRoleEntry[]>(EIR_ROLES_KEY);
      const temp: EirRoleEntry = { id: -Date.now(), ...input };
      qc.setQueryData<EirRoleEntry[]>(EIR_ROLES_KEY, (old) => (old ? [...old, temp] : [temp]));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(EIR_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: EIR_ROLES_KEY }),
  });
}

export function useUpdateEirRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateEirRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return updateEirRole(input);
    },
    // Optimistic: apply the field changes in place; restored on error.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: EIR_ROLES_KEY });
      const previous = qc.getQueryData<EirRoleEntry[]>(EIR_ROLES_KEY);
      qc.setQueryData<EirRoleEntry[]>(EIR_ROLES_KEY, (old) =>
        old?.map((e) =>
          e.id === input.id
            ? {
                ...e,
                ...(input.displayName !== undefined && { displayName: input.displayName }),
                ...(input.roles !== undefined && { roles: input.roles }),
                ...(input.note !== undefined && { note: input.note }),
              }
            : e,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(EIR_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: EIR_ROLES_KEY }),
  });
}

export function useRemoveEirRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (id: Parameters<typeof removeEirRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return removeEirRole(id);
    },
    // Optimistic: drop the row immediately; restored on error.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: EIR_ROLES_KEY });
      const previous = qc.getQueryData<EirRoleEntry[]>(EIR_ROLES_KEY);
      qc.setQueryData<EirRoleEntry[]>(EIR_ROLES_KEY, (old) => old?.filter((e) => e.id !== id));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(EIR_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: EIR_ROLES_KEY }),
  });
}

export interface MyEirRoles {
  isEngineer: boolean;
  isSupplyChain: boolean;
  /**
   * Whether gating should be applied at all. False when the EIR Roles list
   * isn't configured (real mode) — callers then leave every field editable.
   */
  enforced: boolean;
}

/**
 * Resolves the signed-in user's EIR role tags from the roles list. Used by
 * EirDetailView to decide which gated fields are editable. When the feature
 * isn't enforced (list unconfigured in real mode), `enforced` is false and
 * the role flags are irrelevant — callers should not gate anything.
 */
export function useMyEirRoles(): MyEirRoles {
  const user = useCurrentUser();
  const { data: entries = [] } = useEirRoles();

  if (!EIR_ROLES_ENFORCED) {
    return { isEngineer: false, isSupplyChain: false, enforced: false };
  }

  const email = (user.email ?? "").toLowerCase();
  const mine = email
    ? entries.find((e) => e.email.toLowerCase() === email)
    : undefined;
  const roles = mine?.roles ?? [];
  return {
    isEngineer: roles.includes("engineer"),
    isSupplyChain: roles.includes("supply chain"),
    enforced: true,
  };
}
