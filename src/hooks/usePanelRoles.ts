import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addPanelRole, listPanelRoles, removePanelRole, updatePanelRole } from "@/api/panelRoles";
import { PANEL_ROLES_ENFORCED, USE_MOCK } from "@/api/config";
import { listAdmins } from "@/api/admins";
import { isAdminEmail } from "@/lib/adminAccess";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import type { PanelRole, PanelRoleEntry } from "@/types/task";
import {
  panelRights,
  panelTeamAccess,
  type PanelRights,
  type PanelTeamAccess,
} from "@/lib/panelRoles";
import { useCurrentUser, useCurrentUserEmails } from "./useCurrentUser";
import { useAdminAccess, useIsAdmin } from "./useIsAdmin";
import { ADMINS_KEY } from "./useAdmins";

export const PANEL_ROLES_KEY = ["panel-roles", "list"] as const;

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

/** The roles a set of addresses holds on the list. */
function rolesFor(entries: readonly PanelRoleEntry[], emails: readonly string[]): PanelRole[] {
  return entries
    .filter((e) => e.user?.email && matchesAnyEmail([...emails], e.user.email))
    .map((e) => e.role)
    .filter((r): r is PanelRole => r !== null);
}

/**
 * Who may open / change the panel planning tools (BusinessIT#42) — the rule
 * is `panelTeamAccess` in lib/panelRoles.ts. Matched against EVERY address
 * the account carries (a sign-in name isn't always the mailbox). Demo mode
 * always allows: the demo user isn't on the mock list.
 */
export function usePanelTeamAccess(): PanelTeamAccess {
  const emails = useCurrentUserEmails();
  const { data: entries = [], isLoading } = usePanelRoles();
  const admin = useAdminAccess();
  if (USE_MOCK) return panelTeamAccess({ roles: [], isArcAdmin: true, resolving: false });
  return panelTeamAccess({
    roles: rolesFor(entries, emails),
    isArcAdmin: admin.isAdmin,
    resolving: isLoading || admin.isResolving,
  });
}

/**
 * Throws unless the signed-in user may change the panel planning tools — for
 * use INSIDE a mutationFn. Awaits both lists rather than trusting the
 * render-time answer, which reads "no" while they load.
 */
export function useRequirePanelTeamEdit(): () => Promise<void> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const ref = useRef(emails);
  ref.current = emails;
  return useCallback(async () => {
    if (USE_MOCK) return;
    const [entries, admins] = await Promise.all([
      qc.ensureQueryData({ queryKey: PANEL_ROLES_KEY, queryFn: listPanelRoles }),
      qc.ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins }).catch(() => []),
    ]);
    const access = panelTeamAccess({
      roles: rolesFor(entries, ref.current),
      isArcAdmin: ref.current.some((e) => isAdminEmail(e, admins)),
      resolving: false,
    });
    if (!access.canEdit) throw new Error(access.hint);
  }, [qc]);
}

/**
 * Asks one panel-access question INSIDE a mutationFn, awaiting the Panel User
 * Roles and Admins lists rather than trusting the render-time answer.
 * `refusal` returns why not, or "" when allowed.
 */
function usePanelAccessCheck(refusal: (a: PanelTeamAccess) => string): () => Promise<void> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const ref = useRef(emails);
  ref.current = emails;
  const refusalRef = useRef(refusal);
  refusalRef.current = refusal;
  return useCallback(async () => {
    if (USE_MOCK) return;
    const [entries, admins] = await Promise.all([
      qc.ensureQueryData({ queryKey: PANEL_ROLES_KEY, queryFn: listPanelRoles }),
      qc.ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins }).catch(() => []),
    ]);
    const why = refusalRef.current(
      panelTeamAccess({
        roles: rolesFor(entries, ref.current),
        isArcAdmin: ref.current.some((e) => isAdminEmail(e, admins)),
        resolving: false,
      }),
    );
    if (why) throw new Error(why);
  }, [qc]);
}

/** Throws unless the user may change the Panel Task Templates (Manager / Admin / Super User, or an ARC admin). */
export function useRequirePanelTemplateManager(): () => Promise<void> {
  return usePanelAccessCheck((a) => (a.canManageTemplates ? "" : a.templatesHint));
}

/** Throws unless the user may change capacity settings or company holidays (Super User, or an ARC admin). */
export function useRequirePanelCapacityManager(): () => Promise<void> {
  return usePanelAccessCheck((a) => (a.canManageCapacity ? "" : a.capacityHint));
}
