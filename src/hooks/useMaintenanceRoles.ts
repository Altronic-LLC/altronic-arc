import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import {
  addMaintenanceRole,
  listMaintenanceRoles,
  removeMaintenanceRole,
  updateMaintenanceRole,
} from "@/api/maintenanceRoles";
import { MAINTENANCE_ROLES_ENFORCED } from "@/api/config";
import type { MaintenanceRoleEntry } from "@/types/task";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { type MaintenanceAccess, maintenanceAccessFrom } from "@/lib/maintenanceRoles";
import { useCurrentUserEmails } from "./useCurrentUser";
import { useAdminAccess } from "./useIsAdmin";

// =============================================================================
// Maintenance Roles hooks — the CRUD behind /admin/maintenance-roles, plus
// `useMyMaintenanceRoles()`, which every gated control and every gated
// `mutationFn` in the CMMS asks. Mirrors useEirRoles.ts.
//
// The rules themselves are pure and live in lib/maintenanceRoles.ts; this file
// only resolves WHO the signed-in user is and hands that over.
// =============================================================================

export const MAINTENANCE_ROLES_KEY = ["maintenance-roles", "list"] as const;

// Defense-in-depth guard message for the admin-only mutations. The admin view
// already hides these controls; this stops the mutation running even if a
// control is ever wired up outside it. The real boundary is the SharePoint
// per-list permission.
const NOT_ADMIN = "Only admins can modify the Maintenance Roles list.";

export function useMaintenanceRoles() {
  return useQuery<MaintenanceRoleEntry[]>({
    queryKey: MAINTENANCE_ROLES_KEY,
    queryFn: listMaintenanceRoles,
    staleTime: 60_000,
  });
}

export function useAddMaintenanceRole() {
  const qc = useQueryClient();
  const { isAdmin } = useAdminAccess();
  return useMutation({
    mutationFn: (input: Parameters<typeof addMaintenanceRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return addMaintenanceRole(input);
    },
    // Optimistic: show the new row immediately under a temporary negative id;
    // the settled refetch swaps in the server-assigned one.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: MAINTENANCE_ROLES_KEY });
      const previous = qc.getQueryData<MaintenanceRoleEntry[]>(MAINTENANCE_ROLES_KEY);
      const temp: MaintenanceRoleEntry = { id: -Date.now(), ...input };
      qc.setQueryData<MaintenanceRoleEntry[]>(MAINTENANCE_ROLES_KEY, (old) =>
        old ? [...old, temp] : [temp],
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MAINTENANCE_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MAINTENANCE_ROLES_KEY }),
  });
}

export function useUpdateMaintenanceRole() {
  const qc = useQueryClient();
  const { isAdmin } = useAdminAccess();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateMaintenanceRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return updateMaintenanceRole(input);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: MAINTENANCE_ROLES_KEY });
      const previous = qc.getQueryData<MaintenanceRoleEntry[]>(MAINTENANCE_ROLES_KEY);
      qc.setQueryData<MaintenanceRoleEntry[]>(MAINTENANCE_ROLES_KEY, (old) =>
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
      if (ctx?.previous) qc.setQueryData(MAINTENANCE_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MAINTENANCE_ROLES_KEY }),
  });
}

export function useRemoveMaintenanceRole() {
  const qc = useQueryClient();
  const { isAdmin } = useAdminAccess();
  return useMutation({
    mutationFn: (id: Parameters<typeof removeMaintenanceRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return removeMaintenanceRole(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: MAINTENANCE_ROLES_KEY });
      const previous = qc.getQueryData<MaintenanceRoleEntry[]>(MAINTENANCE_ROLES_KEY);
      qc.setQueryData<MaintenanceRoleEntry[]>(MAINTENANCE_ROLES_KEY, (old) =>
        old?.filter((e) => e.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MAINTENANCE_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MAINTENANCE_ROLES_KEY }),
  });
}

