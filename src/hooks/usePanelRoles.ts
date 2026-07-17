import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addPanelRole, listPanelRoles, removePanelRole, updatePanelRole } from "@/api/panelRoles";
import { PANEL_ROLES_ENFORCED } from "@/api/config";
import type { PanelRole, PanelRoleEntry } from "@/types/task";
import { panelRights, type PanelRights } from "@/lib/panelRoles";
import { useCurrentUser } from "./useCurrentUser";
import { useIsAdmin } from "./useIsAdmin";

const PANEL_ROLES_KEY = ["panel-roles", "list"] as const;

// Defense-in-depth guard for the admin-only Panel User Roles mutations. The
// views already hide these controls from non-admins; this stops the mutation
// from running even if a control is ever wired up outside the gated view.
// The real security boundary is SharePoint per-list permissions.
const NOT_ADMIN = "Only admins can modify the Panel User Roles list.";

export function usePanelRoles() {
  return useQuery<PanelRoleEntry[]>({
    queryKey: PANEL_ROLES_KEY,
    queryFn: listPanelRoles,
    staleTime: 60_000,
  });
}

export function useAddPanelRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (input: Parameters<typeof addPanelRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return addPanelRole(input);
    },
    // Optimistic: show the new row immediately under a temporary negative id;
    // the settled refetch swaps in the server-assigned id.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PANEL_ROLES_KEY });
      const previous = qc.getQueryData<PanelRoleEntry[]>(PANEL_ROLES_KEY);
      const temp: PanelRoleEntry = {
        id: -Date.now(),
        user: input.user,
        role: input.role,
        note: input.note ?? "",
      };
      qc.setQueryData<PanelRoleEntry[]>(PANEL_ROLES_KEY, (old) => (old ? [...old, temp] : [temp]));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PANEL_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_ROLES_KEY }),
  });
}

export function useUpdatePanelRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (input: Parameters<typeof updatePanelRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return updatePanelRole(input);
    },
    // Optimistic: apply the field changes in place; restored on error.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PANEL_ROLES_KEY });
      const previous = qc.getQueryData<PanelRoleEntry[]>(PANEL_ROLES_KEY);
      qc.setQueryData<PanelRoleEntry[]>(PANEL_ROLES_KEY, (old) =>
        old?.map((e) =>
          e.id === input.id
            ? {
                ...e,
                ...(input.role !== undefined && { role: input.role }),
                ...(input.note !== undefined && { note: input.note }),
              }
            : e,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PANEL_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_ROLES_KEY }),
  });
}

export function useRemovePanelRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (id: Parameters<typeof removePanelRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return removePanelRole(id);
    },
    // Optimistic: drop the row immediately; restored on error.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PANEL_ROLES_KEY });
      const previous = qc.getQueryData<PanelRoleEntry[]>(PANEL_ROLES_KEY);
      qc.setQueryData<PanelRoleEntry[]>(PANEL_ROLES_KEY, (old) => old?.filter((e) => e.id !== id));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PANEL_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_ROLES_KEY }),
  });
}

export interface MyPanelRoles extends PanelRights {
  /** The raw role tags the signed-in user holds (may be empty). */
  roles: PanelRole[];
  /**
   * Whether gating should be applied at all. False when the roles list isn't
   * configured (real mode) — callers then leave every field editable. NOTE:
   * v1 gates no fields anyway; this ships dark for the first gated field.
   */
  enforced: boolean;
}

/**
 * Resolves the signed-in user's panel roles + effective edit rights.
 * Matching is by email against the roles list's User person column.
 */
export function useMyPanelRoles(): MyPanelRoles {
  const user = useCurrentUser();
  const { data: entries = [] } = usePanelRoles();

  if (!PANEL_ROLES_ENFORCED) {
    return { roles: [], production: false, engineering: false, enforced: false };
  }

  const email = (user.email ?? "").toLowerCase();
  const roles = email
    ? entries
        .filter((e) => (e.user?.email ?? "").toLowerCase() === email)
        .map((e) => e.role)
        .filter((r): r is PanelRole => r !== null)
    : [];
  return { roles, ...panelRights(roles), enforced: true };
}