/**
 * The signed-in user's CMMS rights.
 *
 * `{ isTech, isAdmin, enforced, isResolving }` — feed it to the gates in
 * lib/maintenanceRoles.ts rather than reading the flags directly, so a control
 * and the mutation behind it can't disagree about the rule.
 *
 * Three things it guarantees:
 *
 *   * **Unenforced means unrestricted.** With no Maintenance Roles list
 *     configured (real mode), `enforced` is false and every gate allows —
 *     nobody is locked out before an admin has set the list up.
 *   * **An ARC admin is always a maintenance admin**, list or no list.
 *   * **`isResolving` is honest.** Until the list has loaded, a real tech is
 *     indistinguishable from an untagged user; callers must show "checking"
 *     rather than a denial. An ARC admin never resolves — they're allowed
 *     regardless, so there is nothing to wait for.
 */
export function useMyMaintenanceRoles(): MaintenanceAccess {
  const emails = useCurrentUserEmails();
  const { isAdmin: arcAdmin, isResolving: adminResolving } = useAdminAccess();
  const { data: entries = [], isLoading } = useMaintenanceRoles();

  if (!MAINTENANCE_ROLES_ENFORCED) {
    // Truthful about ARC admin standing even here, though no gate reads it:
    // every gate short-circuits to "allowed" on `enforced: false`. Built
    // through the same factory so the flags stay internally consistent —
    // `isAdmin` without `isTech` would be a state the enforced path can't
    // produce, and a future caller reading the flags directly would be misled.
    return maintenanceAccessFrom({ arcAdmin, enforced: false });
  }

  // Matched on ADDRESS, never on display name — and against EVERY address the
  // account carries, not just the one it signs in with. A UPN is not a
  // mailbox, and in this tenant they differ (see lib/emailIdentity.ts): the
  // EIR Roles list lost Steven Pirko his role tags to exactly this.
  const mine = entries.find((e) => matchesAnyEmail(emails, e.email));
  return maintenanceAccessFrom({
    roles: mine?.roles ?? [],
    arcAdmin,
    enforced: true,
    isResolving: adminResolving || isLoading,
  });
}

/**
 * The same answer as `useMyMaintenanceRoles`, resolved inside a `mutationFn`.
 *
 * A gated mutation must NOT read the render-time flags: the roles list loads
 * asynchronously, so a mutation fired on the first paint would refuse a real
 * tech because a cache hadn't arrived yet — which is the "false denial" this
 * feature is supposed to prevent, moved from the button to the write. This
 * awaits the list through `ensureQueryData` (a cache hit costs nothing) and
 * answers from the real thing.
 *
 * A read that FAILS is refused, not waved through: an unconfigured list is
 * handled above by `enforced`, so a failure here is a genuine fault and a
 * retry fixes it. Silently granting on error would make the gate advisory.
 */
export function useResolveMaintenanceAccess(): () => Promise<MaintenanceAccess> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const { isAdmin: arcAdmin } = useAdminAccess();
  return useCallback(
    () => resolveMaintenanceAccess(qc, emails, arcAdmin),
    [qc, emails, arcAdmin],
  );
}

/** The plumbing behind `useResolveMaintenanceAccess` — exported for tests. */
export async function resolveMaintenanceAccess(
  qc: QueryClient,
  emails: string[],
  arcAdmin: boolean,
): Promise<MaintenanceAccess> {
  if (!MAINTENANCE_ROLES_ENFORCED) {
    return maintenanceAccessFrom({ arcAdmin, enforced: false });
  }
  // An ARC admin is allowed everything, so don't spend a request finding out
  // what else they hold.
  if (arcAdmin) {
    return maintenanceAccessFrom({ arcAdmin: true, enforced: true });
  }

  let entries: MaintenanceRoleEntry[];
  try {
    entries = await qc.ensureQueryData({
      queryKey: MAINTENANCE_ROLES_KEY,
      queryFn: listMaintenanceRoles,
      staleTime: 60_000,
    });
  } catch (err) {
    throw new Error(
      "Couldn't check your maintenance permissions just now " +
        `(${err instanceof Error ? err.message : "unknown error"}). Please try again.`,
    );
  }

  const mine = entries.find((e) => matchesAnyEmail(emails, e.email));
  return maintenanceAccessFrom({ roles: mine?.roles ?? [], arcAdmin, enforced: true });
}
